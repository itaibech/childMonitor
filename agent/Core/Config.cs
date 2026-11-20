using System.Reflection;
using System.Text.Json;

namespace Core;

public sealed record Config(string Token, string SupabaseUrl, string ApiKey)
{
    /// <summary>"1.1.0 (2026-11-20)": version and release date from version.json, stamped in at build time.</summary>
    public static readonly string AgentVersion =
        typeof(Config).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion ?? "unknown";
    public const string DefaultPath = @"C:\ProgramData\ChildMonitor\config.json";

    private static readonly JsonSerializerOptions FileOptions = new() { PropertyNameCaseInsensitive = true };

    public static Config Load(string path = DefaultPath)
    {
        var cfg = JsonSerializer.Deserialize<Config>(File.ReadAllText(path), FileOptions);
        return cfg ?? throw new InvalidDataException($"Empty config: {path}");
    }
}
