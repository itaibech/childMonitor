set search_path to childmonitor, public;

create schema if not exists childmonitor;
grant usage on schema childmonitor to anon, authenticated;

create table if not exists childmonitor.children (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  color text,
  created_at timestamptz not null default now()
);

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

  delete from childmonitor.app_sessions where device_id = dev and started_at < now() - interval '90 days';
  delete from childmonitor.web_sessions where device_id = dev and started_at < now() - interval '90 days';
  delete from childmonitor.device_events where device_id = dev and at < now() - interval '90 days';

  select coalesce(jsonb_agg(sid order by sid), '[]'::jsonb) into sids
    from childmonitor.device_users where device_id = dev and supervised;
  return jsonb_build_object('ok', true, 'accepted', n, 'supervised_sids', sids);
end $$;

revoke all on function childmonitor.ingest_sessions(uuid, jsonb) from public, anon, authenticated;
revoke all on function childmonitor.ingest(text, jsonb) from public;
revoke all on function childmonitor.create_device(uuid, text) from public;
revoke all on function childmonitor.reset_device_token(uuid) from public;
grant execute on function childmonitor.ingest(text, jsonb) to anon, authenticated;
grant execute on function childmonitor.create_device(uuid, text) to authenticated, anon;
grant execute on function childmonitor.reset_device_token(uuid) to authenticated;
