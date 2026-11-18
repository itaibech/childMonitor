#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Installs the Child Monitor agent on this laptop. Idempotent: safe to re-run to upgrade.
.PARAMETER Token
  64-hex-char pairing token from the dashboard.
#>
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[0-9a-fA-F]{64}$')]
    [string]$Token,
    [ValidatePattern('^[a-p]{32}$')]
    [string]$ChromeExtId = '',
    [ValidatePattern('^[a-p]{32}$')]
    [string]$EdgeExtId = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ServiceName = 'ChildMonitorSvc'
$HostName = 'com.itaibech.childmonitor'
$InstallDir = Join-Path $env:ProgramFiles 'ChildMonitor'
$DataDir = Join-Path $env:ProgramData 'ChildMonitor'
$SourceDir = Join-Path $PSScriptRoot 'out'
$SupabaseUrl = 'https://hyeslwlewvvjiyizoduf.supabase.co'
# Publishable key: public by design, RLS protects the data.
$ApiKey = 'sb_publishable_de6tynv8AkIVfS9U5HYxyA_8NMR4tLo'
$DnsServers = @('1.1.1.3', '1.0.0.3', '2606:4700:4700::1113', '2606:4700:4700::1003')
$ChromeUpdateUrl = 'https://clients2.google.com/service/update2/crx'
$EdgeUpdateUrl = 'https://edge.microsoft.com/extensionwebstorebase/v1/crx'

# Service ACL (SDDL). Rights: CC query config, DC change config, LC query status, SW enumerate
# dependents, RP start, WP stop, DT pause, LO interrogate, CR user control, SD delete,
# RC read control, WD change DACL, WO change owner.
#   SY (SYSTEM):          query/start/stop/pause, no config change or delete
#   BA (Administrators):  full control
#   IU (Interactive) and SU (Service): query only -- standard users can see status but not stop
$ServiceSddl = 'D:(A;;CCLCSWRPWPDTLOCRRC;;;SY)(A;;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;BA)(A;;CCLCSWLOCRRC;;;IU)(A;;CCLCSWLOCRRC;;;SU)'

function Invoke-Sc([string[]]$ScArgs) {
    & sc.exe @ScArgs | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "sc.exe $($ScArgs -join ' ') failed with exit code $LASTEXITCODE" }
}

function Stop-AgentIfRunning {
    $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if ($svc -and $svc.Status -ne 'Stopped') {
        Stop-Service -Name $ServiceName -Force
        $svc.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30))
    }
    Get-Process -Name 'Helper' -ErrorAction SilentlyContinue | Stop-Process -Force
}

function Copy-AgentFiles {
    foreach ($f in 'ChildMonitorService.exe', 'Helper.exe') {
        if (-not (Test-Path (Join-Path $SourceDir $f))) {
            throw "Missing $f in $SourceDir. Run installer\build.ps1 first."
        }
    }
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    Copy-Item -Path (Join-Path $SourceDir '*') -Destination $InstallDir -Recurse -Force
}

function Write-AgentConfig {
    New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
    # SYSTEM (S-1-5-18) + Administrators (S-1-5-32-544) only; drop inherited ACEs.
    & icacls.exe $DataDir /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "icacls failed with exit code $LASTEXITCODE" }
    $json = [ordered]@{ token = $Token; supabaseUrl = $SupabaseUrl; apiKey = $ApiKey } | ConvertTo-Json
    [System.IO.File]::WriteAllText((Join-Path $DataDir 'config.json'), $json, (New-Object System.Text.UTF8Encoding($false)))
}

