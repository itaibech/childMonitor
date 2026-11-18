#Requires -RunAsAdministrator
<# Reverses install.ps1: service, files, policies (only values we set), native host, DNS, Defender exclusion. #>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ServiceName = 'ChildMonitorSvc'
$HostName = 'com.itaibech.childmonitor'
if (-not [Environment]::Is64BitProcess) { throw 'Run from 64-bit PowerShell' }

$InstallDir = 'C:\Program Files\ChildMonitor'
$DataDir = 'C:\ProgramData\ChildMonitor'
$StateKey = 'HKLM:\SOFTWARE\ChildMonitor'
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

function Get-RecordedId([string]$Name) {
    if (-not (Test-Path $StateKey)) { return '' }
    $p = Get-ItemProperty -Path $StateKey
    if ($p.PSObject.Properties.Name -contains $Name) { return [string]$p.$Name }
    return ''
}

# Remove only forcelist values whose data starts with the id we recorded at install.
function Remove-Forcelist([string]$Root, [string]$ExtId) {
    $key = "$Root\ExtensionInstallForcelist"
    if ((-not $ExtId) -or (-not (Test-Path $key))) { return }
    foreach ($n in (Get-Item -Path $key).Property) {
        $v = [string](Get-ItemProperty -Path $key -Name $n).$n
        if ($v.StartsWith("$ExtId;")) { Remove-ItemProperty -Path $key -Name $n }
    }
}

function Remove-MachinePolicies {
    $common = 'ForceGoogleSafeSearch', 'ForceYouTubeRestrict', 'DnsOverHttpsMode'
    foreach ($n in ($common + 'IncognitoModeAvailability')) { Remove-PolicyValue $ChromeRoot $n }
    foreach ($n in ($common + 'InPrivateModeAvailability', 'ForceBingSafeSearch')) { Remove-PolicyValue $EdgeRoot $n }
    Remove-Forcelist $ChromeRoot (Get-RecordedId 'ChromeExtId')
    Remove-Forcelist $EdgeRoot (Get-RecordedId 'EdgeExtId')
    if (Test-Path $StateKey) { Remove-Item -Path $StateKey -Recurse -Force }
}

function Remove-NativeHost {
    foreach ($base in 'HKLM:\SOFTWARE\Google\Chrome\NativeMessagingHosts', 'HKLM:\SOFTWARE\Microsoft\Edge\NativeMessagingHosts') {
        $key = Join-Path $base $HostName
        if (Test-Path $key) { Remove-Item -Path $key -Recurse -Force }
    }
}

function Reset-AdapterDns {
    foreach ($a in (Get-NetAdapter -Physical)) {
        Set-DnsClientServerAddress -InterfaceIndex $a.ifIndex -ResetServerAddresses
    }
}

function Remove-DefenderExclusion {
    try { Remove-MpPreference -ExclusionPath $InstallDir }
    catch { Write-Warning "Could not remove Defender exclusion: $_" }
}

function Remove-AgentFiles {
    Get-Process -Name 'Helper' -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -like "$InstallDir\\*" } | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
    foreach ($dir in $InstallDir, $DataDir) {
        if (Test-Path $dir) { Remove-Item -Path $dir -Recurse -Force }
    }
}

Remove-AgentService
Remove-MachinePolicies
Remove-NativeHost
Reset-AdapterDns
Remove-DefenderExclusion
Remove-AgentFiles
Write-Host 'Child Monitor uninstalled. If the service was just deleted, a reboot may be needed to fully clear it.'
