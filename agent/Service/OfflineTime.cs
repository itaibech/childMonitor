using System.Diagnostics;
using System.Runtime.InteropServices;
using Core;
using Microsoft.Extensions.Logging;

namespace Service;

/// <summary>
/// Turns the internet off while a supervised child is the one at the screen during their offline hours, by switching
/// Windows Firewall's default outbound policy to block. install.ps1 adds the allow rules that keep this service and
/// DNS working, so the laptop still reports.
/// </summary>
internal sealed class OfflineTime(SessionLauncher sessions, Func<IReadOnlySet<string>> supervised, Action<string, string> record,
    ILogger<OfflineTime> log)
{
    public const string SchedulePath = @"C:\ProgramData\ChildMonitor\offline.json";
    private const uint NoConsole = 0xFFFFFFFF;

    [DllImport("kernel32.dll")] private static extern uint WTSGetActiveConsoleSessionId();

    private readonly object _gate = new();
    private OfflineSchedule? _schedule = File.Exists(SchedulePath) ? OfflineSchedule.Parse(File.ReadAllText(SchedulePath)) : null;
    private bool? _blocked; // unknown at start: the first Apply always sets the policy, undoing a crash mid-night

    /// <summary>New schedule from the server ("null" when none); kept on disk for when the laptop is offline.</summary>
    public void Update(string json)
    {
        lock (_gate)
        {
            File.WriteAllText(SchedulePath, json);
            _schedule = OfflineSchedule.Parse(json);
        }
        Apply();
    }

    /// <summary>Every 30 s and on session changes: block or allow, and record the switch.</summary>
    public void Apply()
    {
        lock (_gate)
        {
            var session = WTSGetActiveConsoleSessionId();
            var user = session == NoConsole ? null : sessions.UserOf((int)session);
            var want = user is not null && supervised().Contains(user.Sid) && _schedule?.IsOffline(DateTime.Now) == true;
            if (want == _blocked || !SetBlocked(want)) return;
            if (_blocked.HasValue || want) record(want ? "offline_on" : "offline_off", user?.WinUser ?? "");
            _blocked = want;
        }
    }

    private bool SetBlocked(bool on)
    {
        var policy = on ? "blockinbound,blockoutbound" : "blockinbound,allowoutbound";
        using var p = Process.Start(new ProcessStartInfo("netsh.exe", $"advfirewall set allprofiles firewallpolicy {policy}")
            { CreateNoWindow = true, UseShellExecute = false, RedirectStandardOutput = true });
        if (p is null) return false;
        p.StandardOutput.ReadToEnd();
        p.WaitForExit();
        if (p.ExitCode == 0) return true;
        log.LogWarning("Could not switch the firewall {Mode} (netsh exit {Code})", on ? "to offline" : "back online", p.ExitCode);
        return false;
    }
}
