begin;
select plan(40);

-- as admin
set local test.admin = 'on';
insert into childmonitor.children(id,name,color) values ('00000000-0000-0000-0000-000000000001','Noa','#e66');
select lives_ok($$ select set_config('t.tok', childmonitor.create_device('00000000-0000-0000-0000-000000000001','Noa laptop'), true) $$, 'admin can create device');

-- non-admin authenticated user is refused by the function itself
set local test.admin = 'off';
set local role authenticated;
select throws_ok($$ select childmonitor.create_device('00000000-0000-0000-0000-000000000001','x') $$, 'forbidden');
reset role;

-- as anon: no execute permission at all
set local role anon;
select throws_ok($$ select childmonitor.create_device('00000000-0000-0000-0000-000000000001','x') $$, '42501', null, 'anon cannot call create_device');
select throws_ok($$ select childmonitor.ingest('nope','{}'::jsonb) $$, 'invalid token');
select is((childmonitor.ingest(current_setting('t.tok'), '{"agent_version":"0.1.0","app_sessions":[{"id":"10000000-0000-0000-0000-000000000001","win_user":"PC\\noa","process":"a.exe","exe_path":"C:\\a.exe","title":"A","started_at":"2026-11-18T10:00:00Z","ended_at":"2026-11-18T10:01:00Z"}]}'::jsonb))->>'accepted', '1', 'ingest accepts a row');
-- ingest is idempotent and extends ended_at
select childmonitor.ingest(current_setting('t.tok'), '{"app_sessions":[{"id":"10000000-0000-0000-0000-000000000001","win_user":"PC\\noa","process":"a.exe","exe_path":"C:\\a.exe","title":"A2","started_at":"2026-11-18T10:00:00Z","ended_at":"2026-11-18T10:09:00Z"}]}'::jsonb);
select throws_ok($$ select count(*) from childmonitor.app_sessions $$, '42501', null, 'anon cannot read tables');

-- web row: title truncated, domain derived
select childmonitor.ingest(current_setting('t.tok'), jsonb_build_object('web_sessions', jsonb_build_array(jsonb_build_object(
  'id','20000000-0000-0000-0000-000000000001','win_user','PC\noa','browser','chrome',
  'url','https://www.youtube.com/watch?v=x','title',repeat('t',400),
  'started_at','2026-11-18T10:00:00Z','ended_at','2026-11-18T10:01:00Z'))));

select ok(childmonitor.ingest(current_setting('t.tok'), '{}'::jsonb) ? 'supervised_sids', 'empty batch returns supervised_sids');

-- re-reporting users keeps supervised flag
select is((childmonitor.ingest(current_setting('t.tok'), '{"users":[{"sid":"S-1-5-21-1-1001","win_user":"PC\\noa","is_admin":false},{"sid":"S-1-5-21-1-500","win_user":"PC\\dad","is_admin":true}]}'::jsonb))->'supervised_sids', '["S-1-5-21-1-1001"]'::jsonb, 'new accounts: supervised = not is_admin');
reset role;
-- admin RLS exercised as authenticated
set local role authenticated;
set local test.admin = 'on';
select is((select count(*)::int from childmonitor.app_sessions), 1, 'admin sees app_sessions');
select is((select count(*)::int from childmonitor.devices), 1, 'admin sees devices');
select lives_ok($$ update childmonitor.device_users set supervised = (sid = 'S-1-5-21-1-500') $$, 'admin can update device_users');
select is((select count(*)::int from childmonitor.device_users where supervised), 1, 'admin update took effect');
set local test.admin = 'off';
select is((select count(*)::int from childmonitor.devices) + (select count(*)::int from childmonitor.app_sessions), 0, 'non-admin sees no devices or sessions');
with u as (update childmonitor.device_users set supervised = true returning 1) select is((select count(*)::int from u), 0, 'non-admin update affects 0 rows');
select throws_ok($$ truncate childmonitor.app_sessions $$, '42501', null, 'authenticated cannot truncate');
reset role;
set local role anon;
select is((childmonitor.ingest(current_setting('t.tok'), '{"users":[{"sid":"S-1-5-21-1-1001","win_user":"PC\\noa","is_admin":false},{"sid":"S-1-5-21-1-500","win_user":"PC\\dad","is_admin":true}]}'::jsonb))->'supervised_sids', '["S-1-5-21-1-500"]'::jsonb, 're-reporting users keeps supervised flag');
select throws_ok($$ update childmonitor.device_users set supervised = true $$, '42501', null, 'anon cannot update device_users');
reset role;

