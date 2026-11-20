using System.Collections.Concurrent;
using System.Diagnostics;
using System.Management;
using Core;
using Microsoft.Extensions.Logging;

namespace Service;

/// <summary>
/// Kills blocklisted browsers (by exe name or PE OriginalFilename) started in supervised users' sessions and
/// reports browser_blocked. Also kills apps whose time limit ran out today (<paramref name="overLimit"/>; the
/// limit enforcer reports those).
/// </summary>
internal sealed class BrowserKiller(
    SessionLauncher sessions, Func<IReadOnlySet<string>> supervised, Action<QueueItem> enqueue,
    Func<string, bool> overLimit, ILogger<BrowserKiller> log) : IDisposable
{
    private static readonly TimeSpan ReportEvery = TimeSpan.FromSeconds(30);

    private readonly Dictionary<(string, string), DateTimeOffset> _lastReport = new();
    private readonly ConcurrentDictionary<string, string> _originalNames = new(StringComparer.OrdinalIgnoreCase);
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
        var users = new Dictionary<int, SessionUser?>();
        foreach (var p in Process.GetProcesses())
        {
            using (p)
            {
                try
                {
                    if (!users.TryGetValue(p.SessionId, out var user))
                        users[p.SessionId] = user = SupervisedUser(p.SessionId);
                    if (user is not null) Handle(p.ProcessName + ".exe", p.Id, user);
                }
                catch (InvalidOperationException) { /* exited */ }
            }
        }
    }

    private void OnStart(ManagementBaseObject e)
    {
        try
        {
            using (e)
            {
                var user = SupervisedUser((int)(uint)e["SessionID"]);
                if (user is not null) Handle((string)e["ProcessName"], (int)(uint)e["ProcessID"], user);
            }
        }
        catch (Exception ex) { log.LogWarning(ex, "Process start handling failed"); }
    }

    private SessionUser? SupervisedUser(int sessionId)
    {
        var user = sessions.UserOf(sessionId);
        return user is not null && supervised().Contains(user.Sid) ? user : null;
    }

    private void Handle(string exe, int pid, SessionUser user)
    {
        var limited = overLimit(exe);
        if (!limited && !IsBlocked(exe, pid)) return;
        try
        {
            using var p = Process.GetProcessById(pid);
            var now = p.ProcessName + ".exe";
            if (limited ? !overLimit(now) : !IsBlocked(now, pid)) return; // PID reused since the event
            p.Kill();
        }
        catch (Exception e) when (e is ArgumentException or InvalidOperationException
                                      or System.ComponentModel.Win32Exception) { return; }
        if (!limited) Report(user.WinUser, exe.ToLowerInvariant());
    }

    private bool IsBlocked(string exe, int pid) =>
        BrowserBlocklist.IsBlocked(exe) || BrowserBlocklist.IsBlocked(exe, OriginalFilename(pid));

    /// <summary>PE OriginalFilename of the process image, cached per path (failures are retried); null if unknown.</summary>
    private string? OriginalFilename(int pid)
    {
        var path = Native.ImagePath(pid);
        if (path is null) return null;
        if (_originalNames.TryGetValue(path, out var known)) return known;
        try
        {
            var name = FileVersionInfo.GetVersionInfo(path).OriginalFilename ?? "";
            _originalNames[path] = name;
            return name;
        }
        catch (Exception e) when (e is FileNotFoundException or IOException or UnauthorizedAccessException)
        {
            return null;
        }
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