function Install-AgentService {
    $exe = Join-Path $InstallDir 'ChildMonitorService.exe'
    $binPath = '"' + $exe + '"'
    $exists = [bool](Get-Service -Name $ServiceName -ErrorAction SilentlyContinue)
    $verb = 'create'
    if ($exists) { $verb = 'config' }
    # sc.exe needs "name= value" as two args (space after '='); the inner quotes protect the space in "Program Files".
    Invoke-Sc @($verb, $ServiceName, 'binPath=', $binPath, 'start=', 'auto', 'DisplayName=', 'Child Monitor')
    Invoke-Sc @('failure', $ServiceName, 'reset=', '0', 'actions=', 'restart/5000/restart/5000/restart/5000')
    Invoke-Sc @('sdset', $ServiceName, $ServiceSddl)
    $image = (Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Services\$ServiceName").ImagePath
    if ($image -ne $binPath) { throw "Service ImagePath mismatch: $image" }
}

function Write-NativeHost {
    $cmd = Join-Path $InstallDir 'NativeHost.cmd'
    Set-Content -Path $cmd -Value @('@echo off', '"%~dp0Helper.exe" --native-host %*') -Encoding Ascii
    $ids = @($ChromeExtId, $EdgeExtId) | Where-Object { $_ }
    $origins = ($ids | ForEach-Object { '"chrome-extension://' + $_ + '/"' }) -join ', '
    $template = Get-Content -Raw -Path (Join-Path $PSScriptRoot 'native-host.json')
    $manifest = $template.Replace('__PATH__', $cmd.Replace('\', '\\')).Replace('__ORIGINS__', $origins)
    $manifestPath = Join-Path $InstallDir 'native-host.json'
    [System.IO.File]::WriteAllText($manifestPath, $manifest, (New-Object System.Text.UTF8Encoding($false)))
    foreach ($base in 'HKLM:\SOFTWARE\Google\Chrome\NativeMessagingHosts', 'HKLM:\SOFTWARE\Microsoft\Edge\NativeMessagingHosts') {
        $key = Join-Path $base $HostName
        New-Item -Path $key -Force | Out-Null
        Set-ItemProperty -Path $key -Name '(default)' -Value $manifestPath
    }
}

function Set-PolicyValue([string]$Path, [string]$Name, $Value, [string]$Type) {
    New-Item -Path $Path -Force | Out-Null
    New-ItemProperty -Path $Path -Name $Name -Value $Value -PropertyType $Type -Force | Out-Null
}

function Set-BrowserPolicy([string]$Root, [string]$ExtId, [string]$UpdateUrl, [hashtable]$Dwords) {
    foreach ($name in $Dwords.Keys) { Set-PolicyValue $Root $name $Dwords[$name] 'DWord' }
    # DnsOverHttpsMode is a string policy, not a DWord.
    Set-PolicyValue $Root 'DnsOverHttpsMode' 'off' 'String'
    if ($ExtId) {
        Set-PolicyValue "$Root\ExtensionInstallForcelist" '1' "$ExtId;$UpdateUrl" 'String'
    }
}

function Set-MachinePolicies {
    Set-BrowserPolicy 'HKLM:\SOFTWARE\Policies\Google\Chrome' $ChromeExtId $ChromeUpdateUrl @{
        IncognitoModeAvailability = 1; ForceGoogleSafeSearch = 1; ForceYouTubeRestrict = 1
    }
    Set-BrowserPolicy 'HKLM:\SOFTWARE\Policies\Microsoft\Edge' $EdgeExtId $EdgeUpdateUrl @{
        InPrivateModeAvailability = 1; ForceBingSafeSearch = 2; ForceGoogleSafeSearch = 1; ForceYouTubeRestrict = 1
    }
}

function Set-AdapterDns {
    $adapters = Get-NetAdapter -Physical | Where-Object { $_.Status -eq 'Up' }
    foreach ($a in $adapters) {
        Set-DnsClientServerAddress -InterfaceIndex $a.ifIndex -ServerAddresses $DnsServers
        Write-Host "DNS set on adapter: $($a.Name)"
    }
}

function Add-DefenderExclusion {
    try { Add-MpPreference -ExclusionPath $InstallDir }
    catch { Write-Warning "Could not add Defender exclusion (is another antivirus active?): $_" }
}

function Show-Warnings {
    if (-not $ChromeExtId) { Write-Warning 'ChromeExtId not provided: Chrome extension is NOT force-installed and not allowed by the native host.' }
    if (-not $EdgeExtId) { Write-Warning 'EdgeExtId not provided: Edge extension is NOT force-installed and not allowed by the native host.' }
}

Show-Warnings
Stop-AgentIfRunning
Copy-AgentFiles
Write-AgentConfig
Install-AgentService
Write-NativeHost
Set-MachinePolicies
Set-AdapterDns
Add-DefenderExclusion
Start-Service -Name $ServiceName
Get-Service -Name $ServiceName | Format-Table Name, Status, StartType -AutoSize
