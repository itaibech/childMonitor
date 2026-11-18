begin;
select plan(13);

-- as admin
set local test.admin = 'on';
insert into childmonitor.children(id,name,color) values ('00000000-0000-0000-0000-000000000001','Noa','#e66');
select lives_ok($$ select set_config('t.tok', childmonitor.create_device('00000000-0000-0000-0000-000000000001','Noa laptop'), true) $$, 'admin can create device');

-- as anon
set local test.admin = 'off';
set local role anon;
select throws_ok($$ select childmonitor.create_device('00000000-0000-0000-0000-000000000001','x') $$, 'forbidden');
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

-- re-reporting users keeps supervised flag
select is((childmonitor.ingest(current_setting('t.tok'), '{"users":[{"sid":"S-1-5-21-1-1001","win_user":"PC\\noa","is_admin":false},{"sid":"S-1-5-21-1-500","win_user":"PC\\dad","is_admin":true}]}'::jsonb))->'supervised_sids', '["S-1-5-21-1-1001"]'::jsonb, 'new accounts: supervised = not is_admin');
reset role;
set local test.admin = 'on';
update childmonitor.device_users set supervised = (sid = 'S-1-5-21-1-500');
set local test.admin = 'off';
set local role anon;
select is((childmonitor.ingest(current_setting('t.tok'), '{"users":[{"sid":"S-1-5-21-1-1001","win_user":"PC\\noa","is_admin":false},{"sid":"S-1-5-21-1-500","win_user":"PC\\dad","is_admin":true}]}'::jsonb))->'supervised_sids', '["S-1-5-21-1-500"]'::jsonb, 're-reporting users keeps supervised flag');
select throws_ok($$ update childmonitor.device_users set supervised = true $$, '42501', null, 'anon cannot update device_users');
reset role;

select is((select count(*)::int from childmonitor.app_sessions), 1, 'no duplicate on re-send');
select is((select ended_at from childmonitor.app_sessions), '2026-11-18T10:09:00Z'::timestamptz, 'ended_at extended');
select is((select length(title) from childmonitor.app_sessions), 2, 'title updated');
select isnt((select last_seen_at from childmonitor.devices), null, 'last_seen_at set');
select is((select length(title)::text || ' ' || domain from childmonitor.web_sessions), '300 www.youtube.com', 'web title truncated, domain derived');

select * from finish();
rollback;