-- reset_device_token invalidates the old token
set local test.admin = 'on';
select lives_ok($$ select set_config('t.tok2', childmonitor.reset_device_token((select id from childmonitor.devices)), true) $$, 'admin can reset token');
set local test.admin = 'off';
select throws_ok($$ select childmonitor.ingest(current_setting('t.tok'),'{}'::jsonb) $$, 'invalid token');
select is((childmonitor.ingest(current_setting('t.tok2'),'{}'::jsonb))->>'ok', 'true', 'new token works');
select throws_ok($$ select childmonitor.ingest('zz\x','{}'::jsonb) $$, 'invalid token');

select is((select count(*)::int from childmonitor.app_sessions), 1, 'no duplicate on re-send');
select is((select ended_at from childmonitor.app_sessions), '2026-11-18T10:09:00Z'::timestamptz, 'ended_at extended');
select is((select length(title) from childmonitor.app_sessions), 2, 'title updated');
select isnt((select last_seen_at from childmonitor.devices), null, 'last_seen_at set');
select is((select length(title)::text || ' ' || domain from childmonitor.web_sessions), '300 www.youtube.com', 'web title truncated, domain derived');

-- retention: at most once per hour, for ALL devices (not only the ingesting one)
insert into childmonitor.devices(id, child_id, name, token_hash)
values ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-000000000001', 'other laptop', 'h-other');
insert into childmonitor.app_sessions(id, device_id, started_at, ended_at)
values ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000d2', now() - interval '91 days', now() - interval '91 days');
insert into childmonitor.device_events(id, device_id, kind, at)
values ('30000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000d2', 'heartbeat', now() - interval '91 days');
update childmonitor.meta set value = now() - interval '2 hours' where key = 'retention_at';
set local role anon;
select childmonitor.ingest(current_setting('t.tok2'), '{}'::jsonb);
reset role;
select is((select count(*)::int from childmonitor.app_sessions where device_id = '00000000-0000-0000-0000-0000000000d2')
        + (select count(*)::int from childmonitor.device_events where device_id = '00000000-0000-0000-0000-0000000000d2'),
          0, 'retention deletes old rows of other devices');
insert into childmonitor.app_sessions(id, device_id, started_at, ended_at)
values ('30000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000d2', now() - interval '91 days', now() - interval '91 days');
set local role anon;
select childmonitor.ingest(current_setting('t.tok2'), '{}'::jsonb);
reset role;
select is((select count(*)::int from childmonitor.app_sessions where id = '30000000-0000-0000-0000-000000000003'), 1,
          'retention runs at most once per hour');
update childmonitor.meta set value = now() - interval '61 minutes' where key = 'retention_at';
set local role anon;
select childmonitor.ingest(current_setting('t.tok2'), '{}'::jsonb);
select throws_ok($$ select * from childmonitor.meta $$, '42501', null, 'anon cannot read meta');
reset role;
select is((select count(*)::int from childmonitor.app_sessions where id = '30000000-0000-0000-0000-000000000003'), 0,
          'retention runs again after an hour');

-- client download bucket: private, admin-only
select is((select public from storage.buckets where id = 'childmonitor-client'), false, 'client bucket is private');
insert into storage.objects(bucket_id, name) values ('childmonitor-client', 'ChildMonitor.zip');
set local role authenticated;
set local test.admin = 'off';
select is((select count(*)::int from storage.objects where bucket_id = 'childmonitor-client'), 0, 'non-admin cannot see client files');
select throws_ok($$ insert into storage.objects(bucket_id, name) values ('childmonitor-client', 'x.zip') $$, '42501', null,
                 'non-admin cannot upload client files');
set local test.admin = 'on';
select is((select count(*)::int from storage.objects where bucket_id = 'childmonitor-client'), 1, 'admin can see client files');
select lives_ok($$ insert into storage.objects(bucket_id, name) values ('childmonitor-client', 'y.zip') $$, 'admin can upload client files');
reset role;

-- child photo: only small inline images
select throws_ok($$ update childmonitor.children set photo = 'javascript:alert(1)' $$, '23514', null, 'photo must be an image data URL');
select lives_ok($$ update childmonitor.children set photo = 'data:image/jpeg;base64,AAAA' $$, 'photo accepts a small image');

-- diagnostics: admin-only
set local role authenticated;
set local test.admin = 'off';
select throws_ok($$ insert into childmonitor.diagnostics(body) values ('x') $$, '42501', null, 'non-admin cannot send diagnostics');
set local test.admin = 'on';
select lives_ok($$ insert into childmonitor.diagnostics(body) values ('report') $$, 'admin can send diagnostics');
set local test.admin = 'off';
select is((select count(*)::int from childmonitor.diagnostics), 0, 'non-admin cannot read diagnostics');
reset role;

select * from finish();
rollback;
