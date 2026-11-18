using System.Text.Json;
using System.Text.Json.Nodes;

namespace Core;

/// <summary>Validates a pipe line and stamps it with the pipe client's identity (R4).</summary>
public static class PipeRowFilter
{
    private static readonly HashSet<string> Types = ["app", "web", "event"];
    private static readonly HashSet<string> HelperEventKinds = ["idle", "active"];

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
        if (msg["row"] is not JsonObject row || !IsAllowed(type, row)) return null;
        var id = (string)row["id"]!;
        row["win_user"] = clientWinUser;
        return new QueueItem(type, id, row.ToJsonString());
    }

    private static bool IsAllowed(string type, JsonObject row)
    {
        if (row["id"] is not JsonValue v || !v.TryGetValue<string>(out var id) || id.Length == 0) return false;
        if (type != "event") return true;
        return row["kind"] is JsonValue k && k.TryGetValue<string>(out var kind) && HelperEventKinds.Contains(kind);
    }
}
