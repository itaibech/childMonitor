using System.Text.Json;

namespace Core;

/// <summary>Builds the one-line JSON <see cref="PipeMessage"/> strings sent over the pipe.</summary>
public static class PipeLine
{
    public const int MaxUrl = 2000;
    public const int MaxTitle = 300;

    public static string App(AppRow row) => Wrap("app", row);

    public static string Web(WebRow row) => Wrap("web", row);

    public static string Event(EventRow row) => Wrap("event", row);

    /// <summary>Extension message {id,browser,url,title,started_at,ended_at} + win_user. Null if invalid.</summary>
    public static string? FromExtension(string json, string winUser)
    {
        WebRow? row;
        try { row = JsonSerializer.Deserialize<WebRow>(json, Wire.Options); }
        catch (Exception e) when (e is JsonException or FormatException or ArgumentException) { return null; }
        if (row is null || row.Id is null || row.Browser is null || row.Url is null) return null;
        var title = row.Title ?? "";
        return Web(row with
        {
            WinUser = winUser,
            Url = row.Url.Length > MaxUrl ? row.Url[..MaxUrl] : row.Url,
            Title = title.Length > MaxTitle ? title[..MaxTitle] : title,
        });
    }

    private static string Wrap<T>(string type, T row) =>
        JsonSerializer.Serialize(new PipeMessage(type, JsonSerializer.SerializeToElement(row, Wire.Options)), Wire.Options);
}
