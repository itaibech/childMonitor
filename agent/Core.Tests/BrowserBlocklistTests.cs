namespace Core.Tests;

public sealed class BrowserBlocklistTests
{
    [Theory]
    [InlineData("msedgewebview2.exe")]
    [InlineData("chrome.exe")]
    [InlineData("msedge.exe")]
    [InlineData("Chrome.EXE")]
    public void BrowserBlocklist_does_not_match_webview_or_chrome(string exe) =>
        Assert.False(BrowserBlocklist.IsBlocked(exe));

    [Theory]
    [InlineData("FireFox.exe")]
    [InlineData("firefox.exe")]
    [InlineData("brave.exe")]
    [InlineData("opera_gx.exe")]
    [InlineData("browser.exe")]
    [InlineData("IEXPLORE.EXE")]
    public void Blocks_firefox_case_insensitive(string exe) => Assert.True(BrowserBlocklist.IsBlocked(exe));

    [Fact]
    public void Matches_file_name_only()
    {
        Assert.True(BrowserBlocklist.IsBlocked(@"C:\x\firefox.exe"));
        Assert.False(BrowserBlocklist.IsBlocked("firefoxsetup.exe"));
        Assert.False(BrowserBlocklist.IsBlocked(@"C:\firefox.exe\notepad.exe"));
        Assert.False(BrowserBlocklist.IsBlocked(""));
    }
}
