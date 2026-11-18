using Microsoft.Data.Sqlite;

namespace Core;

public sealed record Visit(long Id, string Url, string Title, DateTimeOffset At);

/// <summary>Reads a Chrome/Edge <c>History</c> SQLite file while the browser holds it open.</summary>
public static class BrowserHistory
{
    private static readonly DateTimeOffset WebKitEpoch = new(1601, 1, 1, 0, 0, 0, TimeSpan.Zero);
    private const int MaxRows = 5000;

    /// <summary>
    /// Top-frame visits with id &gt; <paramref name="afterId"/> at or after <paramref name="notBefore"/>, oldest first.
    /// Opened with <c>immutable=1</c> (no locks): the browser keeps an exclusive lock, so a torn read can throw
    /// <see cref="SqliteException"/> — callers retry on the next poll.
    /// </summary>
    public static IReadOnlyList<Visit> ReadSince(string path, long afterId, DateTimeOffset notBefore)
    {
        using var db = Open(path);
        using var cmd = db.CreateCommand();
        // transition & 0xFF: 3 = AUTO_SUBFRAME, 4 = MANUAL_SUBFRAME (iframes, not pages the child opened).
        cmd.CommandText = """
            select v.id, v.visit_time, u.url, coalesce(u.title, '') from visits v join urls u on u.id = v.url
            where v.id > $after and v.visit_time >= $since and (v.transition & 255) not in (3, 4)
            order by v.id limit $max
            """;
        cmd.Parameters.AddWithValue("$after", afterId);
        cmd.Parameters.AddWithValue("$since", ToWebKit(notBefore));
        cmd.Parameters.AddWithValue("$max", MaxRows);
        var visits = new List<Visit>();
        using var r = cmd.ExecuteReader();
        while (r.Read()) visits.Add(new Visit(r.GetInt64(0), r.GetString(2), r.GetString(3), FromWebKit(r.GetInt64(1))));
        return visits;
    }

    /// <summary>Highest visit id; lower than a saved cursor means the file was deleted and recreated.</summary>
    public static long MaxVisitId(string path)
    {
        using var db = Open(path);
        using var cmd = db.CreateCommand();
        cmd.CommandText = "select coalesce(max(id), 0) from visits";
        return (long)cmd.ExecuteScalar()!;
    }

    /// <summary>SQLite URI (not <see cref="Uri"/>, which decodes "%41" in a user name) with no locks taken.</summary>
    public static string UriFor(string path)
    {
        var p = path.Replace('\\', '/').Replace("%", "%25").Replace("#", "%23").Replace("?", "%3f");
        return "file://" + (p.StartsWith('/') ? "" : "/") + p + "?immutable=1";
    }

    private static SqliteConnection Open(string path)
    {
        var cs = new SqliteConnectionStringBuilder
        {
            DataSource = UriFor(path), Mode = SqliteOpenMode.ReadOnly, Pooling = false,
        }.ToString();
        var db = new SqliteConnection(cs);
        db.Open();
        return db;
    }

    public static long ToWebKit(DateTimeOffset t) => (t - WebKitEpoch).Ticks / 10;

    public static DateTimeOffset FromWebKit(long microseconds) => WebKitEpoch.AddTicks(microseconds * 10);
}

/// <summary>Maps a browser window title to the page the child is looking at.</summary>
public static class SiteMatcher
{
    /// <summary>"chrome" / "edge" for the tracked browsers' process names, else null.</summary>
    public static string? BrowserOf(string process) => process.ToLowerInvariant() switch
    {
        "chrome.exe" => "chrome",
        "msedge.exe" => "edge",
        _ => null,
    };

    /// <summary>
    /// Window titles are "&lt;page title&gt;[ and N more pages][ - profile] - Google Chrome|Microsoft Edge" (localized),
    /// so pick the visit whose title is the longest prefix ending at a space or the end; newest wins ties.
    /// ponytail: a page missing from history can match a shorter title ("Google" for "Google Docs").
    /// </summary>
    public static Visit? Match(string windowTitle, IEnumerable<Visit> visits)
    {
        Visit? best = null;
        var bestLen = 0;
        foreach (var v in visits)
        {
            var t = v.Title.Length > PipeLine.MaxTitle ? v.Title[..PipeLine.MaxTitle] : v.Title;
            if (t.Length == 0 || !windowTitle.StartsWith(t, StringComparison.Ordinal)) continue;
            if (windowTitle.Length > t.Length && windowTitle[t.Length] != ' ') continue;
            if (t.Length > bestLen || (t.Length == bestLen && v.At >= best!.At)) (best, bestLen) = (v, t.Length);
        }
        return best;
    }
}
