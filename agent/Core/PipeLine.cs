using System.Text.Json;

namespace Core;

/// <summary>Builds the one-line JSON <see cref="PipeMessage"/> strings sent over the pipe.</summary>
public static class PipeLine
{
    public const int MaxUrl = 2000;
    public const int MaxTitle = 300;

    public static string App(AppRow row) => Wrap("app", row);

    public static string Event(EventRow row) => Wrap("event", row);

    private static string Wrap<T>(string type, T row) =>
        JsonSerializer.Serialize(new PipeMessage(type, JsonSerializer.SerializeToElement(row, Wire.Options)), Wire.Options);
}
