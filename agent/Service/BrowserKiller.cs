using System.Diagnostics;
using System.Management;
using Core;
using Microsoft.Extensions.Logging;

namespace Service;

/// <summary>Kills blocklisted browsers started in supervised users' sessions and reports browser_blocked.</summary>
internal sealed class BrowserKiller(
    SessionLauncher sessions, Func<IReadOnlySet<string>> supervised, Action<QueueItem> enqueue,
    ILogger<BrowserKiller> log) : IDisposable
{
    private static readonly TimeSpan ReportEvery = TimeSpan.FromSeconds(30);

    private readonly Dictionary<(string, string), DateTimeOffset> _lastReport = new();
    private ManagementEventWatcher? _watcher;

    public void Start()
    {
        _watcher = new ManagementEventWatcher(new WqlEventQuery("SELECT * FROM Win32_ProcessStartTrace"));
        _watcher.EventArrived += (_, e) => OnStart(e.NewEvent);
        _watcher.Start();
    }

    /// <summary>Fallback sweep (watcher can miss events): kill blocked browsers already running.</summary>
    public void Sweep()
    {
        foreach (var p in Process.GetProcesses())
        {
            using (p)
            {
                try { Handle(p.ProcessName + ".exe", p.Id, p.SessionId); }
                catch (InvalidOperationException) { /* exited */ }
            }
        }
    }

    private void OnStart(ManagementBaseObject e)
    {
        try
        {
            using (e) Handle((string)e["ProcessName"], (int)(uint)e["ProcessID"], (int)(uint)e["SessionID"]);
        }
        catch (Exception ex) { log.LogWarning(ex, "Process start handling failed"); }
    }

    private void Handle(string exe, int pid, int sessionId)
    {
        if (!BrowserBlocklist.IsBlocked(exe)) return;
        var user = sessions.UserOf(sessionId);
        if (user is null || !supervised().Contains(user.Sid)) return;
        try
        {
            using var p = Process.GetProcessById(pid);
            p.Kill();
        }
        catch (Exception e) when (e is ArgumentException or InvalidOperationException
                                      or System.ComponentModel.Win32Exception) { return; }
        Report(user.WinUser, exe.ToLowerInvariant());
    }

    /// <summary>One browser launch spawns many processes; report at most once per user+exe per 30 s.</summary>
    private void Report(string winUser, string exe)
    {
        var now = DateTimeOffset.UtcNow;
        lock (_lastReport)
        {
            if (_lastReport.TryGetValue((winUser, exe), out var last) && now - last < ReportEvery) return;
            _lastReport[(winUser, exe)] = now;
        }
        enqueue(ServiceRows.BrowserBlocked(winUser, exe, now, Guid.NewGuid().ToString()));
    }

    public void Dispose()
    {
        _watcher?.Stop();
        _watcher?.Dispose();
    }
}
