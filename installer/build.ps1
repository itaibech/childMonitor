#Requires -Version 5.1
# Publishes Service + Helper (single-file, self-contained, win-x64) into installer\out.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $PSScriptRoot 'out'

function Publish-Project([string]$project) {
    dotnet publish (Join-Path $root $project) -c Release -r win-x64 --self-contained `
        -p:PublishSingleFile=true -o $out
    if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed for $project" }
}

if (Test-Path $out) { Remove-Item $out -Recurse -Force }
Publish-Project 'agent\Service'
Publish-Project 'agent\Helper'

foreach ($f in 'ChildMonitorService.exe', 'Helper.exe') {
    if (-not (Test-Path (Join-Path $out $f))) { throw "Missing $f in $out" }
}
Write-Host "Built into $out"
