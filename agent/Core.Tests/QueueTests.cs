namespace Core.Tests;

public sealed class QueueTests : IDisposable
{
    private readonly string _dir = Directory.CreateTempSubdirectory("cmq").FullName;

    public void Dispose()
    {
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        Directory.Delete(_dir, true);
    }

    private Queue NewQueue() => new(Path.Combine(_dir, "q.db"));

    [Fact]
    public void Upsert_same_id_replaces()
    {
        var q = NewQueue();
        q.Upsert("app", "a", "{\"v\":1}");
        q.Upsert("app", "a", "{\"v\":2}");
        var rows = q.Oldest(10);
        Assert.Single(rows);
        Assert.Equal("{\"v\":2}", rows[0].Json);
    }

    [Fact]
    public void Upsert_keeps_first_seen_order()
    {
        var q = NewQueue();
        q.Upsert("app", "a", "1");
        q.Upsert("app", "b", "2");
        q.Upsert("app", "a", "3");
        Assert.Equal(new[] { "3", "2" }, q.Oldest(10).Select(r => r.Json));
    }

    [Fact]
    public void Delete_removes_only_given_rows_and_persists()
    {
        var q = NewQueue();
        q.Upsert("app", "a", "1");
        q.Upsert("web", "b", "2");
        q.Delete(new[] { q.Oldest(1)[0] });
        var left = NewQueue().Oldest(10);
        Assert.Single(left);
        Assert.Equal("web", left[0].Type);
    }
}
