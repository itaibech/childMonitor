#Requires -RunAsAdministrator
<# Reverses install.ps1: service, files, policies (only values we set), native host, DNS, Defender exclusion. #>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ServiceName = 'ChildMonitorSvc'
$HostName = 'com.itaibech.childmonitor'
$InstallDir = Join-Path $env:ProgramFiles 'ChildMonitor'
$DataDir = Join-Path $env:ProgramData 'ChildMonitor'
$ChromeRoot = 'HKLM:\SOFTWARE\Policies\Google\Chrome'
$EdgeRoot = 'HKLM:\SOFTWARE\Policies\Microsoft\Edge'
$ChromeUpdateUrl = 'https://clients2.google.com/service/update2/crx'
$EdgeUpdateUrl = 'https://edge.microsoft.com/extensionwebstorebase/v1/crx'

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

function Remove-Forcelist([string]$Root, [string]$UpdateUrl) {
    $key = "$Root\ExtensionInstallForcelist"
    if (-not (Test-Path $key)) { return }
    $item = Get-ItemProperty -Path $key
    # Only remove value "1" if it is ours (carries the store update URL).
    if (($item.PSObject.Properties.Name -contains '1') -and ($item.'1' -like "*;$UpdateUrl")) {
        Remove-ItemProperty -Path $key -Name '1'
    }
}

function Remove-MachinePolicies {
    $common = 'ForceGoogleSafeSearch', 'ForceYouTubeRestrict', 'DnsOverHttpsMode'
    foreach ($n in ($common + 'IncognitoModeAvailability')) { Remove-PolicyValue $ChromeRoot $n }
    foreach ($n in ($common + 'InPrivateModeAvailability', 'ForceBingSafeSearch')) { Remove-PolicyValue $EdgeRoot $n }
    Remove-Forcelist $ChromeRoot $ChromeUpdateUrl
    Remove-Forcelist $EdgeRoot $EdgeUpdateUrl
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
    Get-Process -Name 'Helper' -ErrorAction SilentlyContinue | Stop-Process -Force
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
