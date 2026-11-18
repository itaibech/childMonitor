using System.Text.Json;

namespace Core;

public sealed record AppRow(string Id, string WinUser, string Process, string ExePath, string Title,
    DateTimeOffset StartedAt, DateTimeOffset EndedAt);

public sealed record WebRow(string Id, string WinUser, string Browser, string Url, string Title,
    DateTimeOffset StartedAt, DateTimeOffset EndedAt);

public sealed record EventRow(string Id, string WinUser, string Kind, JsonElement Detail, DateTimeOffset At);

public sealed record UserRow(string Sid, string WinUser, bool IsAdmin);

public sealed record PipeMessage(string Type, JsonElement Row);

public static class Wire
{
    public static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
    };
}
