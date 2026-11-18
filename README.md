# childMonitor

Parental monitoring for Windows laptops: a per-device agent uploads app and site usage to Supabase (schema `childmonitor`), and a parent dashboard reads it under RLS (admin only). Components: `agent/` (.NET service + helper; sites come from the Chrome/Edge history files, no browser extension), `web/` (dashboard), `supabase/`, `installer/`.

## Setup

### 1. One-time backend

From `~/GitReposGeneral/itaibechor`:

```bash
SUPABASE_ACCESS_TOKEN=sbp_... scripts/add-app.sh childmonitor 'https://itaibech.github.io/childMonitor/**' -- ../childMonitor/supabase/childmonitor.sql
```

This also adds `https://itaibech.github.io/childMonitor/**` to the Google OAuth redirect allowlist.

Warning: re-running `add-app.sh` re-grants table privileges, so re-apply the SQL afterwards. Either re-run the command above, or from this repo:

```bash
npx supabase db query --remote=hyeslwlewvvjiyizoduf --yes -f supabase/childmonitor.sql
```

### 2. Dashboard deploy

Create the GitHub repo `itaibech/childMonitor`, push, then enable Pages (Settings > Pages > Source: GitHub Actions).

```bash
gh repo create itaibech/childMonitor --public --source . --push
```

The repo must be public: GitHub Pages (free plan) needs it. Only the Supabase publishable key is in the repo; it is public by design and RLS protects the data.

### 3. Per laptop

1. Make each child's Windows account Standard (not admin).
2. Dashboard > Settings > "Add laptop": copy the install command (token filled in).
3. On a Windows machine with the .NET 8 SDK: `installer\build.ps1`.
4. Copy `installer\` to the laptop and run in an elevated 64-bit PowerShell:

   ```powershell
   powershell -ExecutionPolicy Bypass -File install.ps1 -Token <token>
   ```

5. Follow the checklist in [installer/README.md](installer/README.md).
6. Dashboard > Settings: set the Supervised switches per Windows account.

### 4. Uninstall

Elevated PowerShell on the laptop: `powershell -ExecutionPolicy Bypass -File uninstall.ps1`

## Development

```bash
cd web && npm test
cd agent && dotnet test
```

Database tests: `npx supabase start`, load `supabase/local/stub_is_admin.sql` then `supabase/childmonitor.sql` into the local DB (port 55322), then `npx supabase test db`.

## Known limitations (phase 1)

- A child who is a Windows admin can stop the agent; supervising an admin account monitors it but is not tamper-proof.
- OS-level DoH is not covered, and network adapters added after install are not covered until `install.ps1` is re-run.
- Elevated or UWP apps may show as `ApplicationFrameHost` or go untracked.
- Browser blocking matches the exe name and the PE `OriginalFilename`, so a renamed `firefox.exe` is still killed, but a portable Chromium/ungoogled-chromium shipped as `chrome.exe` is not caught until phase 3.
- Sites are found by matching the browser window title to the newest history entry with that page title. Pages with
  generic or empty titles can match the wrong site or none; Chrome/Edge only (other browsers are closed anyway). A page
  shown for under ~3 minutes whose history entry is never saved in that time is not recorded.
- `AllowDeletingBrowserHistory=0` stops clearing history in the browser, but a child signed in to a Google/Microsoft
  account could still delete synced activity online; that does not remove the local file already read.
- Test first on the spare PC before the kids' laptops.
