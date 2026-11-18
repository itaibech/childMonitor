using Core;
using Xunit;

public class OfflineScheduleTests
{
    private const string Json = """{"enabled":true,"weekday":{"from":"21:30","to":"07:00"},"weekend":{"from":"23:00","to":"08:00"}}""";
    private static readonly OfflineSchedule S = OfflineSchedule.Parse(Json)!;

    // 2026-11-15 is a Sunday, 11-20 a Friday, 11-21 a Saturday.
    [Theory]
    [InlineData("2026-11-15 21:29", false)] // Sunday evening before the weekday night starts
    [InlineData("2026-11-15 21:30", true)]
    [InlineData("2026-11-16 03:00", true)]  // after midnight, still Sunday's night
    [InlineData("2026-11-16 07:00", false)] // morning end is exclusive
    [InlineData("2026-11-20 22:00", false)] // Friday uses the weekend night (23:00)
    [InlineData("2026-11-21 07:30", true)]  // Saturday morning, Friday's night ends 08:00
    [InlineData("2026-11-21 23:30", true)]  // Saturday night is a weekend night
    [InlineData("2026-11-22 21:45", true)]  // Sunday night is a weekday night again
    public void Knows_when_the_internet_is_off(string at, bool off) =>
        Assert.Equal(off, S.IsOffline(DateTime.Parse(at)));

    [Fact]
    public void Same_day_window_and_disabled_and_bad_input()
    {
        var day = OfflineSchedule.Parse("""{"enabled":true,"weekday":{"from":"13:00","to":"15:00"},"weekend":{"from":"00:00","to":"00:00"}}""")!;
        Assert.True(day.IsOffline(DateTime.Parse("2026-11-16 14:00")));
        Assert.False(day.IsOffline(DateTime.Parse("2026-11-16 15:00")));
        Assert.False(day.IsOffline(DateTime.Parse("2026-11-21 12:00"))); // from == to: no offline time
        Assert.False(OfflineSchedule.Parse(Json.Replace("true", "false"))!.IsOffline(DateTime.Parse("2026-11-16 03:00")));
        Assert.Null(OfflineSchedule.Parse("null"));
        Assert.Null(OfflineSchedule.Parse("""{"enabled":true,"weekday":{"from":"25:00","to":"07:00"}}"""));
        Assert.Null(OfflineSchedule.Parse("not json"));
    }
}
