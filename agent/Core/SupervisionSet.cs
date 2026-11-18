namespace Core;

public static class SupervisionSet
{
    /// <summary>Sessions whose Helper must start (SID became supervised) or stop (SID no longer supervised).</summary>
    public static (int[] start, int[] stop) Diff(IReadOnlySet<string> before, IReadOnlySet<string> after,
        IReadOnlyDictionary<int, string> sessionSids)
    {
        var start = sessionSids.Where(s => !before.Contains(s.Value) && after.Contains(s.Value)).Select(s => s.Key);
        var stop = sessionSids.Where(s => before.Contains(s.Value) && !after.Contains(s.Value)).Select(s => s.Key);
        return (start.Order().ToArray(), stop.Order().ToArray());
    }
}

public static class SupervisionPolicy
{
    /// <summary>
    /// Effective supervised SIDs. <paramref name="stored"/> is null until the server has answered once
    /// (no supervised.json yet); until then every non-admin account is supervised.
    /// </summary>
    public static IReadOnlySet<string> Effective(IReadOnlySet<string>? stored, IEnumerable<UserRow> accounts) =>
        stored ?? accounts.Where(a => !a.IsAdmin).Select(a => a.Sid).ToHashSet();
}
