set search_path to childmonitor, public;

create schema if not exists childmonitor;
grant usage on schema childmonitor to anon, authenticated;

create table if not exists childmonitor.children (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  color text,
  created_at timestamptz not null default now()
);
-- Nightly offline time, e.g. {"enabled":true,"weekday":{"from":"21:30","to":"07:00"},"weekend":{"from":"23:00","to":"08:00"}}
alter table childmonitor.children add column if not exists offline jsonb check (offline is null or jsonb_typeof(offline) = 'object');

create table if not exists childmonitor.devices (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references childmonitor.children(id) on delete cascade,
  name text not null,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  agent_version text
);

create table if not exists childmonitor.app_sessions (
  id uuid primary key,
  device_id uuid not null references childmonitor.devices(id) on delete cascade,
  win_user text,
  process text,
  exe_path text,
  title text,
  started_at timestamptz not null,
  ended_at timestamptz not null
);
create index if not exists app_sessions_device_started on childmonitor.app_sessions (device_id, started_at);

create table if not exists childmonitor.web_sessions (
  id uuid primary key,
  device_id uuid not null references childmonitor.devices(id) on delete cascade,
  win_user text,
  browser text,
  url text,
  domain text,
  title text,
  started_at timestamptz not null,
  ended_at timestamptz not null
);
create index if not exists web_sessions_device_started on childmonitor.web_sessions (device_id, started_at);

create table if not exists childmonitor.device_events (
  id uuid primary key,
  device_id uuid not null references childmonitor.devices(id) on delete cascade,
  win_user text,
  kind text not null,
  detail jsonb,
  at timestamptz not null
);
create index if not exists device_events_device_at on childmonitor.device_events (device_id, at);

create table if not exists childmonitor.device_users (
  device_id uuid not null references childmonitor.devices(id) on delete cascade,
  sid text not null,
  win_user text,
  is_admin boolean not null default false,
  supervised boolean not null default true,
  first_seen_at timestamptz not null default now(),
  primary key (device_id, sid)
);

-- RLS: admin only; anon never touches tables (devices go through ingest)
-- Internal bookkeeping (e.g. last retention run). RLS on, no policies: only security definer code touches it.
create table if not exists childmonitor.meta (
  key text primary key,
  value timestamptz
);

alter table childmonitor.meta enable row level security;
alter table childmonitor.children enable row level security;
alter table childmonitor.devices enable row level security;
alter table childmonitor.app_sessions enable row level security;
alter table childmonitor.web_sessions enable row level security;
alter table childmonitor.device_events enable row level security;
alter table childmonitor.device_users enable row level security;

drop policy if exists children_admin on childmonitor.children;
create policy children_admin on childmonitor.children for all
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists devices_admin on childmonitor.devices;
create policy devices_admin on childmonitor.devices for all
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists device_users_select on childmonitor.device_users;
create policy device_users_select on childmonitor.device_users for select
  using (public.is_admin());
drop policy if exists device_users_update on childmonitor.device_users;
create policy device_users_update on childmonitor.device_users for update
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists app_sessions_select on childmonitor.app_sessions;
create policy app_sessions_select on childmonitor.app_sessions for select using (public.is_admin());
drop policy if exists web_sessions_select on childmonitor.web_sessions;
create policy web_sessions_select on childmonitor.web_sessions for select using (public.is_admin());
drop policy if exists device_events_select on childmonitor.device_events;
create policy device_events_select on childmonitor.device_events for select using (public.is_admin());

revoke all on all tables in schema childmonitor from anon, authenticated;
revoke all on all sequences in schema childmonitor from anon, authenticated;
alter default privileges in schema childmonitor revoke all on tables from anon, authenticated;
grant select, insert, update, delete on childmonitor.children, childmonitor.devices to authenticated;
grant select on childmonitor.app_sessions, childmonitor.web_sessions, childmonitor.device_events to authenticated;
grant select, update on childmonitor.device_users to authenticated;

