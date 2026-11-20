using System.Text.Json;

namespace Core;

/// <summary>A daily limit from the server: today's allowance (extensions included) over the exe names it covers.</summary>
public sealed record TimeLimit(string Id, string Name, int Minutes, string[] Apps)
{
    public static readonly TimeSpan WarnBefore = TimeSpan.FromMinutes(5);

    /// <summary>The server's "limits" array; null when it isn't one (keep the last good list).</summary>
    public static IReadOnlyList<TimeLimit>? ParseList(string json)
    {
        try
        {
            var list = JsonSerializer.Deserialize<List<TimeLimit>>(json, Wire.Options);
            return list?.Where(l => l.Id is not null && l.Apps is not null)
                .Select(l => l with { Apps = l.Apps.Select(a => a.ToLowerInvariant()).ToArray() }).ToList();
        }
        catch (JsonException) { return null; }
    }

    public LimitState StateFor(TimeSpan used)
    {
        var left = TimeSpan.FromMinutes(Minutes) - used;
        return left <= TimeSpan.Zero ? LimitState.Over : left <= WarnBefore ? LimitState.Warn : LimitState.Ok;
    }
}

public enum LimitState { Ok, Warn, Over }

/// <summary>
/// Today's foreground time per app on this laptop (laptop local day), from the Helper's app rows. Rows are
/// refreshed every 60 s under the same id, so a row is replaced, never added twice.
/// </summary>
public sealed class UsageToday(TimeZoneInfo zone)
{
    public sealed record Span(string Process, DateTimeOffset StartedAt, DateTimeOffset EndedAt);
    private sealed record Saved(DateOnly Day, Dictionary<string, Span> Rows);

    private DateOnly _day;
    private Dictionary<string, Span> _rows = new();

    public void Add(AppRow row, DateTimeOffset now)
    {
        Roll(now);
        _rows[row.Id] = new Span(row.Process.ToLowerInvariant(), row.StartedAt, row.EndedAt);
    }

    /// <summary>Time today in any of <paramref name="apps"/> (lowercase exe names); a row from before midnight counts from midnight.</summary>
    public TimeSpan Used(IReadOnlyCollection<string> apps, DateTimeOffset now)
    {
        var midnight = Roll(now);
        var ticks = _rows.Values.Where(r => apps.Contains(r.Process))
            .Sum(r => Math.Max(0, (r.EndedAt - (r.StartedAt > midnight ? r.StartedAt : midnight)).Ticks));
        return TimeSpan.FromTicks(ticks);
    }

    public string ToJson() => JsonSerializer.Serialize(new Saved(_day, _rows), Wire.Options);

    public static UsageToday FromJson(string json, TimeZoneInfo zone)
    {
        var usage = new UsageToday(zone);
        try
        {
            var saved = JsonSerializer.Deserialize<Saved>(json, Wire.Options);
            if (saved?.Rows is not null) (usage._day, usage._rows) = (saved.Day, saved.Rows);
        }
        catch (JsonException) { /* start the day from zero */ }
        return usage;
    }

    /// <summary>On a new local day, drops rows that ended before midnight. Returns today's midnight.</summary>
    private DateTimeOffset Roll(DateTimeOffset now)
    {
        var local = TimeZoneInfo.ConvertTime(now, zone);
        var today = DateOnly.FromDateTime(local.DateTime);
        var midnight = new DateTimeOffset(local.Date, zone.GetUtcOffset(local.Date));
        if (today != _day)
        {
            _rows = _rows.Where(kv => kv.Value.EndedAt > midnight).ToDictionary();
            _day = today;
        }
        return midnight;
    }
}
