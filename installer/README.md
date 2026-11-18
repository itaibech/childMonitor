# Installer

Windows PowerShell 5.1+, run from an elevated prompt.

```powershell
.\build.ps1                                   # publishes Service + Helper into installer\out (needs .NET 8 SDK)
.\install.ps1 -Token <64 hex> [-ChromeExtId <32 chars a-p>] [-EdgeExtId <32 chars a-p>]
.\uninstall.ps1
```

`install.ps1` is idempotent (re-run to upgrade). Without an extension id the browser is not given the force-install
policy and is not allowed in the native host manifest; a warning is printed.

Installed: `C:\Program Files\ChildMonitor` (`ChildMonitorService.exe`, `Helper.exe`, `NativeHost.cmd`, `native-host.json`),
`C:\ProgramData\ChildMonitor\config.json` (SYSTEM + Administrators only), service `ChildMonitorSvc`, Chrome/Edge policies,
native host registry keys, DNS `1.1.1.3`/`1.0.0.3`/`2606:4700:4700::1113`/`2606:4700:4700::1003` on up physical adapters,
Defender exclusion for the install dir.

Phase-4 hardening (not done): Windows-level DoH settings are left untouched; only the browsers' `DnsOverHttpsMode=off` policy is set.

## Manual verification (spare PC, standard user `testkid`)

Run `install.ps1` as admin with a token from the dashboard, then:

- `Get-Service ChildMonitorSvc` is Running.
- As testkid, `sc stop ChildMonitorSvc` gives Access denied.
- `Stop-Process -Name Helper` (as testkid session) -> Helper is back within 30 s.
- `nslookup pornhub.com` returns `0.0.0.0`.
- Launching a portable Firefox closes immediately and a `browser_blocked` row appears in the dashboard.
- `chrome://policy` (and `edge://policy`) list the policies.
- Settings lists testkid (supervised) and the admin account (admin badge, not supervised); admin activity is absent.
- Turn on the admin account's switch -> within ~2 min its activity appears and Firefox is killed for it too.
- Turn testkid off -> its activity stops within ~2 min.
- Run `uninstall.ps1`: service gone, `C:\Program Files\ChildMonitor` and `C:\ProgramData\ChildMonitor` removed, DNS back to DHCP, policies gone in `chrome://policy`.
