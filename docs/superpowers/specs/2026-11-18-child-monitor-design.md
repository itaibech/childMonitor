# Child Monitor — Design

Date: 2026-11-18 · Owner: Itai Bechor

## Intent

Itai wants to monitor his two children's Windows 11 laptops: which apps they use, which sites they visit, how long they're on, and anything suspicious. Later, block adult content, apps and sites, and enforce time limits. The end state is a Family Link / Microsoft Family Safety equivalent he controls.

**Why build it:** Microsoft Family Safety doesn't work well for him, and the children use multiple Windows accounts, which per-account tools miss. Monitoring must follow the *laptop*, whatever account is signed in.

## Goals

- One parent dashboard (web), Google login, only Itai can see anything.
- One machine-wide install per laptop that covers every Windows account on it, including accounts created later.
- Phase 1: per child, per day — screen time, time per app, sites visited, timeline. Adult sites blocked from day one.
- Built to grow into alerts, limits and blocking without a rewrite.

## Non-goals (for now)

- Screenshots, keystroke logging, reading chats/messages.
- macOS, phones, tablets.
- Multiple parents / sharing with other families.
- Real-time remote control (live view).

## Anti-goals (failure even if it "works")

- A standard-user child can stop, uninstall or bypass it with a click (killing a process, removing the extension, switching account).
- Data visible to anyone but Itai (public GitHub Pages + Supabase anon key means RLS must be airtight).
- Noticeable slowdown or battery drain on the laptops.
- Silent failure: an agent stops reporting and the dashboard still looks "fine".

## Constraints

- Children's laptops: Windows 11, Itai has admin; children must be **standard users** (no admin) on every account.
- Dashboard: hosted on GitHub Pages, like his other apps (Vite + React + TypeScript, plain CSS, Google login via Supabase).
- Backend: the shared Supabase project `hyeslwlewvvjiyizoduf` (`itaibechor` repo), one schema per app. Register with `scripts/add-app.sh childmonitor <pages-url>/** -- <sql files>`. That script grants table privileges to `anon`/`authenticated`, so **RLS on every table is mandatory**.
- Free tier: keep data small (aggregate where possible, retention limit).
- Admin check: same as personal site — `is_admin()` = email `itai.bechor@gmail.com` + Google provider.
- User's code rules: strict TypeScript, no `any`, functions < 40 lines, no `console.log` committed, tests run after changes.

## Approaches considered

| | Approach | Trade-off |
|---|---|---|
| **A (picked)** | **C# (.NET) Windows service + per-session helper + policy-installed browser extension** | Native Windows APIs, tamper-resistant service, same service later enforces blocking. Cost: a second language (C#) and an installer. |
| B | PowerShell scripts + scheduled tasks | Fastest to start, but trivially visible/killable and a dead end for blocking. |
| C | Node/Electron agent in TypeScript | One language, but heavy runtime, native add-ons for Win32 APIs, awkward as a service. |

Itai picked **A** because it's the only one that grows into a Family Safety replacement.

## Architecture

```
 Child laptop (Windows 11)                         Supabase (schema childmonitor)        Parent
 ┌──────────────────────────────────────┐         ┌──────────────────────────┐   ┌──────────────┐
 │ ChildMonitor Service (LocalSystem)   │  HTTPS  │ rpc ingest(token, batch) │   │ Dashboard    │
 │  - spawns helper in each session     ├────────►│ tables + RLS             │◄──┤ GitHub Pages │
 │  - local queue (SQLite) + uploader   │         │ is_admin() read-only     │   │ Google login │
 │  - heartbeat, self-restart helpers   │         └──────────────────────────┘   └──────────────┘
 │ ChildMonitor Helper (per session,    │
 │   runs as the signed-in user)        │
 │  - foreground app + window title     │
 │  - idle / lock / logon / logoff      │
 │ Browser extension (Chrome + Edge,    │
 │   force-installed via HKLM policy)   │
 │  - visited URLs → helper (native     │
 │     messaging) → service queue       │
 │ DNS: Cloudflare Families 1.1.1.3     │
 │ Policy: SafeSearch, no InPrivate/    │
 │   Incognito, no other browsers (P3)  │
 └──────────────────────────────────────┘
```

### Repo layout (`itaibech/childMonitor`, one repo)

