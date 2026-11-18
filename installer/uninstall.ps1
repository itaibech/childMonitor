#Requires -RunAsAdministrator
<# Reverses install.ps1: service, files, policies (only values we set), DNS, Defender exclusion. #>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ServiceName = 'ChildMonitorSvc'
if (-not [Environment]::Is64BitProcess) { throw 'Run from 64-bit PowerShell' }

$InstallDir = 'C:\Program Files\ChildMonitor'
$DataDir = 'C:\ProgramData\ChildMonitor'
$ChromeRoot = 'HKLM:\SOFTWARE\Policies\Google\Chrome'
$EdgeRoot = 'HKLM:\SOFTWARE\Policies\Microsoft\Edge'

function Remove-AgentService {
    $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if (-not $svc) { return }
    if ($svc.Status -ne 'Stopped') {
        Stop-Service -Name $ServiceName -Force
        $svc.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30))
    }
    & sc.exe delete $ServiceName | Out-Null
    if ($LASTEXITCODE -ne 0) { Write-Warning "sc.exe delete exited with $LASTEXITCODE" }
}

function Remove-PolicyValue([string]$Path, [string]$Name) {
    if (Test-Path $Path) { Remove-ItemProperty -Path $Path -Name $Name -ErrorAction SilentlyContinue }
}

function Remove-MachinePolicies {
    $common = 'ForceGoogleSafeSearch', 'ForceYouTubeRestrict', 'DnsOverHttpsMode', 'BrowserGuestModeEnabled',
        'AllowDeletingBrowserHistory'
    foreach ($n in ($common + 'IncognitoModeAvailability')) { Remove-PolicyValue $ChromeRoot $n }
    foreach ($n in ($common + 'InPrivateModeAvailability', 'ForceBingSafeSearch')) { Remove-PolicyValue $EdgeRoot $n }
}

function Reset-AdapterDns {
    foreach ($a in (Get-NetAdapter -Physical)) {
        Set-DnsClientServerAddress -InterfaceIndex $a.ifIndex -ResetServerAddresses
    }
}

# Undo offline time: internet back on, and the service's allow rules gone.
function Remove-OfflineTime {
    & netsh.exe advfirewall set allprofiles firewallpolicy blockinbound,allowoutbound | Out-Null
    Get-NetFirewallRule -Group 'Child Monitor' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
}

function Remove-DefenderExclusion {
    try { Remove-MpPreference -ExclusionPath $InstallDir }
    catch { Write-Warning "Could not remove Defender exclusion: $_" }
}

function Remove-AgentFiles {
    Get-Process -Name 'Helper' -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -like "$InstallDir\*" } | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
    foreach ($dir in $InstallDir, $DataDir) {
        if (Test-Path $dir) { Remove-Item -Path $dir -Recurse -Force }
    }
}

Remove-AgentService
Remove-MachinePolicies
Reset-AdapterDns
Remove-OfflineTime
Remove-DefenderExclusion
Remove-AgentFiles
Write-Host 'Child Monitor uninstalled. If the service was just deleted, a reboot may be needed to fully clear it.'