-- Pairing RPCs (admin only)
create or replace function childmonitor.create_device(child uuid, device_name text)
returns text language plpgsql security definer set search_path = '' as $$
declare tok text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  insert into childmonitor.devices(child_id, name, token_hash)
  values (child, device_name, encode(extensions.digest(convert_to(tok, 'utf8'), 'sha256'), 'hex'));
  return tok;
end $$;

create or replace function childmonitor.reset_device_token(device uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare tok text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  update childmonitor.devices
     set token_hash = encode(extensions.digest(convert_to(tok, 'utf8'), 'sha256'), 'hex')
   where id = device;
  if not found then raise exception 'unknown device'; end if;
  return tok;
end $$;

-- Ingest helpers (internal; not granted to anon)
create or replace function childmonitor.ingest_sessions(dev uuid, batch jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare n int := 0; c int;
begin
  insert into childmonitor.app_sessions(id, device_id, win_user, process, exe_path, title, started_at, ended_at)
  select r.id, dev, r.win_user, r.process, r.exe_path, left(r.title, 300), r.started_at, r.ended_at
    from jsonb_to_recordset(batch->'app_sessions') as r(id uuid, win_user text, process text, exe_path text, title text, started_at timestamptz, ended_at timestamptz)
  on conflict (id) do update
    set ended_at = greatest(childmonitor.app_sessions.ended_at, excluded.ended_at), title = excluded.title
    where childmonitor.app_sessions.device_id = excluded.device_id;
  get diagnostics c = row_count; n := n + c;

  insert into childmonitor.web_sessions(id, device_id, win_user, browser, url, domain, title, started_at, ended_at)
  select r.id, dev, r.win_user, r.browser, left(r.url, 2000),
         lower(substring(r.url from '^[a-zA-Z]+://([^/:?#]+)')), left(r.title, 300), r.started_at, r.ended_at
    from jsonb_to_recordset(batch->'web_sessions') as r(id uuid, win_user text, browser text, url text, title text, started_at timestamptz, ended_at timestamptz)
  on conflict (id) do update
    set ended_at = greatest(childmonitor.web_sessions.ended_at, excluded.ended_at), title = excluded.title
    where childmonitor.web_sessions.device_id = excluded.device_id;
  get diagnostics c = row_count; n := n + c;

  insert into childmonitor.device_events(id, device_id, win_user, kind, detail, at)
  select r.id, dev, r.win_user, r.kind, r.detail, r.at
    from jsonb_to_recordset(batch->'events') as r(id uuid, win_user text, kind text, detail jsonb, at timestamptz)
  on conflict (id) do nothing;
  get diagnostics c = row_count; n := n + c;
  return n;
end $$;

-- 90-day retention for ALL devices, at most once per hour (claimed atomically via childmonitor.meta)
create or replace function childmonitor.apply_retention()
returns void language plpgsql security definer set search_path = '' as $$
declare claimed int;
begin
  insert into childmonitor.meta(key, value) values ('retention_at', now())
  on conflict (key) do update set value = excluded.value
   where childmonitor.meta.value is null or childmonitor.meta.value <= now() - interval '1 hour';
  get diagnostics claimed = row_count;
  if claimed = 0 then return; end if;
  delete from childmonitor.app_sessions where started_at < now() - interval '90 days';
  delete from childmonitor.web_sessions where started_at < now() - interval '90 days';
  delete from childmonitor.device_events where at < now() - interval '90 days';
end $$;

create or replace function childmonitor.ingest(token text, batch jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare dev uuid; n int; sids jsonb;
begin
  select id into dev from childmonitor.devices
   where token_hash = encode(extensions.digest(convert_to(token, 'utf8'), 'sha256'), 'hex');
  if dev is null then raise exception 'invalid token'; end if;
  batch := coalesce(batch, '{}'::jsonb);

  n := childmonitor.ingest_sessions(dev, batch);

  insert into childmonitor.device_users(device_id, sid, win_user, is_admin, supervised)
  select dev, r.sid, r.win_user, coalesce(r.is_admin, false), not coalesce(r.is_admin, false)
    from jsonb_to_recordset(batch->'users') as r(sid text, win_user text, is_admin boolean)
   where r.sid is not null
  on conflict (device_id, sid) do update set win_user = excluded.win_user, is_admin = excluded.is_admin;

  update childmonitor.devices
     set last_seen_at = now(), agent_version = coalesce(batch->>'agent_version', agent_version)
   where id = dev;

  perform childmonitor.apply_retention();

  select coalesce(jsonb_agg(sid order by sid), '[]'::jsonb) into sids
    from childmonitor.device_users where device_id = dev and supervised;
  return jsonb_build_object('ok', true, 'accepted', n, 'supervised_sids', sids,
    'offline', (select c.offline from childmonitor.devices d join childmonitor.children c on c.id = d.child_id where d.id = dev));
end $$;

revoke all on function childmonitor.ingest_sessions(uuid, jsonb) from public, anon, authenticated;
revoke all on function childmonitor.apply_retention() from public, anon, authenticated;
revoke all on function childmonitor.ingest(text, jsonb) from public;
revoke all on function childmonitor.create_device(uuid, text) from public, anon;
revoke all on function childmonitor.reset_device_token(uuid) from public;
grant execute on function childmonitor.ingest(text, jsonb) to anon, authenticated;
grant execute on function childmonitor.create_device(uuid, text) to authenticated;
grant execute on function childmonitor.reset_device_token(uuid) to authenticated;

-- Private bucket for the Windows client zip: only the admin can list, download (signed URL) or upload it.
insert into storage.buckets (id, name, public, file_size_limit)
values ('childmonitor-client', 'childmonitor-client', false, 52428800)
on conflict (id) do update set public = false;

drop policy if exists childmonitor_client_admin on storage.objects;
create policy childmonitor_client_admin on storage.objects for all to authenticated
  using (bucket_id = 'childmonitor-client' and public.is_admin())
  with check (bucket_id = 'childmonitor-client' and public.is_admin());

-- Diagnostics pasted from a laptop on the Install page, for troubleshooting. Admin-only.
create table if not exists childmonitor.diagnostics (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  body text not null check (length(body) <= 200000)
);
alter table childmonitor.diagnostics enable row level security;
drop policy if exists diagnostics_admin on childmonitor.diagnostics;
create policy diagnostics_admin on childmonitor.diagnostics for all
  using (public.is_admin()) with check (public.is_admin());
grant select, insert, delete on childmonitor.diagnostics to authenticated;

-- Child photo: a small square JPEG (resized in the browser) stored inline, admin-only through the children policy.
alter table childmonitor.children add column if not exists photo text;
alter table childmonitor.children drop constraint if exists children_photo_check;
alter table childmonitor.children add constraint children_photo_check
  check (photo is null or (photo like 'data:image/%' and length(photo) <= 300000));

-- Categories of activity (editable on the dashboard) and which sites and apps belong to each.
create table if not exists childmonitor.categories (
  name text primary key check (length(trim(name)) between 1 and 40),
  color text not null default '#a3afc2',
  position int not null default 100
);

-- pattern: for a site, a domain that also covers its subdomains ("ynet.co.il", "ac.il");
-- for an app, the lowercase exe name ("robloxplayerbeta.exe"). source: 'auto' (built-in list) or 'manual' (set by the parent).
create table if not exists childmonitor.site_categories (
  kind text not null check (kind in ('site', 'app')),
  pattern text not null check (pattern = lower(pattern) and length(pattern) between 2 and 253),
  category text not null references childmonitor.categories(name) on update cascade on delete cascade,
  source text not null default 'manual' check (source in ('auto', 'manual')),
  primary key (kind, pattern)
);

alter table childmonitor.categories enable row level security;
alter table childmonitor.site_categories enable row level security;
drop policy if exists categories_admin on childmonitor.categories;
create policy categories_admin on childmonitor.categories for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists site_categories_admin on childmonitor.site_categories;
create policy site_categories_admin on childmonitor.site_categories for all using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on childmonitor.categories, childmonitor.site_categories to authenticated;

insert into childmonitor.categories(name, color, position) values
  ('School', '#3c9d74', 1), ('Search', '#5b9fd0', 2), ('News', '#6c7a96', 3), ('Video', '#e0607e', 4), ('Music', '#c77dd6', 5),
  ('Games', '#f2b84b', 6), ('Social', '#9b7fe6', 7), ('Messaging', '#3fb8b0', 8), ('Shopping', '#e88a4f', 9),
  ('Sports', '#7cb342', 10), ('Tools', '#a3afc2', 11)
on conflict (name) do nothing;

-- Built-in list. Only adds what is missing, so the parent's own choices and edits are never overwritten.
-- ponytail: hand-made list of common sites and apps (global + Israel); the "Needs a category" queue covers the rest.
insert into childmonitor.site_categories(kind, pattern, category, source)
select v.kind, v.pattern, v.category, 'auto'
  from (values
  ('site','ac.il','School'), ('site','k12.il','School'), ('site','edu','School'), ('site','gov.il','School'), ('site','gov','School'),
  ('site','classroom.google.com','School'), ('site','docs.google.com','School'), ('site','drive.google.com','School'),
  ('site','sites.google.com','School'), ('site','forms.google.com','School'), ('site','slides.google.com','School'),
  ('site','khanacademy.org','School'), ('site','wikipedia.org','School'), ('site','wiktionary.org','School'), ('site','duolingo.com','School'),
  ('site','mashov.info','School'), ('site','webtop.co.il','School'), ('site','smartschool.co.il','School'), ('site','education.gov.il','School'),
  ('site','cet.ac.il','School'), ('site','ofek.cet.ac.il','School'), ('site','geogebra.org','School'), ('site','desmos.com','School'),
  ('site','scratch.mit.edu','School'), ('site','code.org','School'), ('site','quizlet.com','School'), ('site','kahoot.it','School'),
  ('site','kahoot.com','School'), ('site','canva.com','School'), ('site','office.com','School'), ('site','microsoft365.com','School'),
  ('site','onedrive.live.com','School'), ('site','sharepoint.com','School'), ('site','teams.microsoft.com','School'), ('site','zoom.us','School'),
  ('site','britannica.com','School'), ('site','brainpop.com','School'), ('site','brainpop.co.il','School'), ('site','ted.com','School'),
  ('site','coursera.org','School'), ('site','edx.org','School'), ('site','codecademy.com','School'), ('site','w3schools.com','School'),
  ('site','stackoverflow.com','School'), ('site','github.com','School'), ('site','chatgpt.com','School'), ('site','claude.ai','School'),
  ('site','gemini.google.com','School'), ('site','translate.google.com','School'), ('site','morfix.co.il','School'), ('site','reverso.net','School'),
  ('site','google.com','Search'), ('site','google.co.il','Search'), ('site','bing.com','Search'), ('site','duckduckgo.com','Search'),
  ('site','yahoo.com','Search'), ('site','ecosia.org','Search'), ('site','search.brave.com','Search'),
  ('site','ynet.co.il','News'), ('site','mako.co.il','News'), ('site','walla.co.il','News'), ('site','haaretz.co.il','News'),
  ('site','themarker.com','News'), ('site','maariv.co.il','News'), ('site','israelhayom.co.il','News'), ('site','n12.co.il','News'),
  ('site','kan.org.il','News'), ('site','i24news.tv','News'), ('site','timesofisrael.com','News'), ('site','jpost.com','News'),
  ('site','calcalist.co.il','News'), ('site','globes.co.il','News'), ('site','bhol.co.il','News'), ('site','kikar.co.il','News'),
  ('site','0404.co.il','News'), ('site','rotter.net','News'), ('site','bbc.com','News'), ('site','bbc.co.uk','News'), ('site','cnn.com','News'),
  ('site','nytimes.com','News'), ('site','theguardian.com','News'), ('site','reuters.com','News'), ('site','apnews.com','News'),
  ('site','news.google.com','News'), ('site','msn.com','News'),
  ('site','youtube.com','Video'), ('site','youtu.be','Video'), ('site','youtube-nocookie.com','Video'), ('site','netflix.com','Video'),
  ('site','disneyplus.com','Video'), ('site','primevideo.com','Video'), ('site','max.com','Video'), ('site','hulu.com','Video'),
  ('site','vimeo.com','Video'), ('site','dailymotion.com','Video'), ('site','twitch.tv','Video'), ('site','kick.com','Video'),
  ('site','yes.co.il','Video'), ('site','hot.net.il','Video'), ('site','partner.co.il','Video'), ('site','cellcom.co.il','Video'),
  ('site','sdarot.tw','Video'), ('site','crunchyroll.com','Video'), ('site','apple.com','Tools'),
  ('site','spotify.com','Music'), ('site','music.youtube.com','Music'), ('site','music.apple.com','Music'), ('site','soundcloud.com','Music'),
  ('site','deezer.com','Music'), ('site','shazam.com','Music'), ('site','tab4u.com','Music'), ('site','ultimate-guitar.com','Music'),
  ('site','roblox.com','Games'), ('site','minecraft.net','Games'), ('site','poki.com','Games'), ('site','poki.co.il','Games'),
  ('site','crazygames.com','Games'), ('site','miniclip.com','Games'), ('site','coolmathgames.com','Games'), ('site','friv.com','Games'),
  ('site','y8.com','Games'), ('site','agame.com','Games'), ('site','kizi.com','Games'), ('site','silvergames.com','Games'),
  ('site','chess.com','Games'), ('site','lichess.org','Games'), ('site','steampowered.com','Games'), ('site','steamcommunity.com','Games'),
  ('site','epicgames.com','Games'), ('site','fortnite.com','Games'), ('site','ea.com','Games'), ('site','xbox.com','Games'),
  ('site','playstation.com','Games'), ('site','nintendo.com','Games'), ('site','itch.io','Games'), ('site','geoguessr.com','Games'),
  ('site','slither.io','Games'), ('site','krunker.io','Games'), ('site','shellshock.io','Games'), ('site','agar.io','Games'),
  ('site','skribbl.io','Games'), ('site','gartic.io','Games'), ('site','fandom.com','Games'), ('site','curseforge.com','Games'),
  ('site','tiktok.com','Social'), ('site','instagram.com','Social'), ('site','facebook.com','Social'), ('site','x.com','Social'),
  ('site','twitter.com','Social'), ('site','snapchat.com','Social'), ('site','reddit.com','Social'), ('site','pinterest.com','Social'),
  ('site','threads.net','Social'), ('site','tumblr.com','Social'), ('site','linkedin.com','Social'), ('site','quora.com','Social'),
  ('site','whatsapp.com','Messaging'), ('site','web.whatsapp.com','Messaging'), ('site','discord.com','Messaging'), ('site','discord.gg','Messaging'),
  ('site','telegram.org','Messaging'), ('site','web.telegram.org','Messaging'), ('site','messenger.com','Messaging'),
  ('site','mail.google.com','Messaging'), ('site','outlook.live.com','Messaging'), ('site','outlook.office.com','Messaging'),
  ('site','amazon.com','Shopping'), ('site','amazon.co.uk','Shopping'), ('site','aliexpress.com','Shopping'), ('site','ebay.com','Shopping'),
  ('site','temu.com','Shopping'), ('site','shein.com','Shopping'), ('site','ksp.co.il','Shopping'), ('site','ivory.co.il','Shopping'),
  ('site','bug.co.il','Shopping'), ('site','zap.co.il','Shopping'), ('site','yad2.co.il','Shopping'), ('site','terminalx.com','Shopping'),
  ('site','asos.com','Shopping'), ('site','ikea.com','Shopping'), ('site','etsy.com','Shopping'), ('site','wolt.com','Shopping'),
  ('site','sport5.co.il','Sports'), ('site','one.co.il','Sports'), ('site','sport1.maariv.co.il','Sports'), ('site','espn.com','Sports'),
  ('site','nba.com','Sports'), ('site','uefa.com','Sports'), ('site','fifa.com','Sports'), ('site','livescore.com','Sports'),
  ('site','sofascore.com','Sports'), ('site','flashscore.com','Sports'), ('site','flashscore.co.il','Sports'),
  ('app','robloxplayerbeta.exe','Games'), ('app','robloxstudiobeta.exe','Games'), ('app','minecraft.exe','Games'),
  ('app','minecraftlauncher.exe','Games'), ('app','javaw.exe','Games'), ('app','steam.exe','Games'), ('app','epicgameslauncher.exe','Games'),
  ('app','fortniteclient-win64-shipping.exe','Games'), ('app','valorant.exe','Games'), ('app','riotclientservices.exe','Games'),
  ('app','leagueclient.exe','Games'), ('app','xboxpcapp.exe','Games'), ('app','solitaire.exe','Games'), ('app','fifa23.exe','Games'),
  ('app','netflix.exe','Video'), ('app','vlc.exe','Video'), ('app','video.ui.exe','Video'), ('app','disneyplus.exe','Video'),
  ('app','spotify.exe','Music'), ('app','applemusic.exe','Music'),
  ('app','whatsapp.exe','Messaging'), ('app','whatsapp.root.exe','Messaging'), ('app','discord.exe','Messaging'),
  ('app','telegram.exe','Messaging'), ('app','ms-teams.exe','School'), ('app','teams.exe','School'), ('app','zoom.exe','School'),
  ('app','winword.exe','School'), ('app','excel.exe','School'), ('app','powerpnt.exe','School'), ('app','onenote.exe','School'),
  ('app','onenoteim.exe','School'), ('app','acrord32.exe','School'), ('app','acrobat.exe','School'), ('app','geogebra.exe','School'),
  ('app','scratch 3.exe','School'), ('app','code.exe','School'), ('app','notion.exe','School'),
  ('app','instagram.exe','Social'), ('app','tiktok.exe','Social'),
  ('app','explorer.exe','Tools'), ('app','notepad.exe','Tools'), ('app','systemsettings.exe','Tools'), ('app','applicationframehost.exe','Tools'),
  ('app','calc.exe','Tools'), ('app','calculatorapp.exe','Tools'), ('app','mspaint.exe','Tools'), ('app','snippingtool.exe','Tools'),
  ('app','taskmgr.exe','Tools'), ('app','searchhost.exe','Tools'), ('app','startmenuexperiencehost.exe','Tools'),
  ('app','shellexperiencehost.exe','Tools'), ('app','lockapp.exe','Tools'), ('app','photos.exe','Tools'), ('app','windowsterminal.exe','Tools')
  ) as v(kind, pattern, category)
on conflict (kind, pattern) do nothing;

-- "Needs a category": sites and apps used since `since` that match nothing, most time first. Runs as the caller, so RLS applies.
create or replace function childmonitor.uncategorized(since timestamptz)
returns table(kind text, name text, ms bigint) language sql stable security invoker set search_path = '' as $$
  select * from (
    select 'site'::text, w.domain, (sum(extract(epoch from w.ended_at - w.started_at)) * 1000)::bigint
      from childmonitor.web_sessions w
     where w.started_at >= since and coalesce(w.domain, '') <> ''
       and not exists (select 1 from childmonitor.site_categories s
                        where s.kind = 'site' and (w.domain = s.pattern or w.domain like '%.' || s.pattern))
     group by w.domain
    union all
    select 'app'::text, lower(a.process), (sum(extract(epoch from a.ended_at - a.started_at)) * 1000)::bigint
      from childmonitor.app_sessions a
     where a.started_at >= since and coalesce(a.process, '') <> ''
       and lower(a.process) not in ('chrome.exe', 'msedge.exe', 'firefox.exe', 'brave.exe', 'opera.exe', 'iexplore.exe')
       and not exists (select 1 from childmonitor.site_categories s where s.kind = 'app' and s.pattern = lower(a.process))
     group by lower(a.process)
  ) t(kind, name, ms)
  order by ms desc
  limit 100
$$;
revoke all on function childmonitor.uncategorized(timestamptz) from public, anon;
grant execute on function childmonitor.uncategorized(timestamptz) to authenticated;
