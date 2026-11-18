using System.Text.Json;
using Microsoft.Data.Sqlite;

namespace Core.Tests;

public sealed class BrowserHistoryTests : IDisposable
{
    private static readonly DateTimeOffset T = new(2026, 11, 18, 15, 0, 0, TimeSpan.Zero);
    private readonly string _dir = Directory.CreateTempSubdirectory("cm hist ").FullName; // space: URI escaping

    public void Dispose() => Directory.Delete(_dir, true);

    /// <summary>Minimal Chrome History schema: urls(id,url,title), visits(id,url,visit_time,transition).</summary>
    private string MakeHistory(params (long Id, string Url, string Title, DateTimeOffset At, int Transition)[] rows)
    {
        var path = Path.Combine(_dir, "History");
        using var db = new SqliteConnection($"Data Source={path};Pooling=False");
        db.Open();
        using var cmd = db.CreateCommand();
        cmd.CommandText = "create table urls(id integer primary key, url text, title text);" +
                          "create table visits(id integer primary key, url integer, visit_time integer, transition integer);";
        cmd.ExecuteNonQuery();
        foreach (var r in rows)
        {
            cmd.CommandText = "insert into urls values($i,$u,$t); insert into visits values($i,$i,$v,$tr);";
            cmd.Parameters.Clear();
            cmd.Parameters.AddWithValue("$i", r.Id);
            cmd.Parameters.AddWithValue("$u", r.Url);
            cmd.Parameters.AddWithValue("$t", r.Title);
            cmd.Parameters.AddWithValue("$v", BrowserHistory.ToWebKit(r.At));
            cmd.Parameters.AddWithValue("$tr", r.Transition);
            cmd.ExecuteNonQuery();
        }
        return path;
    }

    [Fact]
    public void Reads_top_frame_visits_after_cursor_and_since_time()
    {
        var path = MakeHistory(
            (1, "https://old.example/", "Old", T.AddHours(-30), 0),
            (2, "https://youtube.com/watch?v=1", "Cats - YouTube", T, 0x30000001),
            (3, "https://ads.example/frame", "Ad", T, 3),
            (4, "https://wiki.org/", "Wiki", T.AddMinutes(1), 1));
        var all = BrowserHistory.ReadSince(path, 0, T.AddHours(-24));
        Assert.Equal([2L, 4L], all.Select(v => v.Id));
        Assert.Equal("https://youtube.com/watch?v=1", all[0].Url);
        Assert.Equal(T, all[0].At);
        Assert.Equal([4L], BrowserHistory.ReadSince(path, 2, T.AddHours(-24)).Select(v => v.Id));
    }

    [Fact]
    public void Max_visit_id_and_percent_in_path()
    {
        var path = MakeHistory((7, "https://a/", "A", T, 0));
        Assert.Equal(7, BrowserHistory.MaxVisitId(path));
        var odd = Path.Combine(_dir, "a%41b #1");
        Directory.CreateDirectory(odd);
        File.Copy(path, Path.Combine(odd, "History"));
        Assert.Single(BrowserHistory.ReadSince(Path.Combine(odd, "History"), 0, T.AddHours(-1)));
        Assert.Equal(@"file:///C:/Users/Noa%25 Levi/History?immutable=1", BrowserHistory.UriFor(@"C:\Users\Noa% Levi\History"));
    }

    [Theory]
    [InlineData("Cats - YouTube - Google Chrome")]
    [InlineData("Cats - YouTube and 3 more pages - Personal - Microsoft Edge")]
    [InlineData("Cats - YouTube ועוד 3 דפים - אישי - Microsoft Edge")]
    public void Window_title_matches_longest_prefix_visit(string window)
    {
        var visits = new[]
        {
            new Visit(1, "https://youtube.com/", "Cats", T),
            new Visit(2, "https://youtube.com/watch?v=1", "Cats - YouTube", T),
        };
        Assert.Equal(2, SiteMatcher.Match(window, visits)!.Id);
    }

    [Fact]
    public void Match_needs_word_boundary_and_prefers_newest_on_tie()
    {
        var visits = new[]
        {
            new Visit(1, "https://a/", "Go", T),
            new Visit(2, "https://b/", "Docs", T),
            new Visit(3, "https://c/", "Docs", T.AddMinutes(1)),
            new Visit(4, "https://d/", "", T),
        };
        Assert.Null(SiteMatcher.Match("Google - Google Chrome", visits));
        Assert.Equal(3, SiteMatcher.Match("Docs - Google Chrome", visits)!.Id);
        Assert.Null(SiteMatcher.Match("New Tab - Google Chrome", visits));
    }

    [Theory]
    [InlineData("chrome.exe", "chrome")]
    [InlineData("MSEDGE.EXE", "edge")]
    [InlineData("firefox.exe", null)]
    public void Browser_of_process(string process, string? browser) => Assert.Equal(browser, SiteMatcher.BrowserOf(process));

    [Fact]
    public void Web_row_copies_app_times_and_derives_stable_id()
    {
        var app = new AppRow("6f9619ff-8b86-d011-b42d-00cf4fc964ff", @"PC\kid", "chrome.exe", @"C:\c.exe", "Cats - YouTube - Google Chrome", T, T.AddMinutes(5));
        var visit = new Visit(2, "https://youtube.com/watch?v=1", "Cats - YouTube", T.AddSeconds(-3));
        var a = ServiceRows.Web(app, "chrome", visit);
        var b = ServiceRows.Web(app with { EndedAt = T.AddMinutes(6) }, "chrome", visit);
        Assert.Equal("web", a.Type);
        Assert.Equal(a.Id, b.Id);
        Assert.True(Guid.TryParseExact(a.Id, "D", out _));
        var row = JsonSerializer.Deserialize<WebRow>(a.Json, Wire.Options)!;
        Assert.Equal((T, T.AddMinutes(5), "https://youtube.com/watch?v=1", "Cats - YouTube", @"PC\kid"),
            (row.StartedAt, row.EndedAt, row.Url, row.Title, row.WinUser));
    }
}
