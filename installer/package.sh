#!/usr/bin/env bash
# Builds installer/dist/ChildMonitor.zip (Service + Helper for win-x64, install/uninstall scripts) on macOS/Linux.
# Upload it on the dashboard's Download page.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
root=$(dirname "$here")
stage=$(mktemp -d)
mkdir -p "$stage/out" "$here/dist"
for p in Service Helper; do
  dotnet publish "$root/agent/$p" -c Release -r win-x64 --self-contained -p:DebugType=none -o "$stage/out" >/dev/null
done
for f in ChildMonitorService.exe Helper.exe e_sqlite3.dll; do [[ -f $stage/out/$f ]] || { echo "missing $f" >&2; exit 1; }; done
cp "$here/install.ps1" "$here/uninstall.ps1" "$here/README.md" "$stage/"
rm -f "$here/dist/ChildMonitor.zip"
# No top folder: Windows "Extract All" already creates Downloads\ChildMonitor, so install.ps1 lands right there.
(cd "$stage" && zip -qr9 "$here/dist/ChildMonitor.zip" .)
size=$(wc -c < "$here/dist/ChildMonitor.zip")
(( size < 50 * 1024 * 1024 )) || { echo "zip is $size bytes, over the 50 MB upload limit" >&2; exit 1; }
echo "version $(tr -d "\n" < "$root/version.json")"
echo "built $here/dist/ChildMonitor.zip ($((size / 1024 / 1024)) MB)"
