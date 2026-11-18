using Core;

namespace Helper;

internal static class Program
{
    private static readonly TimeSpan Poll = TimeSpan.FromSeconds(5);

    private static int Main(string[] args)
    {
        using var pipe = new PipeClient();
        if (args.Contains("--native-host")) return NativeHost.Run(pipe);

        using var single = new Mutex(true, @"Local\ChildMonitorHelper", out var first);
        if (!first) return 0;
        TrackForever(pipe);
        return 0;
    }

    private static void TrackForever(PipeClient pipe)
    {
        var winUser = Environment.UserDomainName + "\\" + Environment.UserName;
        var tracker = new ForegroundTracker(winUser, Guid.NewGuid);
        while (true)
        {
            try
            {
                foreach (var row in tracker.Observe(Win32.Capture(), DateTimeOffset.UtcNow))
                    pipe.Send(PipeLine.App(row));
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                // Treat as a failed sample; keep tracking.
            }
            Thread.Sleep(Poll);
        }
    }
}