```
web/        Vite + React + TS dashboard → GitHub Pages (Actions)
agent/      .NET 8 solution: Service, Helper, shared lib, tests
extension/  Manifest V3 extension (Chrome + Edge, same code)
supabase/   SQL for the childmonitor schema (applied via add-app.sh)
installer/  install.ps1 (and later an MSI)
docs/
```

### Agent (C#, .NET 8, self-contained single-file exe)

- **Service** (`ChildMonitorSvc`, LocalSystem, auto-start, recovery = restart):
  - On start and on every session logon (`OnSessionChange`), launches the Helper into that user session (`WTSQueryUserToken` + `CreateProcessAsUser`). Restarts it if it dies.
  - Receives events from Helpers over a named pipe; writes them to a local SQLite queue under `C:\ProgramData\ChildMonitor` (ACL: SYSTEM + Administrators only).
  - Uploader: every 60 s posts unsent events in batches to `rpc ingest`; retries with backoff; survives offline days.
  - Heartbeat every 5 min (also proves the service is alive).
  - Service ACL set so standard users cannot stop it.
- **Helper** (runs as the user, no window):
  - Polls every 5 s: foreground window → process name, exe path, window title. Emits an event only on change, with start/end times (so data = sessions, not samples).
  - Idle detection via `GetLastInputInfo` (idle > 2 min = not counted as active time).
  - Lock/unlock, logon/logoff.
  - Native messaging host for the extension (receives URL visits, forwards to service).
- **Identity:** each laptop has a device token (see Pairing). Every event carries Windows username + SID, so multiple accounts are visible but all count toward the laptop's child.

### Browser extension (Manifest V3)

- Listens to completed top-frame navigations (`webNavigation.onCompleted`) and tab focus; records URL, title, start/end time of active tab.
- Sends to the Helper via native messaging. No direct network calls.
- Force-installed into Chrome and Edge through HKLM policy (`ExtensionInstallForcelist`), so it applies to every account and can't be removed. Self-hosted update URL (in this repo / GitHub Pages) — to verify during build: Chrome's restrictions on off-store force-install for non-domain-joined machines; fallback is publishing as an unlisted Web Store / Edge Add-ons item.
- Same policy step disables Incognito/InPrivate (`IncognitoModeAvailability=1`, `InPrivateModeAvailability=1`) and forces SafeSearch.

### Adult content (phase 1, no code)

`install.ps1` sets the network adapters' DNS to Cloudflare Families (`1.1.1.3`, `1.0.0.3`), disables DNS-over-HTTPS overrides in browsers via policy, forces SafeSearch/YouTube Restricted. Tamper detection of DNS changes comes in phase 4.

### Backend (Supabase, schema `childmonitor`)

Tables (all with RLS: `select` only for `is_admin()`; no direct inserts from `anon`):

- `children` (id, name, color)
- `devices` (id, child_id, name, token_hash, created_at, last_seen_at, agent_version)
- `device_users` (device_id, sid, win_user, is_admin, supervised, first_seen_at) — every Windows account the agent finds on the laptop
- `app_sessions` (id, device_id, win_user, process, exe_path, title, started_at, ended_at)
- `web_sessions` (id, device_id, win_user, browser, url, domain, title, started_at, ended_at)
- `device_events` (id, device_id, win_user, kind [logon|logoff|lock|unlock|idle|active|heartbeat|agent_start|shutdown|suspend|resume|browser_blocked], detail jsonb, at)

Ingest: `rpc ingest(token text, batch jsonb)` — `security definer`, callable by `anon`, looks up the device by `sha256(token)`, rejects unknown/revoked tokens, inserts rows, updates `last_seen_at`. Devices never get read access.

Pairing: in the dashboard, "Add laptop" → pick child, name it → creates the device and shows a one-time token. Itai runs `install.ps1 -Token <token>` as admin on the laptop. Revoking = delete/reset token in dashboard.

Retention: raw sessions kept 90 days (scheduled `pg_cron` delete if available on the project; otherwise delete on ingest). Window titles can be long — truncate to 300 chars.

### Dashboard (web)

