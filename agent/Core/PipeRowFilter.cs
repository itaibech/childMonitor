using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Core;

/// <summary>Validates a pipe line and stamps it with the pipe client's identity (R4).</summary>
public static class PipeRowFilter
{
    private static readonly HashSet<string> Types = ["app", "event"];
    private static readonly HashSet<string> HelperEventKinds = ["idle", "active"];

    /// <summary>Required string fields per row type and their maximum length (longer values are truncated).</summary>
    private static readonly Dictionary<string, (string Field, int Max)[]> StringFields = new()
    {
        ["app"] = [("process", 1024), ("exe_path", 1024), ("title", PipeLine.MaxTitle)],
        ["event"] = [],
    };

    private static readonly Regex IsoDate = new(@"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}", RegexOptions.CultureInvariant);

    /// <summary>
    /// Returns the row to queue, with <c>win_user</c> overwritten by <paramref name="clientWinUser"/>,
    /// or null if the client is unsupervised or the line is malformed/not allowed from a client.
    /// </summary>
    public static QueueItem? Rewrite(string line, string clientSid, string clientWinUser,
        IReadOnlySet<string> supervised)
    {
        if (!supervised.Contains(clientSid)) return null;
        JsonObject? msg;
        try { msg = JsonNode.Parse(line) as JsonObject; }
        catch (JsonException) { return null; }
        if (msg?["type"] is not JsonValue t || !t.TryGetValue<string>(out var type) || !Types.Contains(type))
            return null;
        if (msg["row"] is not JsonObject row || !IsAllowed(type, row) || !HasValidTimes(type, row)) return null;
        if (!TruncateStrings(type, row)) return null;
        var id = (string)row["id"]!;
        row["win_user"] = clientWinUser;
        return new QueueItem(type, id, row.ToJsonString());
    }

    private static bool IsAllowed(string type, JsonObject row)
    {
        if (!TryString(row, "id", out var id) || !Guid.TryParseExact(id, "D", out _)) return false;
        if (type != "event") return true;
        return TryString(row, "kind", out var kind) && HelperEventKinds.Contains(kind);
    }

    private static bool HasValidTimes(string type, JsonObject row)
    {
        if (type == "event") return TryTime(row, "at", out _);
        return TryTime(row, "started_at", out var start) && TryTime(row, "ended_at", out var end) && end >= start;
    }

    /// <summary>Each required field must be a JSON string; over-long values are cut to the cap.</summary>
    private static bool TruncateStrings(string type, JsonObject row)
    {
        foreach (var (field, max) in StringFields[type])
        {
            if (!TryString(row, field, out var value)) return false;
            if (value.Length > max) row[field] = value[..max];
        }
        return true;
    }

    private static bool TryString(JsonObject row, string field, out string value)
    {
        value = "";
        if (row[field] is not JsonValue v || v.GetValueKind() != JsonValueKind.String) return false;
        value = v.GetValue<string>();
        return true;
    }

    private static bool TryTime(JsonObject row, string field, out DateTimeOffset at)
    {
        at = default;
        return TryString(row, field, out var s) && IsoDate.IsMatch(s)
            && DateTimeOffset.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out at);
    }
}

/// <summary>Fixed-window row budget for one pipe connection; a client that exceeds it is disconnected.</summary>
public sealed class PipeRateLimiter(int max = PipeRateLimiter.MaxRowsPerMinute, TimeSpan? window = null)
{
    public const int MaxRowsPerMinute = 600;

    private readonly TimeSpan _window = window ?? TimeSpan.FromMinutes(1);
    private DateTimeOffset _start = DateTimeOffset.MinValue;
    private int _count;

    public bool TryTake(DateTimeOffset now)
    {
        if (now - _start >= _window)
        {
            _start = now;
            _count = 0;
        }
        return ++_count <= max;
    }
}
