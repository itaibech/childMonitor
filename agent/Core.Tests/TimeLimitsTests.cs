using Core;
using Xunit;

namespace Core.Tests;

public class TimeLimitsTests
{
    private static readonly TimeZoneInfo Israel = TimeZoneInfo.CreateCustomTimeZone("t", TimeSpan.FromHours(2), "t", "t");
    private static DateTimeOffset At(int day, int hour, int minute = 0) => new(2026, 11, day, hour, minute, 0, TimeSpan.FromHours(2));
    private static AppRow Row(string id, string process, DateTimeOffset start, DateTimeOffset end) => new(id, "PC\\kid", process, "", "", start, end);

    [Fact]
    public void ParsesServerLimits_LowercasingApps()
    {
        var list = TimeLimit.ParseList("""[{"id":"1","name":"Games","minutes":60,"apps":["RobloxPlayerBeta.exe","minecraft.exe"]}]""")!;
        Assert.Equal(new[] { "robloxplayerbeta.exe", "minecraft.exe" }, list[0].Apps);
        Assert.Equal(60, list[0].Minutes);
        Assert.Null(TimeLimit.ParseList("{}"));
        Assert.Null(TimeLimit.ParseList("not json"));
    }

    [Fact]
    public void State_WarnsFiveMinutesBefore_ThenOver()
    {
        var limit = new TimeLimit("1", "Games", 60, ["a.exe"]);
        Assert.Equal(LimitState.Ok, limit.StateFor(TimeSpan.FromMinutes(54)));
        Assert.Equal(LimitState.Warn, limit.StateFor(TimeSpan.FromMinutes(55)));
        Assert.Equal(LimitState.Over, limit.StateFor(TimeSpan.FromMinutes(60)));
    }

    [Fact]
    public void Usage_ReplacesRefreshedRows_AndSumsCoveredApps()
    {
        var u = new UsageToday(Israel);
        u.Add(Row("r1", "RobloxPlayerBeta.exe", At(20, 10), At(20, 10, 1)), At(20, 10, 1));
        u.Add(Row("r1", "RobloxPlayerBeta.exe", At(20, 10), At(20, 10, 30)), At(20, 10, 30)); // 60 s refresh, same id
        u.Add(Row("r2", "minecraft.exe", At(20, 11), At(20, 11, 15)), At(20, 11, 15));
        u.Add(Row("r3", "chrome.exe", At(20, 12), At(20, 13)), At(20, 13));
        Assert.Equal(TimeSpan.FromMinutes(30), u.Used(["robloxplayerbeta.exe"], At(20, 14)));
        Assert.Equal(TimeSpan.FromMinutes(45), u.Used(["robloxplayerbeta.exe", "minecraft.exe"], At(20, 14)));
    }

    [Fact]
    public void Usage_StartsFromZeroAtLocalMidnight_CountingOnlyAfterIt()
    {
        var u = new UsageToday(Israel);
        u.Add(Row("r1", "a.exe", At(19, 20), At(19, 22)), At(19, 22));
        u.Add(Row("r2", "a.exe", At(19, 23, 30), At(20, 0, 20)), At(20, 0, 20));
        Assert.Equal(TimeSpan.FromMinutes(20), u.Used(["a.exe"], At(20, 1)));
    }

    [Fact]
    public void Usage_SurvivesARestart()
    {
        var u = new UsageToday(Israel);
        u.Add(Row("r1", "a.exe", At(20, 10), At(20, 10, 40)), At(20, 10, 40));
        var back = UsageToday.FromJson(u.ToJson(), Israel);
        Assert.Equal(TimeSpan.FromMinutes(40), back.Used(["a.exe"], At(20, 11)));
        Assert.Equal(TimeSpan.Zero, UsageToday.FromJson("garbage", Israel).Used(["a.exe"], At(20, 11)));
    }
}
