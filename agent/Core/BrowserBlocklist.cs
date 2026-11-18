namespace Core;

/// <summary>Browsers killed for supervised users. Matches exe file name only, case-insensitive.</summary>
public static class BrowserBlocklist
{
    private static readonly HashSet<string> Blocked = new(StringComparer.OrdinalIgnoreCase)
    {
        "firefox.exe", "brave.exe", "opera.exe", "opera_gx.exe", "vivaldi.exe", "tor.exe", "waterfox.exe",
        "librewolf.exe", "yandex.exe", "browser.exe", "chromium.exe", "iexplore.exe",
    };

    public static bool IsBlocked(string exeFileName) =>
        Blocked.Contains(exeFileName[(exeFileName.LastIndexOfAny(['\\', '/']) + 1)..]);
}
