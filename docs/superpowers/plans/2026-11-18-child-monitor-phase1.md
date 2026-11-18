# Child Monitor — Phase 1 (Monitoring) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each child laptop reports apps, sites, and screen time (all Windows accounts) to Supabase; Itai sees it per child per day on a Google-login dashboard; adult sites are DNS-blocked and non-Chrome/Edge browsers are killed.

**Architecture:** A .NET 8 Windows service (LocalSystem) spawns a per-session Helper that tracks the foreground app and receives URLs from a store-published MV3 extension via native messaging. The service queues everything in SQLite and upserts batches through a `security definer` RPC on the shared Supabase project (schema `childmonitor`). A Vite + React + TS dashboard on GitHub Pages reads it under RLS (`public.is_admin()`).

**Tech Stack:** Postgres/Supabase (pgTAP tests), Vite 8 + React 19 + TypeScript + Vitest + `@supabase/supabase-js` (same versions as `itaibechor`), .NET 8 + xUnit + `Microsoft.Data.Sqlite` + `Microsoft.Extensions.Hosting.WindowsServices`, Chrome MV3 extension (Vitest for logic), PowerShell 5.1 installer.

**Spec:** `docs/superpowers/specs/2026-11-18-child-monitor-design.md`

## Global Constraints

- Supabase project ref `hyeslwlewvvjiyizoduf`, URL `https://hyeslwlewvvjiyizoduf.supabase.co`, publishable key as in `itaibechor/src/supabase.ts`. Schema `childmonitor`, registered with `itaibechor/scripts/add-app.sh childmonitor https://itaibech.github.io/childMonitor/** -- supabase/childmonitor.sql` (Itai runs it; it needs his `SUPABASE_ACCESS_TOKEN`).
- Admin = existing `public.is_admin()` (email `itai.bechor@gmail.com` + provider `google`). Reuse it, don't redefine it in the app SQL.
- RLS on every `childmonitor` table; `anon` never reads or writes tables directly; devices only call `ingest`.
- Day boundaries and all displayed times: `Asia/Jerusalem`.
- Window titles truncated to 300 chars; URLs to 2000 chars.
- Raw rows kept 90 days.
- TypeScript strict, no `any`; functions < 40 lines; no `console.log` committed; run tests after every change.
- Agent files under `C:\Program Files\ChildMonitor`, data under `C:\ProgramData\ChildMonitor` (ACL: SYSTEM + Administrators only).
- Supervision is per Windows account per laptop (`device_users.supervised`), set by Itai in the dashboard, admins included. Default for a newly seen account: `supervised = not is_admin`. Unsupervised accounts: no Helper, no browser killing. DNS, browser policies and the extension stay machine-wide.
- DNS: `1.1.1.3`, `1.0.0.3` (IPv4), `2606:4700:4700::1113`, `2606:4700:4700::1003` (IPv6).
- Killed browsers (exe name, case-insensitive): `firefox.exe, brave.exe, opera.exe, opera_gx.exe, vivaldi.exe, tor.exe, waterfox.exe, librewolf.exe, yandex.exe, browser.exe` (Yandex), `chromium.exe`, `iexplore.exe`. Never kill `chrome.exe`, `msedge.exe`, `msedgewebview2.exe`.
- Polling: foreground every 5 s; idle threshold 120 s; open-session refresh every 60 s; upload every 60 s, max 500 rows per batch; heartbeat every 300 s.

## Wire format (shared by agent, extension and SQL)

Every row carries a client-generated UUID `id`. Sessions are **re-sent while open** with a growing `ended_at`; the server upserts by `id`. This gives live data and makes retries idempotent.

```json
{
  "agent_version": "0.1.0",
  "app_sessions": [{"id":"uuid","win_user":"DESKTOP\\noa","process":"Minecraft.exe","exe_path":"C:\\...","title":"Minecraft","started_at":"2026-11-18T15:00:00Z","ended_at":"2026-11-18T15:05:00Z"}],
  "web_sessions": [{"id":"uuid","win_user":"DESKTOP\\noa","browser":"chrome","url":"https://www.youtube.com/watch?v=x","title":"...","started_at":"...","ended_at":"..."}],
  "events":       [{"id":"uuid","win_user":"DESKTOP\\noa","kind":"logon","detail":{},"at":"..."}],
  "users":        [{"sid":"S-1-5-21-...-1001","win_user":"DESKTOP\\noa","is_admin":false}]
}
```

