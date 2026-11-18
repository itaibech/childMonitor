using System.Text.Json;

namespace Core.Tests;

public sealed class ServiceRowsTests
{
    private static readonly DateTimeOffset T = new(2026, 11, 18, 15, 0, 0, TimeSpan.FromHours(2));

    [Fact]
    public void Event_has_wire_shape_with_empty_detail_by_default()
    {
        var item = ServiceRows.Event("heartbeat", "", T, "id-9");
        Assert.Equal("event", item.Type);
        Assert.Equal("id-9", item.Id);
        Assert.Equal(
            "{\"id\":\"id-9\",\"win_user\":\"\",\"kind\":\"heartbeat\",\"detail\":{},\"at\":\"2026-11-18T13:00:00Z\"}",
            item.Json);
    }

    [Fact]
    public void Browser_blocked_event_carries_exe_detail()
    {
        var item = ServiceRows.BrowserBlocked(@"PC\kid", "firefox.exe", T, "id-1");
        var row = JsonSerializer.Deserialize<EventRow>(item.Json, Wire.Options)!;
        Assert.Equal("browser_blocked", row.Kind);
        Assert.Equal(@"PC\kid", row.WinUser);
        Assert.Equal("firefox.exe", row.Detail.GetProperty("exe").GetString());
    }

    [Fact]
    public void User_is_keyed_by_sid()
    {
        var item = ServiceRows.User(new UserRow("S-1", @"PC\kid", false));
        Assert.Equal(("user", "S-1"), (item.Type, item.Id));
        Assert.Equal("{\"sid\":\"S-1\",\"win_user\":\"PC\\\\kid\",\"is_admin\":false}", item.Json);
    }
}
