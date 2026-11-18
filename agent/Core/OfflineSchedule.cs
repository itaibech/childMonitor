using System.Globalization;
using System.Text.Json;

namespace Core;

/// <summary>
/// Nightly offline time for a child, set on the dashboard. A night belongs to the day it starts on; nights starting
/// Friday or Saturday use the weekend times. Times are the laptop's local clock.
/// </summary>
public sealed record OfflineSchedule(bool Enabled, TimeSpan WeekdayFrom, TimeSpan WeekdayTo, TimeSpan WeekendFrom, TimeSpan WeekendTo)
{
    /// <summary>Null when the JSON is missing or malformed (then nothing is blocked).</summary>
    public static OfflineSchedule? Parse(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var r = doc.RootElement;
            if (r.ValueKind != JsonValueKind.Object) return null;
            var (wf, wt) = (Time(r, "weekday", "from"), Time(r, "weekday", "to"));
            var (ef, et) = (Time(r, "weekend", "from"), Time(r, "weekend", "to"));
            if (wf is null || wt is null || ef is null || et is null) return null;
            var enabled = r.TryGetProperty("enabled", out var e) && e.ValueKind == JsonValueKind.True;
            return new OfflineSchedule(enabled, wf.Value, wt.Value, ef.Value, et.Value);
        }
        catch (JsonException) { return null; }
    }

    private static TimeSpan? Time(JsonElement root, string night, string edge) =>
        root.TryGetProperty(night, out var n) && n.ValueKind == JsonValueKind.Object
        && n.TryGetProperty(edge, out var v) && v.ValueKind == JsonValueKind.String
        && TimeSpan.TryParseExact(v.GetString(), @"hh\:mm", CultureInfo.InvariantCulture, out var t) && t < TimeSpan.FromDays(1)
            ? t : null;

    public bool IsOffline(DateTime local) =>
        Enabled && (InNight(local.Date, local) || InNight(local.Date.AddDays(-1), local));

    private bool InNight(DateTime day, DateTime at)
    {
        var weekend = day.DayOfWeek is DayOfWeek.Friday or DayOfWeek.Saturday;
        var (from, to) = weekend ? (WeekendFrom, WeekendTo) : (WeekdayFrom, WeekdayTo);
        if (from == to) return false;
        var start = day + from;
        var end = (to > from ? day : day.AddDays(1)) + to;
        return at >= start && at < end;
    }
}