`ingest` response: `{"ok":true,"accepted":n,"supervised_sids":["S-1-5-21-...-1001"]}`. The service sends `users` (all local accounts) on start and every hour, even when there is nothing else to send.

`kind` ∈ `logon, logoff, lock, unlock, idle, active, heartbeat, agent_start, shutdown, suspend, resume, browser_blocked`. Pipe and native-messaging messages are the same row objects wrapped as `{"type":"app"|"web"|"event","row":{...}}`, one JSON object per line on the pipe.

## Review Focus

1. **Session crossing midnight (Jerusalem):** a 23:30–00:30 session counts 30 min to each day, not 60 to one. → Task 3 test `splits session across Jerusalem midnight`.
2. **Two accounts active at once (fast user switching) or app + browser overlapping:** screen time is the *union* of intervals, never the sum. → Task 3 test `overlapping sessions count once`.
3. **Retry after timeout / re-sent open session:** same `id` twice must update, not duplicate. → Task 1 test `ingest is idempotent and extends ended_at`.
4. **Laptop offline for days, then a burst of thousands of rows:** uploads in ≤500-row batches, oldest first, deletes only acked rows. → Task 5 test `uploader drains backlog in batches and keeps rows on failure`.
5. **Supervision changed in the dashboard while the child is signed in:** turning it off stops tracking within one upload cycle (~60 s); turning it on starts the Helper in the running session without re-login; a flip by Itai is never overwritten by the agent re-reporting the account. → Task 1 test `re-reporting users keeps supervised flag`, Task 7 test `SupervisionSet diff yields start and stop`.
6. **Browser look-alikes:** `msedgewebview2.exe` (used by many apps) and Chrome/Edge are never killed; matching is by exe file name only, not path or substring. → Task 7 test `BrowserBlocklist does not match webview or chrome`.

---

### Task 1: Supabase schema, RLS, ingest and pairing RPCs

**Files:**
- Create: `supabase/childmonitor.sql`
- Create: `supabase/config.toml` (via `npx supabase init`)
- Create: `supabase/tests/childmonitor.test.sql`
- Create: `.gitignore`, `README.md` (one paragraph + how to apply SQL)

**Interfaces:**
- Produces tables in schema `childmonitor`: `children(id uuid pk, name text, color text, created_at)`, `devices(id uuid pk, child_id uuid fk, name text, token_hash text unique, created_at, last_seen_at timestamptz null, agent_version text null)`, `app_sessions(id uuid pk, device_id, win_user, process, exe_path, title, started_at, ended_at)`, `web_sessions(id uuid pk, device_id, win_user, browser, url, domain, title, started_at, ended_at)`, `device_events(id uuid pk, device_id, win_user, kind, detail jsonb, at)`, `device_users(device_id uuid fk, sid text, win_user text, is_admin bool, supervised bool, first_seen_at timestamptz, pk(device_id, sid))`. Index `(device_id, started_at)` / `(device_id, at)`.
- `childmonitor.ingest(token text, batch jsonb) returns jsonb` — `{"ok":true,"accepted":n,"supervised_sids":[...]}`; raises `invalid token` on unknown token. Granted to `anon`.
- `childmonitor.create_device(child uuid, device_name text) returns text` — the plaintext token (32 random bytes, hex), stored as `encode(sha256(token::bytea),'hex')`. Admin only (raises `forbidden` otherwise).
- `childmonitor.reset_device_token(device uuid) returns text` — admin only.

- [ ] **Step 1: Write failing pgTAP tests** in `supabase/tests/childmonitor.test.sql`. The schema is applied to the local DB before tests (Step 2 command), with a stub `supabase/tests/stub_is_admin.sql`: `create or replace function public.is_admin() returns boolean language sql stable as $$ select coalesce(current_setting('test.admin', true),'') = 'on' $$;` Tests (whole file runs in one transaction, so `set local` works):

```sql
select plan(9);
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
-- 'ingest is idempotent and extends ended_at'
select childmonitor.ingest(current_setting('t.tok'), '{"app_sessions":[{"id":"10000000-0000-0000-0000-000000000001","win_user":"PC\\noa","process":"a.exe","exe_path":"C:\\a.exe","title":"A2","started_at":"2026-11-18T10:00:00Z","ended_at":"2026-11-18T10:09:00Z"}]}'::jsonb);
select throws_ok($$ select count(*) from childmonitor.app_sessions $$, '42501', null, 'anon cannot read tables');
reset role;
select is((select count(*)::int from childmonitor.app_sessions), 1, 'no duplicate on re-send');
select is((select ended_at from childmonitor.app_sessions), '2026-11-18T10:09:00Z'::timestamptz, 'ended_at extended');
select is((select length(title) from childmonitor.app_sessions), 2, 'title updated');
select isnt((select last_seen_at from childmonitor.devices), null, 'last_seen_at set');
select * from finish();
```

