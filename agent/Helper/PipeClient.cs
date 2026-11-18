using System.IO.Pipes;
using System.Text;
using Core;

namespace Helper;

/// <summary>Writes JSON lines to the service pipe; buffers (max 1000, drop oldest) and retries every 5 s.</summary>
internal sealed class PipeClient : IDisposable
{
    public const string PipeName = "ChildMonitorPipe";
    private static readonly TimeSpan RetryEvery = TimeSpan.FromSeconds(5);

    private readonly SendBuffer _buffer = new();
    private readonly AutoResetEvent _wake = new(false);
    private readonly CancellationTokenSource _cts = new();
    private readonly Thread _thread;
    private volatile bool _idle = true;

    public PipeClient()
    {
        _thread = new Thread(Loop) { IsBackground = true, Name = "pipe-client" };
        _thread.Start();
    }

    public void Send(string line)
    {
        _idle = false;
        _buffer.Add(line);
        _wake.Set();
    }

    /// <summary>Wait until everything buffered has been written, or the timeout passes.</summary>
    public void Flush(TimeSpan timeout)
    {
        var end = DateTime.UtcNow + timeout;
        while (!_idle && DateTime.UtcNow < end) Thread.Sleep(50);
    }

    private void Loop()
    {
        while (!_cts.IsCancellationRequested)
        {
            var lines = _buffer.Drain();
            if (lines.Count == 0)
            {
                _idle = true;
                _wake.WaitOne(1000);
                continue;
            }
            if (!TryWrite(lines))
            {
                _buffer.Requeue(lines);
                _cts.Token.WaitHandle.WaitOne(RetryEvery);
            }
        }
    }

    private static bool TryWrite(List<string> lines)
    {
        try
        {
            using var pipe = new NamedPipeClientStream(".", PipeName, PipeDirection.Out);
            pipe.Connect(1000);
            using var w = new StreamWriter(pipe, new UTF8Encoding(false)) { NewLine = "\n" };
            foreach (var l in lines) w.WriteLine(l);
            w.Flush();
            return true;
        }
        catch (Exception e) when (e is IOException or TimeoutException or UnauthorizedAccessException)
        {
            return false;
        }
    }

    public void Dispose()
    {
        _cts.Cancel();
        _wake.Set();
        _thread.Join(500);
    }
}
