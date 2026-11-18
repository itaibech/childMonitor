namespace Core;

/// <summary>
/// Browsers killed for supervised users. Matches the exe file name or the PE OriginalFilename (so a renamed
/// firefox.exe is still caught), case-insensitive.
/// </summary>
public static class BrowserBlocklist
{
    private static readonly HashSet<string> Blocked = new(StringComparer.OrdinalIgnoreCase)
    {
        "firefox.exe", "brave.exe", "opera.exe", "opera_gx.exe", "vivaldi.exe", "tor.exe", "waterfox.exe",
        "librewolf.exe", "yandex.exe", "browser.exe", "chromium.exe", "iexplore.exe",
    };

    public static bool IsBlocked(string exeFileName, string? originalFilename = null) =>
        Blocked.Contains(FileName(exeFileName))
        || (originalFilename is not null && Blocked.Contains(FileName(originalFilename)));

    private static string FileName(string path) => path[(path.LastIndexOfAny(['\\', '/']) + 1)..];
}
