namespace Core.Tests;

public sealed class SupervisionTests
{
    private static IReadOnlySet<string> Set(params string[] s) => new HashSet<string>(s);

    [Fact]
    public void SupervisionSet_diff_yields_start_and_stop()
    {
        var sessions = new Dictionary<int, string> { [2] = "S-a", [3] = "S-b" };
        var (start, stop) = SupervisionSet.Diff(Set("S-a"), Set("S-b"), sessions);
        Assert.Equal(new[] { 3 }, start);
        Assert.Equal(new[] { 2 }, stop);
    }

    [Fact]
    public void Diff_unchanged_sids_yield_nothing_and_all_sessions_of_a_user_move_together()
    {
        var sessions = new Dictionary<int, string> { [5] = "S-a", [1] = "S-a", [4] = "S-c" };
        var (start, stop) = SupervisionSet.Diff(Set("S-c"), Set("S-a", "S-c"), sessions);
        Assert.Equal(new[] { 1, 5 }, start);
        Assert.Empty(stop);
    }

    private static readonly UserRow[] Accounts =
    [
        new("S-kid", @"PC\kid", false),
        new("S-dad", @"PC\dad", true),
    ];

    [Fact]
    public void Policy_first_run_supervises_non_admin_accounts()
    {
        Assert.Equal(Set("S-kid"), SupervisionPolicy.Effective(null, Accounts));
    }

    [Fact]
    public void Policy_uses_stored_set_once_server_answered_even_if_empty()
    {
        Assert.Equal(Set("S-dad"), SupervisionPolicy.Effective(Set("S-dad"), Accounts));
        Assert.Empty(SupervisionPolicy.Effective(Set(), Accounts));
    }
}
