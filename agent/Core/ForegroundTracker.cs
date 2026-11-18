namespace Core;

public sealed record Sample(string Process, string ExePath, string Title, TimeSpan Idle, bool Locked);

public sealed class ForegroundTracker
{
    public static readonly TimeSpan IdleThreshold = TimeSpan.FromSeconds(120);
    public static readonly TimeSpan RefreshEvery = TimeSpan.FromSeconds(60);
    public const int MaxTitle = 300;

    private sealed record Open(Guid Id, string Process, string ExePath, string Title,
        DateTimeOffset StartedAt, DateTimeOffset LastEmit, DateTimeOffset LastEnd);

    private readonly string _winUser;
    private readonly Func<Guid> _newId;
    private Open? _open;

    public ForegroundTracker(string winUser, Func<Guid> newId)
    {
        _winUser = winUser;
        _newId = newId;
    }

    public IEnumerable<AppRow> Observe(Sample s, DateTimeOffset nowUtc)
    {
        var rows = new List<AppRow>(1);
        var title = s.Title.Length > MaxTitle ? s.Title[..MaxTitle] : s.Title;
        var active = !s.Locked && s.Idle < IdleThreshold && s.Process.Length > 0;
        var changed = _open is not null && (!active || _open.Process != s.Process || _open.Title != title);

        if (changed)
        {
            rows.Add(ToRow(_open!, EndFor(_open!, s, nowUtc)));
            _open = null;
        }
        if (active && _open is null)
            _open = new Open(_newId(), s.Process, s.ExePath, title, nowUtc, nowUtc, nowUtc);
        else if (_open is not null && nowUtc - _open.LastEmit >= RefreshEvery)
        {
            var end = EndFor(_open, s, nowUtc);
            rows.Add(ToRow(_open, end));
            _open = _open with { LastEmit = nowUtc, LastEnd = end };
        }
        return rows;
    }

    // Idle time is not usage and the server keeps greatest(ended_at), so every emitted end is
    // non-decreasing and never passes the last input. A lock close ends now.
    private static DateTimeOffset EndFor(Open o, Sample s, DateTimeOffset now)
    {
        var end = s.Locked ? now : now - s.Idle;
        if (end < o.StartedAt) end = o.StartedAt;
        return end < o.LastEnd ? o.LastEnd : end;
    }

    private AppRow ToRow(Open o, DateTimeOffset end) =>
        new(o.Id.ToString(), _winUser, o.Process, o.ExePath, o.Title, o.StartedAt, end);
}
