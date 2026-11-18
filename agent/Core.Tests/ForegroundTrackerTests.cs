namespace Core.Tests;

public sealed class ForegroundTrackerTests
{
    private static readonly DateTimeOffset T0 = new(2026, 11, 18, 15, 0, 0, TimeSpan.Zero);
    private int _n;

    private ForegroundTracker NewTracker() =>
        new("PC\\noa", () => new Guid(++_n, 0, 0, new byte[8]));

    private static Sample S(string proc, string title = "t", int idle = 0, bool locked = false) =>
        new(proc, "C:\\" + proc, title, TimeSpan.FromSeconds(idle), locked);

    [Fact]
    public void title_change_closes_and_opens()
    {
        var t = NewTracker();
        Assert.Empty(t.Observe(S("a.exe", "one"), T0));
        var rows = t.Observe(S("a.exe", "two"), T0.AddSeconds(10)).ToList();
        var closed = Assert.Single(rows);
        Assert.Equal("one", closed.Title);
        Assert.Equal(T0, closed.StartedAt);
        Assert.Equal(T0.AddSeconds(10), closed.EndedAt);
        Assert.Equal("PC\\noa", closed.WinUser);
        var next = t.Observe(S("a.exe", "two"), T0.AddSeconds(70)).Single();
        Assert.Equal("two", next.Title);
        Assert.Equal(T0.AddSeconds(10), next.StartedAt);
        Assert.NotEqual(closed.Id, next.Id);
    }

    [Fact]
    public void process_change_closes_and_opens()
    {
        var t = NewTracker();
        t.Observe(S("a.exe"), T0);
        var closed = t.Observe(S("b.exe"), T0.AddSeconds(5)).Single();
        Assert.Equal("a.exe", closed.Process);
    }

    [Fact]
    public void idle_closes_session()
    {
        var t = NewTracker();
        t.Observe(S("a.exe"), T0);
        var rows = t.Observe(S("a.exe", idle: 121), T0.AddSeconds(5)).ToList();
        Assert.Single(rows);
        Assert.Equal(T0, rows[0].EndedAt);
        Assert.Empty(t.Observe(S("a.exe", idle: 130), T0.AddSeconds(10)));
        Assert.Empty(t.Observe(S("a.exe", idle: 200), T0.AddSeconds(70)));
    }

    [Fact]
    public void idle_close_ends_at_last_input()
    {
        var t = NewTracker();
        t.Observe(S("a.exe"), T0);
        t.Observe(S("a.exe"), T0.AddSeconds(60));
        var row = t.Observe(S("a.exe", idle: 121), T0.AddSeconds(200)).Single();
        Assert.Equal(T0.AddSeconds(79), row.EndedAt);
    }

    [Fact]
    public void activity_after_idle_opens_new_session()
    {
        var t = NewTracker();
        t.Observe(S("a.exe"), T0);
        var first = t.Observe(S("a.exe", idle: 121), T0.AddSeconds(5)).Single();
        t.Observe(S("a.exe"), T0.AddSeconds(100));
        var second = t.Observe(S("a.exe"), T0.AddSeconds(160)).Single();
        Assert.NotEqual(first.Id, second.Id);
        Assert.Equal(T0.AddSeconds(100), second.StartedAt);
    }

    [Fact]
    public void unchanged_reemits_every_60s()
    {
        var t = NewTracker();
        var all = new List<AppRow>();
        for (var s = 0; s <= 65; s += 5) all.AddRange(t.Observe(S("a.exe"), T0.AddSeconds(s)));
        var row = Assert.Single(all);
        Assert.Equal(T0.AddSeconds(60), row.EndedAt);
        Assert.Equal(T0, row.StartedAt);
        var again = t.Observe(S("a.exe"), T0.AddSeconds(120)).Single();
        Assert.Equal(row.Id, again.Id);
        Assert.Equal(T0.AddSeconds(120), again.EndedAt);
    }

    [Fact]
    public void locked_closes_session()
    {
        var t = NewTracker();
        t.Observe(S("a.exe"), T0);
        Assert.Single(t.Observe(S("a.exe", locked: true), T0.AddSeconds(5)));
        Assert.Empty(t.Observe(S("a.exe", locked: true), T0.AddSeconds(10)));
    }

    [Fact]
    public void long_title_truncated()
    {
        var t = NewTracker();
        t.Observe(S("a.exe", new string('x', 500)), T0);
        var row = t.Observe(S("b.exe"), T0.AddSeconds(5)).Single();
        Assert.Equal(300, row.Title.Length);
    }

    [Fact]
    public void no_window_closes_session()
    {
        var t = NewTracker();
        t.Observe(S("a.exe"), T0);
        Assert.Single(t.Observe(S(""), T0.AddSeconds(5)));
    }
}
