using System.ServiceProcess;
using Core;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Service;

/// <summary>Wires Core to Windows: supervision, Helper sessions, pipe, browser killer, events and upload loops.</summary>
internal sealed class Worker : BackgroundService
{
    public const string DataDir = @"C:\ProgramData\ChildMonitor";
    private static readonly TimeSpan UploadEvery = TimeSpan.FromMinutes(5); // also flushed before sleep/shutdown
    private static readonly TimeSpan SettingsEvery = TimeSpan.FromMinutes(1); // limits and extensions land within a minute
    private static readonly TimeSpan CheckEvery = TimeSpan.FromSeconds(30);
    private static readonly TimeSpan HeartbeatEvery = TimeSpan.FromSeconds(300);
    private static readonly TimeSpan UsersEvery = TimeSpan.FromHours(1);
    private static readonly TimeSpan BlockingFlushLimit = TimeSpan.FromSeconds(4);

    private readonly Queue _queue = new(Path.Combine(DataDir, "queue.db"));
    private readonly SupervisionStore _store = new(SupervisionStore.DefaultPath);
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(30) };
    private readonly Uploader _uploader;
    private readonly SessionLauncher _sessions;
    private readonly PipeServer _pipe;
    private readonly BrowserKiller _killer;
    private readonly SiteTracker _sites;
    private readonly OfflineTime _offline;
    private readonly TimeLimitEnforcer _limits;
    private readonly ILogger<Worker> _log;
    private readonly object _gate = new();
    private volatile IReadOnlySet<string> _supervised = new HashSet<string>();

    public Worker(ILoggerFactory logs)
    {
        _log = logs.CreateLogger<Worker>();
        _uploader = new Uploader(_queue, _http, Config.Load(), _store);
        _sessions = new SessionLauncher(logs.CreateLogger<SessionLauncher>());
        _sites = new SiteTracker(Enqueue, logs.CreateLogger<SiteTracker>());
        _limits = new TimeLimitEnforcer(_sessions, () => _supervised, Enqueue, logs.CreateLogger<TimeLimitEnforcer>());
        _pipe = new PipeServer(_queue, () => _supervised, (sid, row) => { _sites.OnPipeRow(sid, row); _limits.OnPipeRow(sid, row); },
            logs.CreateLogger<PipeServer>());
        _killer = new BrowserKiller(_sessions, () => _supervised, Enqueue, _limits.IsOver, logs.CreateLogger<BrowserKiller>());
        _offline = new OfflineTime(_sessions, () => _supervised, Record, logs.CreateLogger<OfflineTime>());
        _uploader.OfflineReceived += json => Guard(() => _offline.Update(json));
        _uploader.LimitsReceived += json => Guard(() => _limits.Update(json));
        _store.Changed += OnSupervisionChanged;
    }

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        Record("agent_start", "");
        _sessions.KillOrphans();
        if (File.Exists(SupervisionStore.DefaultPath)) SetSupervised(_store.Load());
        StartKiller();
        await Task.WhenAll(
            _pipe.RunAsync(ct),
            Every(UsersEvery, ReportUsers, ct),
            Every(UploadEvery, () => _uploader.FlushAsync(ct), ct),
            Every(SettingsEvery, () => _uploader.PingAsync(ct), ct),
            Every(CheckEvery, Check, ct),
            Every(HeartbeatEvery, () => Record("heartbeat", ""), ct));
    }

    public override async Task StopAsync(CancellationToken ct)
    {
        await base.StopAsync(ct);
        _killer.Dispose();
        _sessions.StopAll();
    }

    private void StartKiller()
    {
        try { _killer.Start(); }
        catch (Exception e) { _log.LogError(e, "Process start watcher failed; relying on 30 s sweep"); }
    }

    private void Check()
    {
        _sessions.Reconcile(_supervised);
        _limits.Apply();
        _killer.Sweep();
        _sites.Retry(_supervised);
        _offline.Apply();
    }

    /// <summary>Queue all local accounts; while the server has never answered, derive supervision from them.</summary>
    private void ReportUsers()
    {
        var accounts = LocalAccounts.List().ToList();
        foreach (var a in accounts) Enqueue(ServiceRows.User(a));
        lock (_gate) // a concurrent first ingest response (Changed) is applied after us, never before
        {
            var stored = File.Exists(SupervisionStore.DefaultPath) ? _store.Load() : null;
            SetSupervised(SupervisionPolicy.Effective(stored, accounts));
        }
    }

    private void OnSupervisionChanged(IReadOnlySet<string> after) => SetSupervised(after);

    private void SetSupervised(IReadOnlySet<string> after)
    {
        lock (_gate)
        {
            var before = _supervised;
            _supervised = after;
            _sessions.Apply(before, after);
        }
    }

    /// <summary>Runs <paramref name="work"/> now and then every period; failures are logged, the loop goes on.</summary>
    private async Task Every(TimeSpan period, Func<Task> work, CancellationToken ct)
    {
        await Task.Yield();
        using var timer = new PeriodicTimer(period);
        do
        {
            try { await work(); }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { return; }
            catch (Exception e) { _log.LogWarning(e, "Periodic task failed"); }
        } while (await Tick(timer, ct));
    }

    private Task Every(TimeSpan period, Action work, CancellationToken ct) =>
        Every(period, () => { work(); return Task.CompletedTask; }, ct);

    private static async Task<bool> Tick(PeriodicTimer timer, CancellationToken ct)
    {
        try { return await timer.WaitForNextTickAsync(ct); }
        catch (OperationCanceledException) { return false; }
    }

    public void OnSessionChange(SessionChangeReason reason, int sessionId)
    {
        Guard(_offline.Apply); // a switch of user at the screen (also console connect/disconnect) changes who is offline
        var kind = reason switch
        {
            SessionChangeReason.SessionLogon => "logon",
            SessionChangeReason.SessionLogoff => "logoff",
            SessionChangeReason.SessionLock => "lock",
            SessionChangeReason.SessionUnlock => "unlock",
            _ => null,
        };
        if (kind is null) return;
        Guard(() =>
        {
            var user = _sessions.UserOf(sessionId);
            if (user is null || !_supervised.Contains(user.Sid)) return;
            RecordAndFlush(kind, user.WinUser);
            if (kind is "logon" or "unlock") _sessions.EnsureRunning(sessionId);
            if (kind is "logoff") _sessions.Stop(sessionId);
        });
    }

    public void OnPowerEvent(PowerBroadcastStatus status)
    {
        if (status == PowerBroadcastStatus.Suspend) Guard(() => RecordAndFlush("suspend", ""));
        else if (status == PowerBroadcastStatus.ResumeAutomatic) Guard(() => Record("resume", ""));
    }

    public void OnShutdown() => Guard(() => RecordAndFlush("shutdown", ""));

    /// <summary>SCM callbacks must never throw into the service host.</summary>
    private void Guard(Action action)
    {
        try { action(); }
        catch (Exception e) { _log.LogWarning(e, "Service event handling failed"); }
    }

    /// <summary>
    /// Records the event and uploads per <see cref="FlushPolicy"/>: before sleep/shutdown a bounded synchronous
    /// flush inside the SCM callback (otherwise the event only arrives after the next boot); on logoff/lock an
    /// immediate background flush instead of waiting for the 60 s tick.
    /// </summary>
    private void RecordAndFlush(string kind, string winUser)
    {
        Record(kind, winUser);
        switch (FlushPolicy.For(kind))
        {
            case FlushMode.Blocking: FlushBlocking(); break;
            case FlushMode.Immediate: _ = Task.Run(FlushNowAsync); break;
        }
    }

    private void FlushBlocking()
    {
        // Not disposed: on timeout the abandoned flush still observes this token; the timer fires and frees it.
        var cts = new CancellationTokenSource(BlockingFlushLimit);
        try
        {
            if (!Task.Run(() => _uploader.FlushAsync(cts.Token)).Wait(BlockingFlushLimit))
                _log.LogWarning("Pre-sleep/shutdown upload did not finish in {Limit}", BlockingFlushLimit);
        }
        catch (AggregateException e) { _log.LogWarning(e.InnerException, "Pre-sleep/shutdown upload failed"); }
    }

    private async Task FlushNowAsync()
    {
        try { await _uploader.FlushAsync(CancellationToken.None); }
        catch (Exception e) { _log.LogWarning(e, "Immediate upload failed"); }
    }

    private void Enqueue(QueueItem item) => _queue.Upsert(item.Type, item.Id, item.Json);

    private void Record(string kind, string winUser) =>
        Enqueue(ServiceRows.Event(kind, winUser, DateTimeOffset.UtcNow, Guid.NewGuid().ToString()));
}
