using System.Text.Json;
using System.Text.Json.Nodes;

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
    public void Event_rows_are_accepted_and_web_rows_are_service_only()
    {
        var ev = PipeLine.Event(new EventRow(Id, "x", "idle", JsonDocument.Parse("{}").RootElement, T));
        var web = JsonSerializer.Serialize(new PipeMessage("web", JsonSerializer.SerializeToElement(
            new WebRow(Id, "x", "chrome", "https://a", "t", T, T), Wire.Options)), Wire.Options);
        Assert.Equal("event", PipeRowFilter.Rewrite(ev, "S-kid", @"PC\kid", Supervised)!.Type);
        Assert.Null(PipeRowFilter.Rewrite(web, "S-kid", @"PC\kid", Supervised));
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

    private static JsonObject AppRowJson() => new()
    {
        ["id"] = Id, ["win_user"] = "x", ["process"] = "a.exe", ["exe_path"] = @"C:\a.exe", ["title"] = "A",
        ["started_at"] = "2026-11-18T15:00:00Z", ["ended_at"] = "2026-11-18T15:01:00Z",
    };

    private static JsonObject EventRowJson() => new()
    {
        ["id"] = Id, ["win_user"] = "x", ["kind"] = "idle", ["detail"] = new JsonObject(), ["at"] = "2026-11-18T15:00:00Z",
    };

    private static QueueItem? Run(string type, JsonObject row) =>
        PipeRowFilter.Rewrite(new JsonObject { ["type"] = type, ["row"] = row }.ToJsonString(), "S-kid", @"PC\kid",
            Supervised);

    private static JsonObject With(JsonObject row, string key, JsonNode? value)
    {
        row[key] = value;
        return row;
    }

    private static JsonObject Without(JsonObject row, string key)
    {
        row.Remove(key);
        return row;
    }

    [Theory]
    [InlineData("{6f9619ff-8b86-d011-b42d-00cf4fc964ff}")]
    [InlineData("6f9619ff8b86d011b42d00cf4fc964ff")]
    [InlineData("(6f9619ff-8b86-d011-b42d-00cf4fc964ff)")]
    public void Non_canonical_guid_ids_are_dropped(string id) =>
        Assert.Null(Run("app", With(AppRowJson(), "id", id)));

    [Theory]
    [InlineData("started_at")]
    [InlineData("ended_at")]
    public void Missing_session_timestamps_are_dropped(string key)
    {
        Assert.Null(Run("app", Without(AppRowJson(), key)));
    }

    [Theory]
    [InlineData("yesterday")]
    [InlineData("11/18/2026 15:00")]
    [InlineData("")]
    public void Unparseable_timestamps_are_dropped(string value)
    {
        Assert.Null(Run("app", With(AppRowJson(), "started_at", value)));
        Assert.Null(Run("event", With(EventRowJson(), "at", value)));
        Assert.Null(Run("app", With(AppRowJson(), "started_at", 12345)));
    }

    [Fact]
    public void Event_without_at_is_dropped() => Assert.Null(Run("event", Without(EventRowJson(), "at")));

    [Fact]
    public void Ended_before_started_is_dropped()
    {
        Assert.Null(Run("app", With(AppRowJson(), "ended_at", "2026-11-18T14:59:59Z")));
        Assert.Null(Run("app", With(AppRowJson(), "ended_at", "2026-11-18T16:00:00+02:00")));
        Assert.NotNull(Run("app", With(AppRowJson(), "ended_at", "2026-11-18T17:00:00+02:00")));
    }

    [Theory]
    [InlineData("app", "process")]
    [InlineData("app", "exe_path")]
    [InlineData("app", "title")]
    public void Non_string_or_missing_string_fields_are_dropped(string type, string key)
    {
        JsonObject Row() => AppRowJson();
        Assert.Null(Run(type, With(Row(), key, 7)));
        Assert.Null(Run(type, With(Row(), key, null)));
        Assert.Null(Run(type, With(Row(), key, new JsonObject())));
        Assert.Null(Run(type, Without(Row(), key)));
    }

    [Theory]
    [InlineData("app", "process", 1024)]
    [InlineData("app", "exe_path", 1024)]
    [InlineData("app", "title", 300)]
    public void Long_string_fields_are_truncated_not_dropped(string type, string key, int cap)
    {
        var row = AppRowJson();
        var item = Run(type, With(row, key, new string('x', cap + 50)));
        Assert.NotNull(item);
        Assert.Equal(cap, JsonNode.Parse(item.Json)![key]!.GetValue<string>().Length);
        var exact = Run(type, With(AppRowJson(), key, new string('y', cap)));
        Assert.Equal(cap, JsonNode.Parse(exact!.Json)![key]!.GetValue<string>().Length);
    }

    [Fact]
    public void Rate_limiter_allows_600_rows_per_minute()
    {
        var limiter = new PipeRateLimiter(600, TimeSpan.FromMinutes(1));
        for (var i = 0; i < 600; i++) Assert.True(limiter.TryTake(T.AddSeconds(i * 0.05)));
        Assert.False(limiter.TryTake(T.AddSeconds(59)));
        Assert.True(limiter.TryTake(T.AddSeconds(61)));
    }

    [Fact]
    public void Rate_limiter_default_is_600_per_minute()
    {
        var limiter = new PipeRateLimiter();
        for (var i = 0; i < PipeRateLimiter.MaxRowsPerMinute; i++) Assert.True(limiter.TryTake(T));
        Assert.False(limiter.TryTake(T));
        Assert.Equal(600, PipeRateLimiter.MaxRowsPerMinute);
    }
}