- Google login; non-admin sees "no access".
- **Home:** one card per child — today's screen time, top 3 apps, top 3 sites, "last seen" (red if a laptop hasn't reported in > 30 min while it should be on, i.e. no heartbeat).
- **Child page:** date picker; screen time by hour (bar chart); time per app; time per domain; timeline list (app/site sessions in order); filter by Windows account.
- **Settings:** children, devices (add/pair/revoke), and per laptop the list of Windows accounts with a **Supervised** on/off switch each (admin accounts marked "admin").
- Times shown in Asia/Jerusalem.

## Phases

1. **Monitoring** — everything above.
2. **Alerts** — rules evaluated on ingest: blocked-domain attempts (via DNS block page / extension), first-seen apps, use after bedtime, keyword match in URL/title (keyword list editable in dashboard). Alerts list in dashboard.
3. **Limits** — dashboard-set daily limit and bedtime per child; app/site blocklist. Agent pulls policy (`rpc get_policy(token)`), Helper warns at 5 min left, service locks the session at limit; extension blocks listed sites; service kills blocked processes. Parent can grant extra time from dashboard.
4. **Hardening & notifications** — detect agent stop / DNS change / extension missing / clock tampering; email or push notifications to Itai; MSI installer and auto-update.

## Decided

- Approach A (C#). Machine-wide, laptop → child mapping. Shared Supabase project. GitHub Pages + Google login. One monorepo.

## Itai's answers (review round)

- **Windows edition: mixed / unknown → design for Home.** No AppLocker/WDAC dependency; app control is done by the service.
- **Extension distribution:** laptops are unmanaged, so Chrome/Edge won't force-install off-store extensions. Publish as **unlisted** items on Chrome Web Store and Edge Add-ons (in phase 1), force-install by store ID via HKLM policy.
- **Other browsers: kill in phase 1.** Service watches process starts (WMI `Win32_ProcessStartTrace`) and kills any known browser that isn't Chrome/Edge (by exe name + file description: firefox, brave, opera, vivaldi, tor, etc.), logs a `browser_blocked` event shown in the dashboard. List is editable later (phase 3 blocklist).
- **Testing:** a spare Windows PC is available — build and test there first, then install on the kids' laptops.

- **Per-account supervision (Itai, 2026-11-18):** the super admin (Itai, the dashboard's Google admin) turns supervision on/off per Windows account per laptop, **including admin accounts**. The agent reports every local account (SID, name, is-admin) to `device_users`. Default for a newly found account: supervised if standard, not supervised if admin; Itai can flip either. Unsupervised accounts get no Helper and no browser killing. The supervised list comes back in each `ingest` response and is cached on disk, so it applies offline. Machine-wide protections (family DNS, browser policies, force-installed extension) stay on for every account — they can't be scoped per user cheaply. Note: a child who is a Windows admin can stop the service; supervising an admin account monitors it but can't make it tamper-proof.

## Builder's calls (from review, Itai can override)

- **"Last seen" rule:** service also reports `shutdown`, `suspend`, `resume` in `device_events`. Dashboard turns red only when there's no heartbeat for 30 min *and* the last event wasn't a clean shutdown/suspend.
- **No code-signing certificate** in phase 1; `install.ps1` adds a Defender exclusion for `C:\Program Files\ChildMonitor`. Revisit with the MSI in phase 4.

## Left to the builder

- Exact .NET packaging (single-file vs. folder), SQLite library, chart library for the dashboard (prefer none / small).
- Batch size, polling intervals (defaults above are starting points).
- How to test the Windows parts without a Windows machine in CI (unit-test pure logic on any OS; Win32 integration tested on the laptops).

## Change (Itai, 2026-11-18): service instead of browser extension

The extension is dropped (no store publishing, no extension IDs). Sites come from the service:

- The Helper already reports the foreground window title. When it is Chrome or Edge, the service matches that title to the newest visit in that account's browser history (`<profile>\AppData\Local\{Google\Chrome|Microsoft\Edge}\User Data\<any profile>\History`, read-only with SQLite `immutable=1`) whose page title is the longest prefix of the window title. That gives the URL; start/end are the app session's, so time per site is foreground time.
- Unmatched titles (history not saved yet) are retried for 3 minutes, then dropped. Pages with an empty or generic title may match the wrong visit or none.
- Policy `AllowDeletingBrowserHistory=0` (Chrome + Edge) keeps history; Incognito/InPrivate/Guest stay off.
- Phase 3 site blocking uses the browsers' `URLBlocklist` policy instead of the extension.
