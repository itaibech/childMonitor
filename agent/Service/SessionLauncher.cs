using System.Diagnostics;
using System.Management;
using Core;
using Microsoft.Extensions.Logging;

namespace Service;

internal sealed record SessionUser(string Sid, string WinUser);

/// <summary>Starts/stops the per-user Helper in Windows sessions and remembers who is signed in where.</summary>
internal sealed class SessionLauncher(ILogger<SessionLauncher> log)
{
    public const string HelperPath = @"C:\Program Files\ChildMonitor\Helper.exe";

    private readonly object _gate = new();
    private readonly Dictionary<int, Process> _helpers = new();
    private readonly Dictionary<int, SessionUser> _known = new();

    /// <summary>Current signed-in sessions (id → user).</summary>
    public Dictionary<int, SessionUser> Sessions()
    {
        var result = new Dictionary<int, SessionUser>();
        foreach (var id in Native.SessionIds())
            if (UserOf(id) is { } u) result[id] = u;
        return result;
    }

    /// <summary>Session user, falling back to the last one seen (e.g. while the session is logging off).</summary>
    public SessionUser? UserOf(int sessionId)
    {
        var live = Native.QueryUser(sessionId);
        lock (_gate)
        {
            if (live is not null) _known[sessionId] = live;
            return live ?? _known.GetValueOrDefault(sessionId);
        }
    }

    /// <summary>Apply a supervision change: start/stop Helpers for affected sessions.</summary>
    public void Apply(IReadOnlySet<string> before, IReadOnlySet<string> after)
    {
        var sids = Sessions().ToDictionary(s => s.Key, s => s.Value.Sid);
        var (start, stop) = SupervisionSet.Diff(before, after, sids);
        foreach (var id in stop) Stop(id);
        foreach (var id in start) EnsureRunning(id);
    }

    /// <summary>Periodic check: (re)launch Helpers in supervised sessions, stop all others.</summary>
    public void Reconcile(IReadOnlySet<string> supervised)
    {
        var wanted = Sessions().Where(s => supervised.Contains(s.Value.Sid)).Select(s => s.Key).ToHashSet();
        int[] tracked;
        lock (_gate) tracked = _helpers.Keys.ToArray();
        foreach (var id in tracked.Where(id => !wanted.Contains(id))) Stop(id);
        foreach (var id in wanted) EnsureRunning(id);
    }

    public void EnsureRunning(int sessionId)
    {
        lock (_gate)
        {
            if (_helpers.TryGetValue(sessionId, out var p) && !p.HasExited) return;
            p?.Dispose();
            _helpers.Remove(sessionId);
            var started = Native.LaunchInSession(sessionId, HelperPath);
            if (started is null)
            {
                log.LogWarning("Helper launch failed in session {Session}", sessionId);
                return;
            }
            _helpers[sessionId] = started;
        }
    }

    public void Stop(int sessionId)
    {
        lock (_gate)
        {
            if (!_helpers.Remove(sessionId, out var p)) return;
            Kill(p);
        }
    }

    public void StopAll()
    {
        lock (_gate)
        {
            foreach (var p in _helpers.Values) Kill(p);
            _helpers.Clear();
        }
    }

    /// <summary>Kill trackers left by a previous service instance (their single-instance mutex blocks ours).</summary>
    public void KillOrphans()
    {
        try
        {
            using var search = new ManagementObjectSearcher(
                "SELECT ProcessId, CommandLine FROM Win32_Process WHERE Name = 'Helper.exe'");
            foreach (var mo in search.Get())
            {
                using (mo)
                {
                    if (((string?)mo["CommandLine"] ?? "").Contains("--native-host")) continue;
                    try { Kill(Process.GetProcessById((int)(uint)mo["ProcessId"])); }
                    catch (ArgumentException) { /* already gone */ }
                }
            }
        }
        catch (ManagementException e) { log.LogWarning(e, "Orphan Helper scan failed"); }
    }

    private static void Kill(Process p)
    {
        try { if (!p.HasExited) p.Kill(); }
        catch (Exception e) when (e is InvalidOperationException or System.ComponentModel.Win32Exception) { }
        finally { p.Dispose(); }
    }
}
