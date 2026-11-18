using System.ServiceProcess;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Hosting.WindowsServices;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Service;

internal static class Program
{
    public const string ServiceName = "ChildMonitorSvc";

    private static void Main(string[] args)
    {
        var builder = Host.CreateApplicationBuilder(args);
        builder.Logging.ClearProviders();
        builder.Logging.AddEventLog(o => o.SourceName = ServiceName);
        builder.Services.AddWindowsService(o => o.ServiceName = ServiceName);
        builder.Services.AddSingleton<Worker>();
        builder.Services.AddHostedService(sp => sp.GetRequiredService<Worker>());
        if (WindowsServiceHelpers.IsWindowsService())
            builder.Services.AddSingleton<IHostLifetime, EventForwardingLifetime>();
        builder.Build().Run();
    }
}

/// <summary>Windows service lifetime that also forwards session, power and shutdown notifications.</summary>
internal sealed class EventForwardingLifetime : WindowsServiceLifetime
{
    private readonly Worker _worker;

    public EventForwardingLifetime(IHostEnvironment env, IHostApplicationLifetime app, ILoggerFactory logs,
        IOptions<HostOptions> host, IOptions<WindowsServiceLifetimeOptions> svc, Worker worker)
        : base(env, app, logs, host, svc)
    {
        _worker = worker;
        CanHandleSessionChangeEvent = true;
        CanHandlePowerEvent = true;
        CanShutdown = true;
    }

    protected override void OnSessionChange(SessionChangeDescription change)
    {
        _worker.OnSessionChange(change.Reason, change.SessionId);
        base.OnSessionChange(change);
    }

    protected override bool OnPowerEvent(PowerBroadcastStatus status)
    {
        _worker.OnPowerEvent(status);
        return base.OnPowerEvent(status);
    }

    protected override void OnShutdown()
    {
        _worker.OnShutdown();
        base.OnShutdown();
    }
}
