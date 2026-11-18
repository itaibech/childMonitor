using System.Text.Json;

namespace Core.Tests;

public sealed class PipeRowFilterTests
{
    private static readonly IReadOnlySet<string> Supervised = new HashSet<string> { "S-kid" };
    private static readonly DateTimeOffset T = new(2026, 11, 18, 15, 0, 0, TimeSpan.Zero);

    private const string Id = "6f9619ff-8b86-d011-b42d-00cf4fc964ff";

    private static string AppLine(string winUser) =>
        PipeLine.App(new AppRow(Id, winUser, "a.exe", @"C:\a.exe", "A", T, T.AddMinutes(1)));

    [Fact]
    public void Supervised_client_row_is_queued_with_win_user_from_pipe_identity()
    {
        var item = PipeRowFilter.Rewrite(AppLine(@"PC\someoneelse"), "S-kid", @"PC\kid", Supervised);
        Assert.NotNull(item);
        Assert.Equal("app", item.Type);
        Assert.Equal(Id, item.Id);
        var row = JsonSerializer.Deserialize<AppRow>(item.Json, Wire.Options)!;
        Assert.Equal(@"PC\kid", row.WinUser);
        Assert.Equal("a.exe", row.Process);
    }

    [Fact]
    public void Unsupervised_client_rows_are_dropped() =>
        Assert.Null(PipeRowFilter.Rewrite(AppLine(@"PC\dad"), "S-dad", @"PC\dad", Supervised));

    [Theory]
    [InlineData("not json")]
    [InlineData("[]")]
    [InlineData("{\"type\":\"user\",\"row\":{\"id\":\"x\",\"sid\":\"S-kid\"}}")]
    [InlineData("{\"type\":\"app\",\"row\":{\"win_user\":\"x\"}}")]
    [InlineData("{\"type\":\"app\",\"row\":{\"id\":\"\"}}")]
    [InlineData("{\"type\":\"app\",\"row\":[1]}")]
    [InlineData("{\"type\":\"app\"}")]
    [InlineData("{\"type\":\"app\",\"row\":{\"id\":\"not-a-guid\"}}")]
    [InlineData("{\"type\":\"app\",\"row\":{\"id\":7}}")]
    public void Malformed_or_disallowed_lines_are_dropped(string line) =>
        Assert.Null(PipeRowFilter.Rewrite(line, "S-kid", @"PC\kid", Supervised));

    [Fact]
    public void Web_and_event_rows_are_accepted()
    {
        var web = PipeLine.Web(new WebRow(Id, "x", "chrome", "https://a", "t", T, T));
        var ev = PipeLine.Event(new EventRow(Id, "x", "idle", JsonDocument.Parse("{}").RootElement, T));
        Assert.Equal("web", PipeRowFilter.Rewrite(web, "S-kid", @"PC\kid", Supervised)!.Type);
        Assert.Equal("event", PipeRowFilter.Rewrite(ev, "S-kid", @"PC\kid", Supervised)!.Type);
    }

    [Theory]
    [InlineData("logon")]
    [InlineData("browser_blocked")]
    [InlineData("heartbeat")]
    public void Service_owned_event_kinds_from_pipe_are_dropped(string kind)
    {
        var ev = PipeLine.Event(new EventRow(Id, "x", kind, JsonDocument.Parse("{}").RootElement, T));
        Assert.Null(PipeRowFilter.Rewrite(ev, "S-kid", @"PC\kid", Supervised));
    }
}
