namespace Core;

public sealed record Sample(string Process, string ExePath, string Title, TimeSpan Idle, bool Locked);

public sealed class ForegroundTracker
{
    public static readonly TimeSpan IdleThreshold = TimeSpan.FromSeconds(120);
    public static readonly TimeSpan RefreshEvery = TimeSpan.FromSeconds(60);
    public const int MaxTitle = 300;

    private sealed record Open(Guid Id, string Process, string ExePath, string Title,
        DateTimeOffset StartedAt, DateTimeOffset LastEmit);

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
            rows.Add(ToRow(_open!, nowUtc));
            _open = null;
        }
        if (active && _open is null)
            _open = new Open(_newId(), s.Process, s.ExePath, title, nowUtc, nowUtc);
        else if (_open is not null && nowUtc - _open.LastEmit >= RefreshEvery)
        {
            rows.Add(ToRow(_open, nowUtc));
            _open = _open with { LastEmit = nowUtc };
        }
        return rows;
    }

    private AppRow ToRow(Open o, DateTimeOffset end) =>
        new(o.Id.ToString(), _winUser, o.Process, o.ExePath, o.Title, o.StartedAt, end);
}
