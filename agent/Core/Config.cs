using System.Text.Json;

namespace Core;

public sealed record Config(string Token, string SupabaseUrl, string ApiKey)
{
    public const string AgentVersion = "0.1.0";
    public const string DefaultPath = @"C:\ProgramData\ChildMonitor\config.json";

    private static readonly JsonSerializerOptions FileOptions = new() { PropertyNameCaseInsensitive = true };

    public static Config Load(string path = DefaultPath)
    {
        var cfg = JsonSerializer.Deserialize<Config>(File.ReadAllText(path), FileOptions);
        return cfg ?? throw new InvalidDataException($"Empty config: {path}");
    }
}
