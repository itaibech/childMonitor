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
    [string]$Token
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ServiceName = 'ChildMonitorSvc'
if (-not [Environment]::Is64BitProcess) { throw 'Run from 64-bit PowerShell' }

$InstallDir = 'C:\Program Files\ChildMonitor'
$DataDir = 'C:\ProgramData\ChildMonitor'
$SourceDir = Join-Path $PSScriptRoot 'out'
$SupabaseUrl = 'https://hyeslwlewvvjiyizoduf.supabase.co'
# Publishable key: public by design, RLS protects the data.
$ApiKey = 'sb_publishable_de6tynv8AkIVfS9U5HYxyA_8NMR4tLo'
$DnsServers = @('1.1.1.3', '1.0.0.3', '2606:4700:4700::1113', '2606:4700:4700::1003')

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
    Get-Process -Name 'Helper' -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -like "$InstallDir\*" } | Stop-Process -Force -ErrorAction SilentlyContinue
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
    # sc.exe strips embedded quotes under PS 5.1, so pass a plain binPath and then set the quoted ImagePath in the registry.
    Invoke-Sc @($verb, $ServiceName, 'binPath=', $exe, 'start=', 'auto', 'DisplayName=', 'Child Monitor')
    $svcKey = "HKLM:\SYSTEM\CurrentControlSet\Services\$ServiceName"
    Set-ItemProperty -Path $svcKey -Name ImagePath -Value $binPath
    Invoke-Sc @('failure', $ServiceName, 'reset=', '0', 'actions=', 'restart/5000/restart/5000/restart/5000')
    Invoke-Sc @('sdset', $ServiceName, $ServiceSddl)
    $image = (Get-ItemProperty $svcKey).ImagePath
    if ($image -ne $binPath) { throw "Service ImagePath mismatch: $image" }
}

# New-Item -Force on an existing key deletes it in PS 5.1, so only create when missing.
function New-Key([string]$Path) {
    if (-not (Test-Path $Path)) { New-Item -Path $Path -Force | Out-Null }
}

function Set-PolicyValue([string]$Path, [string]$Name, $Value, [string]$Type) {
    New-Key $Path
    New-ItemProperty -Path $Path -Name $Name -Value $Value -PropertyType $Type -Force | Out-Null
}

# AllowDeletingBrowserHistory=0 keeps the history the service reads to see which sites were open.
function Set-BrowserPolicy([string]$Root, [hashtable]$Dwords) {
    foreach ($name in $Dwords.Keys) { Set-PolicyValue $Root $name $Dwords[$name] 'DWord' }
    # DnsOverHttpsMode is a string policy, not a DWord.
    Set-PolicyValue $Root 'DnsOverHttpsMode' 'off' 'String'
}

function Set-MachinePolicies {
    Set-BrowserPolicy 'HKLM:\SOFTWARE\Policies\Google\Chrome' @{
        AllowDeletingBrowserHistory = 0; IncognitoModeAvailability = 1; BrowserGuestModeEnabled = 0; ForceGoogleSafeSearch = 1; ForceYouTubeRestrict = 1
    }
    Set-BrowserPolicy 'HKLM:\SOFTWARE\Policies\Microsoft\Edge' @{
        AllowDeletingBrowserHistory = 0; InPrivateModeAvailability = 1; BrowserGuestModeEnabled = 0; ForceBingSafeSearch = 2; ForceGoogleSafeSearch = 1
        ForceYouTubeRestrict = 1
    }
}

function Set-AdapterDns {
    $adapters = Get-NetAdapter -Physical | Where-Object { $_.Status -eq 'Up' }
    foreach ($a in $adapters) {
        Set-DnsClientServerAddress -InterfaceIndex $a.ifIndex -ServerAddresses $DnsServers
        Write-Host "DNS set on adapter: $($a.Name)"
    }
}

# During offline time the service switches the default outbound policy to block; these keep it reporting.
function Set-OfflineRules {
    Get-NetFirewallRule -Group 'Child Monitor' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    $exe = Join-Path $InstallDir 'ChildMonitorService.exe'
    New-NetFirewallRule -DisplayName 'Child Monitor service' -Group 'Child Monitor' -Direction Outbound -Action Allow -Program $exe | Out-Null
    foreach ($proto in 'UDP', 'TCP') {
        New-NetFirewallRule -DisplayName "Child Monitor DNS ($proto)" -Group 'Child Monitor' -Direction Outbound -Action Allow -Protocol $proto -RemotePort 53 | Out-Null
    }
}

function Add-DefenderExclusion {
    try { Add-MpPreference -ExclusionPath $InstallDir }
    catch { Write-Warning "Could not add Defender exclusion (is another antivirus active?): $_" }
}

Stop-AgentIfRunning
Add-DefenderExclusion
Copy-AgentFiles
Write-AgentConfig
Install-AgentService
Set-MachinePolicies
Set-AdapterDns
Set-OfflineRules
Start-Service -Name $ServiceName
Get-Service -Name $ServiceName | Format-Table Name, Status, StartType -AutoSize
