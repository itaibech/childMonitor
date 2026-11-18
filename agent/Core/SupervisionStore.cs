using System.Text.Json;

namespace Core;

public sealed class SupervisionStore(string path)
{
    public const string DefaultPath = @"C:\ProgramData\ChildMonitor\supervised.json";

    public event Action<IReadOnlySet<string>>? Changed;

    public IReadOnlySet<string> Load()
    {
        try
        {
            var sids = JsonSerializer.Deserialize<string[]>(File.ReadAllText(path));
            return sids is null ? new HashSet<string>() : new HashSet<string>(sids);
        }
        catch (Exception e) when (e is IOException or JsonException or UnauthorizedAccessException)
        {
            return new HashSet<string>();
        }
    }

    public void Save(IEnumerable<string> sids)
    {
        var next = new HashSet<string>(sids);
        if (next.SetEquals(Load()) && File.Exists(path)) return;
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(path))!);
        var tmp = path + ".tmp";
        File.WriteAllText(tmp, JsonSerializer.Serialize(next.Order().ToArray()));
        File.Move(tmp, path, true);
        Changed?.Invoke(next);
    }
}
