using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;

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
        Converters = { new UtcDateTimeOffsetConverter() },
    };
}

public sealed class UtcDateTimeOffsetConverter : JsonConverter<DateTimeOffset>
{
    public override DateTimeOffset Read(ref Utf8JsonReader reader, Type type, JsonSerializerOptions options) =>
        DateTimeOffset.Parse(reader.GetString()!, CultureInfo.InvariantCulture);

    public override void Write(Utf8JsonWriter writer, DateTimeOffset value, JsonSerializerOptions options) =>
        writer.WriteStringValue(value.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.FFFFFFF'Z'", CultureInfo.InvariantCulture));
}
