using System.Text;
using System.Text.Json;

namespace Core.Tests;

public sealed class NativeMessageReaderTests
{
    private static byte[] Frame(string json)
    {
        var body = Encoding.UTF8.GetBytes(json);
        return BitConverter.GetBytes(body.Length).Concat(body).ToArray();
    }

    private static List<string> ReadAll(byte[] bytes) =>
        NativeMessageReader.Read(new MemoryStream(bytes)).ToList();

    [Fact]
    public void reads_one_message() =>
        Assert.Equal(new[] { "{\"a\":1}" }, ReadAll(Frame("{\"a\":1}")));

    [Fact]
    public void reads_two_back_to_back_with_utf8()
    {
        var bytes = Frame("{\"t\":\"שלום\"}").Concat(Frame("{\"b\":2}")).ToArray();
        Assert.Equal(new[] { "{\"t\":\"שלום\"}", "{\"b\":2}" }, ReadAll(bytes));
    }

    [Fact]
    public void eof_mid_frame_stops_cleanly()
    {
        var bytes = Frame("{\"a\":1}").Concat(Frame("{\"b\":2}").Take(6)).ToArray();
        Assert.Equal(new[] { "{\"a\":1}" }, ReadAll(bytes));
    }

    [Fact]
    public void eof_mid_header_stops_cleanly() =>
        Assert.Empty(ReadAll(new byte[] { 5, 0 }));

    [Fact]
    public void oversized_message_skipped()
    {
        var big = Frame("\"" + new string('x', NativeMessageReader.MaxBytes + 10) + "\"");
        var bytes = big.Concat(Frame("{\"ok\":1}")).ToArray();
        Assert.Equal(new[] { "{\"ok\":1}" }, ReadAll(bytes));
    }

    [Fact]
    public void web_message_gets_win_user_and_wraps()
    {
        var json = "{\"id\":\"i1\",\"browser\":\"chrome\",\"url\":\"https://x.com\",\"title\":\"T\"," +
                   "\"started_at\":\"2026-11-18T15:00:00Z\",\"ended_at\":\"2026-11-18T15:01:00Z\"}";
        var line = PipeLine.FromExtension(json, "PC\\noa")!;
        var msg = JsonSerializer.Deserialize<PipeMessage>(line, Wire.Options)!;
        Assert.Equal("web", msg.Type);
        var row = msg.Row.Deserialize<WebRow>(Wire.Options)!;
        Assert.Equal("i1", row.Id);
        Assert.Equal("PC\\noa", row.WinUser);
        Assert.Equal("chrome", row.Browser);
        Assert.Contains("\"win_user\":\"PC\\\\noa\"", line);
        Assert.DoesNotContain('\n', line);
    }

    [Fact]
    public void web_message_truncates_and_rejects_garbage()
    {
        var json = "{\"id\":\"i\",\"browser\":\"edge\",\"url\":\"" + new string('u', 3000) + "\",\"title\":\"" +
                   new string('t', 400) + "\",\"started_at\":\"2026-11-18T15:00:00Z\",\"ended_at\":\"2026-11-18T15:01:00Z\"}";
        var msg = JsonSerializer.Deserialize<PipeMessage>(PipeLine.FromExtension(json, "u")!, Wire.Options)!;
        var row = msg.Row.Deserialize<WebRow>(Wire.Options)!;
        Assert.Equal(2000, row.Url.Length);
        Assert.Equal(300, row.Title.Length);
        Assert.Null(PipeLine.FromExtension("not json", "u"));
        Assert.Null(PipeLine.FromExtension("{\"id\":\"i\"}", "u"));
    }

    [Theory]
    [InlineData("\"garbage\"")]
    [InlineData("null")]
    [InlineData("\"\"")]
    public void web_message_with_bad_date_is_rejected(string startedAt)
    {
        var json = "{\"id\":\"i\",\"browser\":\"edge\",\"url\":\"https://x\",\"title\":\"t\"," +
                   "\"started_at\":" + startedAt + ",\"ended_at\":\"2026-11-18T15:01:00Z\"}";
        Assert.Null(PipeLine.FromExtension(json, "u"));
    }

    [Fact]
    public void send_buffer_drops_oldest_beyond_capacity()
    {
        var b = new SendBuffer(3);
        foreach (var s in new[] { "1", "2", "3", "4" }) b.Add(s);
        Assert.Equal(new[] { "2", "3", "4" }, b.Drain());
        Assert.Empty(b.Drain());
    }

    [Fact]
    public void send_buffer_requeue_keeps_order_and_cap()
    {
        var b = new SendBuffer(3);
        b.Add("1"); b.Add("2");
        var items = b.Drain();
        b.Add("3");
        b.Requeue(items);
        Assert.Equal(new[] { "1", "2", "3" }, b.Drain());
    }
}