Add to the same file: `re-reporting users keeps supervised flag` — ingest `users` with a standard and an admin account ⇒ `supervised_sids` contains only the standard SID; as admin `update device_users set supervised = true` for the admin SID and `false` for the standard one; ingest the same `users` again ⇒ `supervised_sids` = only the admin SID; anon `update device_users` fails. Also a web row with a 400-char title is stored with `length(title) = 300` and `domain = 'www.youtube.com'` for `https://www.youtube.com/watch?v=x` (bump `plan`).

- [ ] **Step 2: Run, verify it fails**
Run: `npx supabase start && psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/tests/stub_is_admin.sql -f supabase/childmonitor.sql && npx supabase test db` (needs Docker Desktop; `stub_is_admin.sql` lives outside the `*.test.sql` pattern so pg_prove skips it)
Expected: FAIL — schema `childmonitor` does not exist.

- [ ] **Step 3: Implement `supabase/childmonitor.sql`**
Starts with `set search_path to childmonitor, public;` (as `add-app.sh` expects). Tables as in Interfaces; `alter table … enable row level security` on all five; one `select` policy per table `using (public.is_admin())`; on `children` and `devices` also `insert/update/delete` (and `update` on `device_users`) … using/with check (public.is_admin())`. `revoke all on all tables in schema childmonitor from anon` (add-app.sh grants them). `ingest`: `security definer`, `set search_path = ''`, look up device by token hash, `insert … select from jsonb_to_recordset(batch->'app_sessions') … on conflict (id) do update set ended_at = greatest(existing, excluded), title = excluded.title`; same for web (compute `domain` with `substring(url from '^[a-z]+://([^/:?#]+)')`, `left(title,300)`, `left(url,2000)`) and events (`on conflict do nothing`); `users` → `insert … on conflict (device_id, sid) do update set win_user, is_admin` (never touches `supervised`; new rows get `supervised = not is_admin`); update `last_seen_at = now()`, `agent_version`; return supervised SIDs for the device. Retention: `delete … where started_at < now() - interval '90 days'` for this device inside `ingest` (pg_cron not assumed). `grant execute on function childmonitor.ingest to anon`; `create_device`/`reset_device_token` granted to `authenticated` and check `public.is_admin()`.

- [ ] **Step 4: Run, verify it passes**
Run the Step 2 command again (`childmonitor.sql` must be re-runnable: `create … if not exists`, `create or replace`, `drop policy if exists`) → Expected: all tests `ok`.

- [ ] **Step 5: Commit**
`git add supabase .gitignore README.md && git commit -m "feat(db): childmonitor schema, RLS, ingest and pairing"`

- [ ] **Step 6: Hand off to Itai (do not run against prod yourself)**
Tell him to run, from `~/GitReposGeneral/itaibechor`:
`SUPABASE_ACCESS_TOKEN=sbp_... scripts/add-app.sh childmonitor 'https://itaibech.github.io/childMonitor/**' -- ../childMonitor/supabase/childmonitor.sql`

---

### Task 2: Dashboard scaffold, Google login gate, Pages deploy

**Files:**
- Create: `web/` (Vite React-TS template, trimmed): `web/package.json`, `web/vite.config.ts` (`base: '/childMonitor/'`), `web/index.html`, `web/src/main.tsx`, `web/src/App.tsx`, `web/src/supabase.ts`, `web/src/styles.css`, `web/src/types.ts`
- Create: `.github/workflows/deploy.yml` (copy of `itaibechor/.github/workflows/deploy.yml` with `working-directory: web`, `cache-dependency-path: web/package-lock.json`, artifact `path: web/dist`)
- Test: `web/src/App.test.tsx`

**Interfaces:**
- Produces `supabase` client: `createClient(URL, KEY, { auth: { flowType: 'pkce' }, db: { schema: 'childmonitor' } })`.
- Produces `web/src/types.ts`: `Child {id,name,color}`, `Device {id,child_id,name,created_at,last_seen_at,agent_version}`, `AppSession {id,device_id,win_user,process,title,started_at,ended_at}`, `WebSession {id,device_id,win_user,browser,url,domain,title,started_at,ended_at}`, `DeviceEvent {id,device_id,win_user,kind,detail,at}`. Timestamps are `string`.
- Produces `<App/>` routes via hash: `#/` home, `#/child/:id?date=YYYY-MM-DD`, `#/settings`.

