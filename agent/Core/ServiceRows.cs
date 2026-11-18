using System.Text.Json;

namespace Core;

/// <summary>A row ready for <see cref="Queue.Upsert"/>.</summary>
public sealed record QueueItem(string Type, string Id, string Json);

/// <summary>Rows the service itself produces (session/power events, users).</summary>
public static class ServiceRows
{
    private static readonly JsonElement EmptyDetail = JsonDocument.Parse("{}").RootElement.Clone();

    public static QueueItem Event(string kind, string winUser, DateTimeOffset at, string id, JsonElement? detail = null)
    {
        var row = new EventRow(id, winUser, kind, detail ?? EmptyDetail, at);
        return new QueueItem("event", id, JsonSerializer.Serialize(row, Wire.Options));
    }

    public static QueueItem BrowserBlocked(string winUser, string exe, DateTimeOffset at, string id) =>
        Event("browser_blocked", winUser, at, id, JsonSerializer.SerializeToElement(new { exe }));

    public static QueueItem User(UserRow user) =>
        new("user", user.Sid, JsonSerializer.Serialize(user, Wire.Options));
}
