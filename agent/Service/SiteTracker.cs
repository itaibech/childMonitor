using System.Text.Json;
using Core;
using Microsoft.Extensions.Logging;
using Microsoft.Win32;

namespace Service;

/// <summary>
/// Turns Chrome/Edge app sessions from the pipe into web sessions by matching the window title against that
/// account's browser history (replaces the browser extension).
/// </summary>
internal sealed class SiteTracker(Action<QueueItem> enqueue, ILogger<SiteTracker> log)
{
    private static readonly TimeSpan Keep = TimeSpan.FromHours(24);
    private static readonly TimeSpan RefreshAfter = TimeSpan.FromSeconds(60);
    private static readonly TimeSpan RetryFor = TimeSpan.FromMinutes(3);
    private const string ProfileList = @"HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\";

    private sealed class Source
    {
        public DateTimeOffset ReadAt = DateTimeOffset.MinValue;
        public readonly Dictionary<string, long> Cursors = new();
        public readonly HashSet<string> Failing = new();
        public readonly List<Visit> Visits = new();
    }

    private sealed record Pending(string Sid, string Browser, AppRow App, DateTimeOffset Since);

    private readonly object _gate = new();
    private readonly Dictionary<string, Source> _sources = new();
    private readonly Dictionary<string, Pending> _pending = new();

    /// <summary>Called for every row accepted from a supervised pipe client. Never throws.</summary>
    public void OnPipeRow(string sid, QueueItem item)
    {
        if (item.Type != "app") return;
        try
        {
            var app = JsonSerializer.Deserialize<AppRow>(item.Json, Wire.Options);
            var browser = app is null ? null : SiteMatcher.BrowserOf(app.Process);
            if (app is null || browser is null) return;
            lock (_gate)
            {
                var since = _pending.TryGetValue(app.Id, out var p) ? p.Since : DateTimeOffset.UtcNow;
                if (TryEmit(sid, browser, app)) _pending.Remove(app.Id);
                else _pending[app.Id] = new Pending(sid, browser, app, since);
            }
        }
        catch (Exception e) { log.LogWarning(e, "Site matching failed"); }
    }

    /// <summary>
    /// Every 30 s: retry sessions whose page was not in history yet (browsers save it with a delay). Accounts no
    /// longer supervised are dropped at once.
    /// </summary>
    public void Retry(IReadOnlySet<string> supervised)
    {
        lock (_gate)
        {
            var now = DateTimeOffset.UtcNow;
            foreach (var p in _pending.Values.ToList())
            {
                try
                {
                    if (!supervised.Contains(p.Sid) || TryEmit(p.Sid, p.Browser, p.App) || now - p.Since > RetryFor)
                        _pending.Remove(p.App.Id);
                }
                catch (Exception e)
                {
                    log.LogWarning(e, "Site matching retry failed");
                    _pending.Remove(p.App.Id);
                }
            }
        }
    }

    private bool TryEmit(string sid, string browser, AppRow app)
    {
        var visit = SiteMatcher.Match(app.Title, Visits(sid, browser));
        if (visit is null) return false;
        enqueue(ServiceRows.Web(app, browser, visit));
        return true;
    }

    private List<Visit> Visits(string sid, string browser)
    {
        var key = sid + "|" + browser;
        if (!_sources.TryGetValue(key, out var src)) _sources[key] = src = new Source();
        var now = DateTimeOffset.UtcNow;
        if (now - src.ReadAt < RefreshAfter) return src.Visits;
        src.ReadAt = now;
        foreach (var file in HistoryFiles(sid, browser)) Read(src, file, now - Keep);
        src.Visits.RemoveAll(v => v.At < now - Keep);
        return src.Visits;
    }

    private void Read(Source src, string file, DateTimeOffset notBefore)
    {
        try
        {
            var cursor = src.Cursors.GetValueOrDefault(file);
            var visits = BrowserHistory.ReadSince(file, cursor, notBefore);
            if (visits.Count == 0)
            {
                // Deleted and recreated by the browser: ids restart at 1, so start over.
                if (cursor > 0 && BrowserHistory.MaxVisitId(file) < cursor) src.Cursors[file] = 0;
            }
            else
            {
                src.Visits.AddRange(visits);
                src.Cursors[file] = visits[^1].Id;
            }
            src.Failing.Remove(file);
        }
        catch (Exception e)
        {
            // Torn reads are normal now and then; a file that never reads means no sites at all, so say so once.
            if (src.Failing.Add(file)) log.LogWarning(e, "History read failed for {File}; retrying next poll", file);
        }
    }

    /// <summary>Every profile's History file (Default, Profile 1, ...) under the account's browser data.</summary>
    private static IEnumerable<string> HistoryFiles(string sid, string browser)
    {
        if (Registry.GetValue(ProfileList + sid, "ProfileImagePath", null) is not string home) return [];
        var vendor = browser == "chrome" ? @"Google\Chrome" : @"Microsoft\Edge";
        var root = Path.Combine(Environment.ExpandEnvironmentVariables(home), "AppData", "Local", vendor, "User Data");
        if (!Directory.Exists(root)) return [];
        return Directory.EnumerateDirectories(root).Select(d => Path.Combine(d, "History")).Where(File.Exists).ToList();
    }
}
