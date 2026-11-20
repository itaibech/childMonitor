using System.Text.Json;
using Core;
using Microsoft.Extensions.Logging;

namespace Service;

/// <summary>
/// Counts today's app time from the Helper's rows and, per the child's limits, warns 5 minutes before and then
/// marks the apps as over; <see cref="BrowserKiller"/> closes over-limit apps on start and in its 30 s sweep.
/// Limits and today's usage are kept on disk, so they hold offline and across restarts.
/// </summary>
internal sealed class TimeLimitEnforcer(SessionLauncher sessions, Func<IReadOnlySet<string>> supervised,
    Action<QueueItem> enqueue, ILogger<TimeLimitEnforcer> log)
{
    public const string LimitsPath = @"C:\ProgramData\ChildMonitor\limits.json";
    public const string UsagePath = @"C:\ProgramData\ChildMonitor\usage-today.json";
    private const string Title = "Child Monitor";

    private readonly object _gate = new();
    private IReadOnlyList<TimeLimit> _limits = Load(LimitsPath, TimeLimit.ParseList) ?? [];
    private readonly UsageToday _usage = Load(UsagePath, j => UsageToday.FromJson(j, TimeZoneInfo.Local)) ?? new UsageToday(TimeZoneInfo.Local);
    private readonly Dictionary<string, LimitState> _told = new(); // limit id → last state the child was told about
    private volatile HashSet<string> _over = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>True when <paramref name="exe"/> is covered by a limit that ran out today.</summary>
    public bool IsOver(string exe) => _over.Contains(exe);

    /// <summary>Called for every row accepted from a supervised pipe client. Never throws.</summary>
    public void OnPipeRow(string sid, QueueItem item)
    {
        if (item.Type != "app") return;
        try
        {
            var row = JsonSerializer.Deserialize<AppRow>(item.Json, Wire.Options);
            if (row is null) return;
            lock (_gate)
            {
                _usage.Add(row, DateTimeOffset.Now);
                File.WriteAllText(UsagePath, _usage.ToJson());
            }
        }
        catch (Exception e) { log.LogWarning(e, "Could not count app time"); }
    }

    /// <summary>New limits from the server; kept on disk for when the laptop is offline.</summary>
    public void Update(string json)
    {
        var list = TimeLimit.ParseList(json);
        if (list is null) return;
        lock (_gate)
        {
            File.WriteAllText(LimitsPath, json);
            _limits = list;
        }
        Apply();
    }

    /// <summary>Every 30 s (before the killer's sweep): recompute which apps are over and tell the child once per change.</summary>
    public void Apply()
    {
        lock (_gate)
        {
            var now = DateTimeOffset.Now;
            var over = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var limit in _limits)
            {
                var used = _usage.Used(limit.Apps, now);
                var state = limit.StateFor(used);
                if (state == LimitState.Over) over.UnionWith(limit.Apps);
                Tell(limit, state, used);
            }
            foreach (var gone in _told.Keys.Except(_limits.Select(l => l.Id)).ToList()) _told.Remove(gone);
            _over = over;
        }
    }

    private void Tell(TimeLimit limit, LimitState state, TimeSpan used)
    {
        var before = _told.GetValueOrDefault(limit.Id, LimitState.Ok);
        _told[limit.Id] = state;
        if (state == before || state == LimitState.Ok) return;
        var left = Math.Max(1, (int)Math.Ceiling((TimeSpan.FromMinutes(limit.Minutes) - used).TotalMinutes));
        var (kind, text) = state == LimitState.Warn
            ? ("limit_warning", $"{limit.Name}: {left} minutes left for today.")
            : ("limit_blocked", $"{limit.Name}: time is over for today.");
        foreach (var (id, user) in sessions.Sessions())
            if (supervised().Contains(user.Sid)) Native.ShowMessage(id, Title, text);
        var detail = JsonSerializer.SerializeToElement(new { limit = limit.Name, minutes = limit.Minutes });
        enqueue(ServiceRows.Event(kind, "", DateTimeOffset.UtcNow, Guid.NewGuid().ToString(), detail));
    }

    private static T? Load<T>(string path, Func<string, T?> parse) where T : class =>
        File.Exists(path) ? parse(File.ReadAllText(path)) : null;
}