- [ ] **Step 1: Write failing test** `App.test.tsx` (Vitest + jsdom + `@testing-library/react`): mock `supabase.auth.getSession` → no session ⇒ renders button "Sign in with Google"; session with `user.email = 'someone@x.com'` and an empty `children` select returning RLS error ⇒ renders "No access".
- [ ] **Step 2:** `cd web && npm test` → FAIL.
- [ ] **Step 3:** Implement `App.tsx` auth gate (same sign-in call as `itaibechor/src/Admin.tsx:104`, redirect `location.origin + location.pathname`), hash router, "No access" when the user's email is not `itai.bechor@gmail.com` (UI hint only; RLS is the real guard). `npm test` script = `vitest run`.
- [ ] **Step 4:** `npm test && npm run build` → PASS, `web/dist/index.html` exists.
- [ ] **Step 5:** Commit `feat(web): scaffold, google login gate, pages deploy`.

---

### Task 3: Usage aggregation (pure TS)

**Files:**
- Create: `web/src/usage.ts`
- Test: `web/src/usage.test.ts`

**Interfaces:**
- Consumes: `AppSession`, `WebSession` from Task 2.
- Produces:
  - `dayRange(date: string): { start: Date; end: Date }` — Jerusalem local midnight to next midnight (use `Intl.DateTimeFormat` offset, no date library; handle 23h/25h DST days).
  - `clip<T extends {started_at:string; ended_at:string}>(rows: T[], range): Array<T & {ms: number}>` — drops rows outside, trims to range.
  - `screenTimeMs(rows: {started_at:string; ended_at:string}[], range): number` — union of intervals.
  - `byHour(rows, range): number[]` — length = hours in that day, minutes per hour (union).
  - `topBy<T>(rows: Array<T & {ms:number}>, key: (r: T) => string): Array<{key: string; ms: number}>` sorted desc.

- [ ] **Step 1: Write failing tests:**
  - `splits session across Jerusalem midnight`: session `2026-11-18T21:30:00Z`–`22:30:00Z` (= 23:30–00:30 Jerusalem, UTC+2) ⇒ `screenTimeMs` for `2026-11-18` = 30 min and for `2026-11-19` = 30 min.
  - `overlapping sessions count once`: 10:00–11:00 and 10:30–11:30 ⇒ 90 min.
  - `byHour sums to screenTime` for a mixed fixture; DST day `2026-10-25` has 25 entries.
  - `topBy groups by process`: two `chrome.exe` rows 10 + 5 min, one `game.exe` 20 min ⇒ `[game 20, chrome 15]`.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implement in `usage.ts` (sort + merge intervals for union).
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `feat(web): usage aggregation`.

---

### Task 4: Dashboard pages — Home, Child day view, Settings/pairing

**Files:**
- Create: `web/src/data.ts` (queries), `web/src/Home.tsx`, `web/src/ChildDay.tsx`, `web/src/Settings.tsx`, `web/src/health.ts`
- Test: `web/src/health.test.ts`, `web/src/Settings.test.tsx`

**Interfaces:**
- Consumes: `usage.ts` (Task 3), types/client (Task 2), RPCs `create_device`, `reset_device_token` (Task 1).
- Produces `data.ts`: `fetchChildren(): Promise<Child[]>`, `fetchDevices(): Promise<Device[]>`, `fetchDay(deviceIds: string[], range): Promise<{apps: AppSession[]; web: WebSession[]; events: DeviceEvent[]}>` (filter `started_at < end and ended_at > start`), `createDevice(childId, name): Promise<string>`, `fetchDeviceUsers(deviceId): Promise<DeviceUser[]>`, `setSupervised(deviceId, sid, on: boolean): Promise<void>` (plain `update` under RLS). Add `DeviceUser {device_id,sid,win_user,is_admin,supervised,first_seen_at}` to `types.ts`.
- Produces `health.ts`: `deviceStatus(d: Device, lastEvent: DeviceEvent | undefined, now: Date): 'ok' | 'off' | 'silent'` — `ok` if `last_seen_at` within 30 min; `off` if older and last event kind ∈ {`shutdown`,`suspend`,`logoff`}; else `silent` (red).

