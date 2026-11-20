# Installer

Windows PowerShell 5.1+, run from an elevated prompt.

```powershell
.\build.ps1                                   # publishes Service + Helper into installer\out (needs .NET 8 SDK)
.\install.ps1 -Token <64 hex>
.\uninstall.ps1
```

`install.ps1` is idempotent (re-run to upgrade).

Releases: bump `version` and `date` in the repo-root `version.json` whenever the agent changes. The build stamps it into Core.dll (sent on every upload, shown in Diagnostics), and the website uses it to flag laptops that run an older service.

Installed: `C:\Program Files\ChildMonitor` (`ChildMonitorService.exe`, `Helper.exe`),
`C:\ProgramData\ChildMonitor\config.json` (SYSTEM + Administrators only), service `ChildMonitorSvc`, Chrome/Edge policies
(including `AllowDeletingBrowserHistory=0`, which keeps the history the service reads), DNS `1.1.1.3`/`1.0.0.3`/`2606:4700:4700::1113`/`2606:4700:4700::1003` on up physical adapters,
Defender exclusion for the install dir.

Phase-4 hardening (not done): Windows OS-level DoH settings are left untouched (only the browsers' `DnsOverHttpsMode=off` policy is set), and adapters that come up after install (new USB/Wi-Fi adapters) are not covered. Re-run `install.ps1` to apply DNS to new adapters.

## Manual verification (spare PC, standard user `testkid`)

Run `install.ps1` as admin with a token from the dashboard, then:

- `Get-Service ChildMonitorSvc` is Running.
- As testkid, `sc stop ChildMonitorSvc` gives Access denied.
- `Stop-Process -Name Helper` (as testkid session) -> Helper is back within 30 s.
- `nslookup pornhub.com` returns `0.0.0.0`.
- Launching a portable Firefox closes immediately and a `browser_blocked` row appears in the dashboard.
- `chrome://policy` (and `edge://policy`) list the policies, including `BrowserGuestModeEnabled = 0` (no Guest profile in the profile menu).
- As testkid, visit a site in Chrome and use an app (e.g. Notepad) for a minute: within 2 minutes both the site visit and
  the app session appear in the dashboard for testkid. This proves the pipe impersonation identifies the client even
  though the Helper closes its connection right after writing, and that the service can read Chrome's History file
  while Chrome is open (if sites never appear, check the service log for "History read failed", and that
  `%LOCALAPPDATA%\Google\Chrome\User Data\Default` has `History-journal`, not `History-wal`: a WAL file would hide
  the newest visits from the service).
- Repeat in Edge with several tabs open (window title "… and N more pages - Microsoft Edge"): the site still appears.
- As testkid, Chrome > History > "Delete browsing data" is greyed out / blocked by the administrator.
- Settings lists testkid (supervised) and the admin account (admin badge, not supervised); admin activity is absent.
- Turn on the admin account's switch -> within ~2 min its activity appears and Firefox is killed for it too.
- Turn testkid off -> its activity stops within ~2 min.
- Run `uninstall.ps1`: service gone, `C:\Program Files\ChildMonitor` and `C:\ProgramData\ChildMonitor` removed, DNS back to DHCP, policies gone in `chrome://policy`.

### Offline time

1. In Settings → Offline time, turn it on for the child with a window that includes now (e.g. From 00:00 Until 23:59). Save.
2. Within 5 minutes (next upload), with the child signed in at the screen: web pages stop loading. The child's timeline
   shows "Internet off for the night".
3. Switch user to the parent account: within 30 s the internet works again. Switch back: off again.
4. Turn offline time off in Settings: within 5 minutes the internet is back and the timeline shows "Internet back on".
5. Diagnostics report, "Offline time" section: shows the schedule and `Policy ... BlockInbound,BlockOutbound` while off.

### Time limits

1. In Settings → Time limits, give the child a 15-minute limit on an app they use (e.g. `notepad.exe`).
2. Signed in as the child, use that app: after ~10 minutes a "5 minutes left" message appears; at 15 minutes the app
   closes and closes again if reopened. The child's timeline shows both.
3. On the child's Today page press +15m: within a minute the app opens again. "Undo extra" takes it back.
4. Restart the laptop: today's count carries on (`C:\ProgramData\ChildMonitor\usage-today.json`), and the limits
   still apply with the internet off (`limits.json`).
