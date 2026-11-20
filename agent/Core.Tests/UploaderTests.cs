using System.Net;
using System.Text;
using System.Text.Json;

namespace Core.Tests;

public sealed class UploaderTests : IDisposable
{
    private readonly string _dir = Directory.CreateTempSubdirectory("cmu").FullName;
    private readonly Config _cfg = new("tok", "https://x.supabase.co", "key");

    public void Dispose()
    {
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        Directory.Delete(_dir, true);
    }

    private sealed class FakeHandler(Func<int, HttpRequestMessage, string, (HttpStatusCode, string)> reply)
        : HttpMessageHandler
    {
        public List<(HttpRequestMessage Req, string Body)> Calls { get; } = new();

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage r, CancellationToken ct)
        {
            var body = await r.Content!.ReadAsStringAsync(ct);
            Calls.Add((r, body));
            var (code, text) = reply(Calls.Count, r, body);
            return new HttpResponseMessage(code) { Content = new StringContent(text, Encoding.UTF8, "application/json") };
        }
    }

    private const string Ok = "{\"ok\":true,\"accepted\":1,\"supervised_sids\":[]}";

    private (Uploader Up, Queue Q, FakeHandler H, SupervisionStore S) Make(
        Func<int, HttpRequestMessage, string, (HttpStatusCode, string)> reply)
    {
        var q = new Queue(Path.Combine(_dir, "q.db"));
        var h = new FakeHandler(reply);
        var s = new SupervisionStore(Path.Combine(_dir, "sup.json"));
        return (new Uploader(q, new HttpClient(h), _cfg, s), q, h, s);
    }

    private static void Fill(Queue q, int n)
    {
        for (var i = 0; i < n; i++) q.Upsert("app", $"id{i:D5}", $"{{\"id\":\"id{i:D5}\"}}");
    }

    private static int Count(string body) =>
        JsonDocument.Parse(body).RootElement.GetProperty("batch").GetProperty("app_sessions").GetArrayLength();

    [Fact]
    public async Task Drains_backlog_in_batches()
    {
        var (up, q, h, _) = Make((_, _, _) => (HttpStatusCode.OK, Ok));
        Fill(q, 1200);
        Assert.Equal(1200, await up.FlushAsync(CancellationToken.None));
        Assert.Equal(new[] { 500, 500, 200 }, h.Calls.Select(c => Count(c.Body)));
        Assert.Empty(q.Oldest(10));
    }

    [Fact]
    public async Task Keeps_rows_on_server_error_in_order()
    {
        var (up, q, h, _) = Make((n, _, _) => (n == 2 ? HttpStatusCode.InternalServerError : HttpStatusCode.OK, Ok));
        Fill(q, 1200);
        Assert.Equal(500, await up.FlushAsync(CancellationToken.None));
        Assert.Equal(2, h.Calls.Count);
        var left = q.Oldest(1000);
        Assert.Equal(700, left.Count);
        Assert.Equal("id00500", JsonDocument.Parse(left[0].Json).RootElement.GetProperty("id").GetString());
        Assert.Equal("id01199", JsonDocument.Parse(left[^1].Json).RootElement.GetProperty("id").GetString());
    }

    [Fact]
    public async Task Batch_json_shape_and_headers()
    {
        var (up, q, h, _) = Make((_, _, _) => (HttpStatusCode.OK, Ok));
        q.Upsert("app", "a1", "{\"id\":\"a1\"}");
        q.Upsert("web", "w1", "{\"id\":\"w1\"}");
        q.Upsert("event", "e1", "{\"id\":\"e1\"}");
        q.Upsert("user", "S-1", "{\"sid\":\"S-1\"}");
        await up.FlushAsync(CancellationToken.None);
        var (req, body) = h.Calls[0];
        var root = JsonDocument.Parse(body).RootElement;
        Assert.Equal("tok", root.GetProperty("token").GetString());
        var batch = root.GetProperty("batch");
        Assert.Equal("a1", batch.GetProperty("app_sessions")[0].GetProperty("id").GetString());
        Assert.Equal("w1", batch.GetProperty("web_sessions")[0].GetProperty("id").GetString());
        Assert.Equal("e1", batch.GetProperty("events")[0].GetProperty("id").GetString());
        Assert.Equal("S-1", batch.GetProperty("users")[0].GetProperty("sid").GetString());
        Assert.Equal(Config.AgentVersion, batch.GetProperty("agent_version").GetString());
        Assert.Equal("https://x.supabase.co/rest/v1/rpc/ingest", req.RequestUri!.ToString());
        Assert.Equal("key", req.Headers.GetValues("apikey").Single());
        Assert.Equal("Bearer key", req.Headers.Authorization!.ToString());
        Assert.Equal("childmonitor", req.Headers.GetValues("Content-Profile").Single());
    }

    [Fact]
    public async Task Empty_queue_still_posts_one_batch()
    {
        var (up, _, h, _) = Make((_, _, _) => (HttpStatusCode.OK, Ok));
        Assert.Equal(0, await up.FlushAsync(CancellationToken.None));
        Assert.Single(h.Calls);
        var batch = JsonDocument.Parse(h.Calls[0].Body).RootElement.GetProperty("batch");
        Assert.Equal(Config.AgentVersion, batch.GetProperty("agent_version").GetString());
        Assert.False(batch.TryGetProperty("app_sessions", out _));
    }

    [Fact]
    public async Task Supervised_sids_saved_from_response()
    {
        var (up, _, _, s) = Make((_, _, _) => (HttpStatusCode.OK, "{\"ok\":true,\"accepted\":0,\"supervised_sids\":[\"S-1\"]}"));
        await up.FlushAsync(CancellationToken.None);
        Assert.Equal(new[] { "S-1" }, s.Load());
    }

    [Fact]
    public async Task Offline_schedule_passed_on_from_response()
    {
        var (up, _, _, _) = Make((_, _, _) => (HttpStatusCode.OK, "{\"ok\":true,\"supervised_sids\":[],\"offline\":{\"enabled\":true}}"));
        string? got = null;
        up.OfflineReceived += json => got = json;
        await up.FlushAsync(CancellationToken.None);
        Assert.Equal("{\"enabled\":true}", got);
    }

    [Fact]
    public void Corrupt_supervision_file_loads_empty()
    {
        var path = Path.Combine(_dir, "bad.json");
        File.WriteAllText(path, "{not json");
        Assert.Empty(new SupervisionStore(path).Load());
        Assert.Empty(new SupervisionStore(Path.Combine(_dir, "missing.json")).Load());
    }

    [Fact]
    public void Changed_fires_only_on_difference()
    {
        var s = new SupervisionStore(Path.Combine(_dir, "c.json"));
        var fired = 0;
        s.Changed += _ => fired++;
        s.Save(new[] { "S-1" });
        s.Save(new[] { "S-1" });
        s.Save(new[] { "S-2" });
        Assert.Equal(2, fired);
    }

    private static (HttpStatusCode, string) RejectIfContains(string body, string id) => body.Contains(id)
        ? (HttpStatusCode.BadRequest, "{\"message\":\"bad payload\"}")
        : (HttpStatusCode.OK, Ok);

    [Fact]
    public async Task Poison_batch_is_bisected_and_flush_continues()
    {
        var (up, q, h, _) = Make((_, _, body) => RejectIfContains(body, "id00007"));
        Fill(q, 600);
        Assert.Equal(599, await up.FlushAsync(CancellationToken.None));
        Assert.Empty(q.Oldest(10));
        Assert.Equal(100, Count(h.Calls[^1].Body));
    }

    [Fact]
    public async Task One_bad_row_among_500_drops_only_that_row()
    {
        var (up, q, h, _) = Make((_, _, body) => RejectIfContains(body, "\"id00250\""));
        Fill(q, 500);
        Assert.Equal(499, await up.FlushAsync(CancellationToken.None));
        Assert.Empty(q.Oldest(10));
        var accepted = h.Calls.Where(c => !c.Body.Contains("\"id00250\"")).Sum(c => Count(c.Body));
        Assert.Equal(499, accepted);
        Assert.True(h.Calls.Count <= 2 * 9 + 1, $"{h.Calls.Count} requests");
    }

    [Fact]
    public async Task Stop_during_bisect_keeps_unsent_rows()
    {
        var (up, q, _, _) = Make((n, _, _) => n switch
        {
            1 => (HttpStatusCode.BadRequest, "{\"message\":\"bad payload\"}"),
            2 => (HttpStatusCode.OK, Ok),
            _ => (HttpStatusCode.InternalServerError, ""),
        });
        Fill(q, 500);
        Assert.Equal(250, await up.FlushAsync(CancellationToken.None));
        Assert.Equal(250, q.Oldest(1000).Count);
    }

    [Fact]
    public async Task Invalid_token_keeps_rows_and_stops()
    {
        var (up, q, h, _) = Make((_, _, _) => (HttpStatusCode.BadRequest, "{\"message\":\"invalid token\"}"));
        Fill(q, 600);
        Assert.Equal(0, await up.FlushAsync(CancellationToken.None));
        Assert.Single(h.Calls);
        Assert.Equal(600, q.Oldest(1000).Count);
    }

    [Fact]
    public async Task Network_error_keeps_rows_and_stops()
    {
        var (up, q, h, _) = Make((_, _, _) => throw new HttpRequestException("down"));
        Fill(q, 10);
        Assert.Equal(0, await up.FlushAsync(CancellationToken.None));
        Assert.Single(h.Calls);
        Assert.Equal(10, q.Oldest(100).Count);
    }

    [Fact]
    public async Task Row_upserted_while_in_flight_survives_ack()
    {
        Queue? qq = null;
        var (up, q, _, _) = Make((_, _, _) =>
        {
            qq!.Upsert("app", "a1", "{\"id\":\"a1\",\"v\":2}");
            return (HttpStatusCode.OK, Ok);
        });
        qq = q;
        q.Upsert("app", "a1", "{\"id\":\"a1\",\"v\":1}");
        await up.FlushAsync(CancellationToken.None);
        var left = q.Oldest(10);
        Assert.Single(left);
        Assert.Equal("{\"id\":\"a1\",\"v\":2}", left[0].Json);
    }

    [Fact]
    public async Task Corrupt_row_is_dropped_and_good_row_sent()
    {
        var (up, q, h, _) = Make((_, _, _) => (HttpStatusCode.OK, Ok));
        q.Upsert("app", "bad", "{not json");
        q.Upsert("app", "good", "{\"id\":\"good\"}");
        Assert.Equal(1, await up.FlushAsync(CancellationToken.None));
        Assert.Equal(1, Count(h.Calls[0].Body));
        Assert.Empty(q.Oldest(10));
    }

    [Theory]
    [InlineData("null")]
    [InlineData("[1]")]
    [InlineData("{\"supervised_sids\":[1,null]}")]
    public async Task Odd_success_body_still_acks_rows(string body)
    {
        var (up, q, _, _) = Make((_, _, _) => (HttpStatusCode.OK, body));
        Fill(q, 3);
        Assert.Equal(3, await up.FlushAsync(CancellationToken.None));
        Assert.Empty(q.Oldest(10));
    }

    [Fact]
    public async Task Supervision_save_failure_still_acks_rows()
    {
        var q = new Queue(Path.Combine(_dir, "q.db"));
        var h = new FakeHandler((_, _, _) => (HttpStatusCode.OK, "{\"supervised_sids\":[\"S-1\"]}"));
        var blocker = Path.Combine(_dir, "file");
        File.WriteAllText(blocker, "x");
        var up = new Uploader(q, new HttpClient(h), _cfg, new SupervisionStore(Path.Combine(blocker, "s.json")));
        Fill(q, 2);
        Assert.Equal(2, await up.FlushAsync(CancellationToken.None));
        Assert.Empty(q.Oldest(10));
    }

    [Fact]
    public async Task Not_found_keeps_rows_and_stops()
    {
        var (up, q, h, _) = Make((_, _, _) => (HttpStatusCode.NotFound, "{\"message\":\"no function\"}"));
        Fill(q, 600);
        Assert.Equal(0, await up.FlushAsync(CancellationToken.None));
        Assert.Single(h.Calls);
        Assert.Equal(600, q.Oldest(1000).Count);
    }

    [Fact]
    public void Wire_writes_snake_case_and_utc_timestamps()
    {
        var t = new DateTimeOffset(2026, 11, 18, 17, 0, 0, TimeSpan.FromHours(2));
        var json = JsonSerializer.Serialize(new AppRow("i", "u", "p.exe", "C:\\p.exe", "t", t, t), Wire.Options);
        var root = JsonDocument.Parse(json).RootElement;
        Assert.Equal("2026-11-18T15:00:00Z", root.GetProperty("started_at").GetString());
        Assert.Equal("p.exe", root.GetProperty("process").GetString());
        Assert.True(root.TryGetProperty("exe_path", out _));
        Assert.True(root.TryGetProperty("win_user", out _));
    }

    [Fact]
    public void AgentVersion_IsStampedFromVersionJson()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "../../../../../version.json");
        var v = JsonDocument.Parse(File.ReadAllText(path)).RootElement;
        Assert.Equal($"{v.GetProperty("version").GetString()} ({v.GetProperty("date").GetString()})", Config.AgentVersion);
    }
}
