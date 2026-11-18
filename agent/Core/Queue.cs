using Microsoft.Data.Sqlite;

namespace Core;

public sealed record QueuedRow(long Seq, string Type, string Json);

public sealed class Queue
{
    private readonly string _connStr;

    public Queue(string dbPath)
    {
        _connStr = new SqliteConnectionStringBuilder { DataSource = dbPath }.ToString();
        using var c = Open();
        Exec(c, "create table if not exists queue(seq integer primary key autoincrement, " +
                "type text not null, id text not null unique, json text not null)");
    }

    private SqliteConnection Open()
    {
        var c = new SqliteConnection(_connStr);
        c.Open();
        Exec(c, "PRAGMA journal_mode=WAL;");
        Exec(c, "PRAGMA busy_timeout=5000;");
        return c;
    }

    private static void Exec(SqliteConnection c, string sql, params (string, object)[] args)
    {
        using var cmd = c.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (name, value) in args) cmd.Parameters.AddWithValue(name, value);
        cmd.ExecuteNonQuery();
    }

    public void Upsert(string type, string id, string json)
    {
        using var c = Open();
        Exec(c, "insert into queue(type, id, json) values($t, $i, $j) " +
                "on conflict(id) do update set json = excluded.json",
            ("$t", type), ("$i", id), ("$j", json));
    }

    public IReadOnlyList<QueuedRow> Oldest(int max)
    {
        using var c = Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "select seq, type, json from queue order by seq limit $n";
        cmd.Parameters.AddWithValue("$n", max);
        using var r = cmd.ExecuteReader();
        var list = new List<QueuedRow>();
        while (r.Read()) list.Add(new QueuedRow(r.GetInt64(0), r.GetString(1), r.GetString(2)));
        return list;
    }

    /// <summary>Deletes rows only if unchanged since read, so a re-upserted newer version survives.</summary>
    public void Delete(IEnumerable<QueuedRow> rows)
    {
        using var c = Open();
        using var tx = c.BeginTransaction();
        foreach (var r in rows)
            Exec(c, "delete from queue where seq = $s and json = $j", ("$s", r.Seq), ("$j", r.Json));
        tx.Commit();
    }
}