- [ ] **Step 1: Failing tests:** `health.test.ts` — last seen 5 min ago ⇒ `ok`; 2 h ago + last `shutdown` ⇒ `off`; 2 h ago + last `heartbeat` ⇒ `silent`; never seen ⇒ `silent`. `Settings.test.tsx` — clicking "Add laptop" with child + name calls mocked `createDevice` and shows the returned token and the install command `install.ps1 -Token <token>` once; a device's accounts list shows an "admin" badge for `is_admin` and toggling the Supervised checkbox calls `setSupervised(device, sid, false)`.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implement pages per spec "Dashboard": Home cards (today's screen time, top 3 apps by `process`, top 3 `domain`, status dot from `deviceStatus`); ChildDay (date input `<input type="date">`, hourly bars as plain CSS divs — no chart library, app and domain tables, timeline list merged from apps/web/events sorted by time, `<select>` filter by `win_user`, `browser_blocked` events highlighted); Settings (children CRUD, devices list with reset token, per-device accounts table with Supervised checkbox).
- [ ] **Step 4:** `npm test && npm run build` → PASS.
- [ ] **Step 5:** Commit `feat(web): home, child day view, settings and pairing`.

---

### Task 5: Agent core library — models, SQLite queue, uploader

**Files:**
- Create: `agent/ChildMonitor.sln`, `agent/Core/Core.csproj` (`net8.0`, so tests run on macOS), `agent/Core/Rows.cs`, `agent/Core/Queue.cs`, `agent/Core/Uploader.cs`, `agent/Core/Config.cs`
- Test: `agent/Core.Tests/Core.Tests.csproj` (xUnit), `agent/Core.Tests/QueueTests.cs`, `agent/Core.Tests/UploaderTests.cs`

**Interfaces:**
- Produces `Rows.cs`: records `AppRow`, `WebRow`, `EventRow` matching the wire format (`System.Text.Json`, snake_case naming policy), `PipeMessage(string Type, JsonElement Row)`.
- Produces `Queue(string dbPath)`: `void Upsert(string type, string id, string json)` (replace by id — open sessions re-sent), `IReadOnlyList<QueuedRow> Oldest(int max)`, `void Delete(IEnumerable<long> seq)`; `QueuedRow(long Seq, string Type, string Json)`.
- Produces `Uploader(Queue q, HttpClient http, Config cfg)`: `Task<int> FlushAsync(CancellationToken ct)` — loops batches of ≤500 until empty or failure; POST `{SupabaseUrl}/rest/v1/rpc/ingest` with headers `apikey` + `Authorization: Bearer <publishable key>`, body `{"token":..., "batch":{...}}`; returns rows sent; after each successful response stores `supervised_sids` via `SupervisionStore.Save`.
- Produces `SupervisionStore(string path)` (`C:\ProgramData\ChildMonitor\supervised.json`): `IReadOnlySet<string> Load()` (empty set if missing/corrupt), `void Save(IEnumerable<string> sids)`, `event Action<IReadOnlySet<string>> Changed`.
- Produces `Config`: loaded from `C:\ProgramData\ChildMonitor\config.json` → `{ "token": "...", "supabaseUrl": "...", "apiKey": "..." }`.

- [ ] **Step 1: Failing tests:**
  - `Upsert_same_id_replaces`: two upserts same id ⇒ `Oldest(10).Count == 1`, json is the second.
  - `uploader drains backlog in batches and keeps rows on failure`: 1200 rows + fake handler returning 200 ⇒ 3 requests of 500/500/200, queue empty; fake returning 500 on the 2nd request ⇒ `FlushAsync` returns 500, queue holds the remaining 700 with oldest-first order preserved.
  - `Batch_json_shape`: posted body has `token` and `batch.app_sessions[0].id`.
  - `Supervised_sids_saved_from_response`: fake response with `supervised_sids:["S-1"]` ⇒ `SupervisionStore.Load()` = {`S-1`}; corrupt file ⇒ empty set.
- [ ] **Step 2:** `cd agent && dotnet test` → FAIL.
- [ ] **Step 3:** Implement (Microsoft.Data.Sqlite, table `queue(seq integer primary key autoincrement, type text, id text unique, json text)`; upsert = `insert … on conflict(id) do update set json=excluded.json` — keeps original `seq` so order is by first seen).
- [ ] **Step 4:** `dotnet test` → PASS.
- [ ] **Step 5:** Commit `feat(agent): core rows, sqlite queue, uploader`.

---

### Task 6: Helper — foreground tracker, idle, native messaging host

**Files:**
- Create: `agent/Core/ForegroundTracker.cs` (pure, in Core so it's testable), `agent/Helper/Helper.csproj` (`net8.0-windows`, `OutputType WinExe`), `agent/Helper/Program.cs`, `agent/Helper/Win32.cs`, `agent/Helper/PipeClient.cs`, `agent/Helper/NativeHost.cs`
- Test: `agent/Core.Tests/ForegroundTrackerTests.cs`

**Interfaces:**
- Consumes: `Rows.cs`, `PipeMessage` (Task 5).
- Produces `ForegroundTracker(string winUser, Func<Guid> newId)`: `IEnumerable<AppRow> Observe(Sample s, DateTime nowUtc)` where `Sample(string Process, string ExePath, string Title, TimeSpan Idle, bool Locked)`. Rules: change of process or title ⇒ close current (emit with `ended_at = now`), open new; `Idle >= 120 s` or `Locked` ⇒ close current, open none; while unchanged, re-emit the open row every 60 s with updated `ended_at`. Title truncated to 300.
- Pipe name: `ChildMonitorPipe` (Task 7 is the server). Helper writes `PipeMessage` JSON lines.
- `Helper.exe --native-host` mode: Chrome native messaging (4-byte little-endian length + JSON on stdin), each message is a `WebRow` minus `id`/`win_user` which the helper fills, forwarded to the pipe. Host name: `com.itaibech.childmonitor`.

- [ ] **Step 1: Failing tests:** `title_change_closes_and_opens`, `idle_closes_session` (idle 121 s ⇒ one closed row, nothing open), `unchanged_reemits_every_60s` (samples at 0,5,…,65 s ⇒ a re-emit with same id and `ended_at` = 60 s), `locked_closes_session`, `long_title_truncated`.
- [ ] **Step 2:** `dotnet test` → FAIL.
- [ ] **Step 3:** Implement tracker; then `Win32.cs` (`GetForegroundWindow`, `GetWindowThreadProcessId`, `GetWindowText`, `QueryFullProcessImageName`, `GetLastInputInfo`; lock via `WTSRegisterSessionNotification` or `OpenInputDesktop` failing), `Program.cs` 5 s loop sending tracker output + `logon` event at start, `PipeClient` with reconnect.
- [ ] **Step 4:** `dotnet test` → PASS; `dotnet build agent/Helper -c Release -r win-x64` succeeds (on macOS too, cross-compile).
- [ ] **Step 5:** Commit `feat(agent): helper foreground tracking and native host`.

---

### Task 7: Service — session spawning, pipe server, browser blocker, power events, heartbeat

**Files:**
- Create: `agent/Core/BrowserBlocklist.cs` (pure), `agent/Core/SupervisionSet.cs` (pure), `agent/Service/LocalAccounts.cs`, `agent/Service/Service.csproj` (`net8.0-windows`, Worker SDK, `UseWindowsService`), `agent/Service/Program.cs`, `agent/Service/Worker.cs`, `agent/Service/SessionLauncher.cs`, `agent/Service/PipeServer.cs`, `agent/Service/BrowserKiller.cs`
- Test: `agent/Core.Tests/BrowserBlocklistTests.cs`

**Interfaces:**
- Consumes: `Queue`, `Uploader`, `Config` (Task 5); Helper exe path `C:\Program Files\ChildMonitor\Helper.exe` (Task 6); pipe `ChildMonitorPipe`.
- Produces `BrowserBlocklist.IsBlocked(string exeFileName): bool` using the Global Constraints list.
- Produces `SupervisionSet.Diff(IReadOnlySet<string> before, IReadOnlySet<string> after, IReadOnlyDictionary<int,string> sessionSids): (int[] start, int[] stop)` — session ids whose Helper must be started/stopped.
- Produces `LocalAccounts.List(): IEnumerable<UserRow>` (`UserRow(string Sid, string WinUser, bool IsAdmin)`, add to `Rows.cs`) — local accounts via `Win32_UserAccount where LocalAccount=true and Disabled=false`, admin = member of `S-1-5-32-544`.
- Service name `ChildMonitorSvc`, display "Child Monitor".

- [ ] **Step 1: Failing tests:** `BrowserBlocklist does not match webview or chrome` (`msedgewebview2.exe`, `chrome.exe`, `msedge.exe`, `Chrome.EXE` ⇒ false), `SupervisionSet Diff yields start and stop` (sessions {2:`S-a`,3:`S-b`}, before {`S-a`}, after {`S-b`} ⇒ start [3], stop [2]), `blocks firefox case-insensitive` (`FireFox.exe` ⇒ true), `matches file name only` (`C:\x\firefox.exe` passed as full path ⇒ true via `Path.GetFileName`; `firefoxsetup.exe` ⇒ false).
- [ ] **Step 2:** `dotnet test` → FAIL.
- [ ] **Step 3:** Implement:
  - `SessionLauncher`: on start enumerate sessions (`WTSEnumerateSessions`), on `SessionChange` logon/unlock → launch Helper in that session (`WTSQueryUserToken` + `CreateProcessAsUser`, desktop `winsta0\default`) only if the session user's SID is in `SupervisionStore.Load()`; on `SupervisionStore.Changed` apply `SupervisionSet.Diff` (kill Helper for stopped sessions, launch for started ones); track PIDs, relaunch on exit (check every 30 s). Send `users` from `LocalAccounts.List()` on start and hourly. First install with no cache yet: treat non-admin accounts as supervised until the first `ingest` response.
  - `PipeServer`: `NamedPipeServerStream` with `PipeSecurity` allowing Authenticated Users write; each line → `Queue.Upsert`. Records `logon/logoff/lock/unlock` from `SessionChange`, `suspend/resume` from `PowerEvent`, `shutdown` from `OnShutdown`, `agent_start` on start, `heartbeat` every 300 s.
  - `BrowserKiller`: WMI `ManagementEventWatcher` on `Win32_ProcessStartTrace`; if `IsBlocked` and the process's session user is supervised (`ProcessIdToSessionId` → session SID) ⇒ `Process.Kill()` and queue `browser_blocked` event with `detail {"exe": name}`.
  - Uploader loop every 60 s.
- [ ] **Step 4:** `dotnet test` → PASS; `dotnet publish agent/Service -c Release -r win-x64 --self-contained -p:PublishSingleFile=true` succeeds.
- [ ] **Step 5:** Commit `feat(agent): service, session launcher, browser blocker`.

---

### Task 8: Browser extension (MV3)

**Files:**
- Create: `extension/manifest.json` (`permissions: ["tabs","webNavigation","nativeMessaging","idle"]`, background service worker), `extension/src/background.ts`, `extension/src/tracker.ts`, `extension/package.json` (Vitest + esbuild build to `extension/dist`), `extension/tsconfig.json`
- Test: `extension/src/tracker.test.ts`

**Interfaces:**
- Produces `WebTracker`: `onActive(tabUrl: string | undefined, title: string, browser: 'chrome'|'edge', now: number): WebMsg[]`, `onWindowBlur(now): WebMsg[]`, `tick(now): WebMsg[]` (re-emit open session every 60 s). `WebMsg = {id, browser, url, title, started_at, ended_at}` (ids via `crypto.randomUUID`). Ignores `chrome://`, `edge://`, `chrome-extension://`, `about:`.
- Sends to native host `com.itaibech.childmonitor` (Task 6) via `chrome.runtime.connectNative`, reconnect on disconnect.
- Browser detection: `navigator.userAgent` contains `Edg/` ⇒ `edge`.

- [ ] **Step 1: Failing tests:** `switching tab closes previous and opens new`, `internal pages are ignored`, `blur closes session`, `tick re-emits same id with later ended_at`.
- [ ] **Step 2:** `cd extension && npm test` → FAIL.
- [ ] **Step 3:** Implement `tracker.ts`; `background.ts` wires `tabs.onActivated`, `webNavigation.onCompleted` (frameId 0), `windows.onFocusChanged`, `chrome.alarms` 1-minute tick (add `alarms` permission).
- [ ] **Step 4:** `npm test && npm run build` → PASS; load unpacked in Chrome on the spare PC, confirm no errors on `chrome://extensions`.
- [ ] **Step 5:** Commit `feat(extension): tab tracking via native messaging`.

---

### Task 9: Installer, uninstaller, machine policies

**Files:**
- Create: `installer/install.ps1`, `installer/uninstall.ps1`, `installer/native-host.json` (template), `installer/build.ps1` (publishes Service + Helper into `installer/out/`)

**Interfaces:**
- Consumes: published exes (Tasks 6–7), extension store IDs (Task 10; parameters until then), native host name `com.itaibech.childmonitor`, service name `ChildMonitorSvc`.
- `install.ps1 -Token <string> [-ChromeExtId <id>] [-EdgeExtId <id>]` — requires admin, idempotent (safe to re-run for upgrades).

- [ ] **Step 1:** Write `install.ps1` doing, in order:
  1. Copy `out\*` to `C:\Program Files\ChildMonitor`; write `C:\ProgramData\ChildMonitor\config.json`; ACL ProgramData folder to SYSTEM + Administrators.
  2. `sc.exe create ChildMonitorSvc binPath= ... start= auto`; `sc.exe failure ChildMonitorSvc reset= 0 actions= restart/5000/restart/5000/restart/5000`; `sc.exe sdset` so only SYSTEM/Administrators can stop/configure.
  3. Native host manifest to `C:\Program Files\ChildMonitor\native-host.json` (`path` = `Helper.exe --native-host` via a `NativeHost.cmd` wrapper, `allowed_origins` = extension IDs); register under `HKLM\SOFTWARE\Google\Chrome\NativeMessagingHosts\com.itaibech.childmonitor` and `HKLM\SOFTWARE\Microsoft\Edge\NativeMessagingHosts\…`.
  4. Policies HKLM `SOFTWARE\Policies\Google\Chrome`: `ExtensionInstallForcelist\1 = <id>;https://clients2.google.com/service/update2/crx`, `IncognitoModeAvailability=1`, `ForceGoogleSafeSearch=1`, `ForceYouTubeRestrict=1`, `DnsOverHttpsMode=off`. Edge `SOFTWARE\Policies\Microsoft\Edge`: `ExtensionInstallForcelist\1 = <id>;https://edge.microsoft.com/extensionwebstorebase/v1/crx`, `InPrivateModeAvailability=1`, `ForceBingSafeSearch=2`, `ForceGoogleSafeSearch=1`, `ForceYouTubeRestrict=1`, `DnsOverHttpsMode=off`.
  5. DNS: `Set-DnsClientServerAddress` on every up physical adapter to the Global Constraints servers; Windows DoH off for them.
  6. `Add-MpPreference -ExclusionPath 'C:\Program Files\ChildMonitor'`.
  7. Start service; print status.
- [ ] **Step 2:** `uninstall.ps1` reverses each step (DNS → DHCP via `-ResetServerAddresses`).
- [ ] **Step 3: Verify on the spare PC** (create a standard user "testkid"): run install as admin with a token from the dashboard. Expected: `Get-Service ChildMonitorSvc` Running; as testkid `sc stop ChildMonitorSvc` ⇒ Access denied; `Stop-Process` on Helper ⇒ it's back within 30 s; `nslookup pornhub.com` ⇒ `0.0.0.0`; launching a portable Firefox ⇒ closes immediately and a `browser_blocked` row appears in the dashboard; `chrome://policy` lists the policies; Settings lists testkid (supervised) and the admin account (admin badge, not supervised) and the admin's activity is absent; turn on the admin account's switch ⇒ within ~2 min its activity appears and Firefox gets killed for it too; turn testkid off ⇒ its activity stops within ~2 min.
- [ ] **Step 4:** Commit `feat(installer): install/uninstall with policies, dns, service hardening`.

---

### Task 10: Publish extension and end-to-end check

**Files:**
- Modify: `README.md` (install steps for a new laptop)
- Create: `extension/store/description.md`, `extension/store/privacy.md` (single-purpose statement: parental monitoring on family devices; data goes only to the owner's backend)

- [ ] **Step 1:** Itai (his accounts) publishes `extension/dist` zipped as **Unlisted** on Chrome Web Store (one-time $5 developer fee) and **Hidden** on Edge Add-ons. Record both IDs in `README.md` and as `install.ps1` defaults.
- [ ] **Step 2:** Re-run `install.ps1` on the spare PC with the store IDs. Expected: extension appears as "Installed by your organization" in both browsers and can't be removed by testkid.
- [ ] **Step 3: End-to-end** as testkid for 15 min: use Notepad, a game/app, YouTube in Chrome, Wikipedia in Edge, lock, sleep the PC, wake. Expected in dashboard within 2 min: screen time ≈ active time (idle and sleep excluded), apps and domains listed, timeline shows lock/suspend/resume, status `ok`; after sleeping 40 min status shows `off` (grey), not red. Pull network cable 10 min, reconnect ⇒ data for that gap appears.
- [ ] **Step 4:** Install on both kids' laptops (kids' accounts set to Standard first), pair each in Settings.
- [ ] **Step 5:** Commit `docs: store listing and install guide`.
