using System.IO.Pipes;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
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
            using var pipe = Open();
            using var w = new StreamWriter(pipe, new UTF8Encoding(false)) { NewLine = "\n" };
            foreach (var l in lines) w.WriteLine(l);
            w.Flush();
            return true;
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            return false;
        }
    }

    private const uint FileWriteData = 0x0002;
    private const uint FileReadAttributes = 0x0080;
    private const uint Synchronize = 0x00100000;
    private const uint OpenExisting = 3;
    private const uint SecuritySqosPresent = 0x00100000;
    private const uint SecurityIdentification = 0x00010000;

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern SafePipeHandle CreateFileW(string name, uint access, uint share, IntPtr security,
        uint disposition, uint flags, IntPtr template);

    /// <summary>
    /// Opens the pipe with explicit rights rather than PipeDirection.Out: GENERIC_WRITE includes FILE_APPEND_DATA,
    /// the same bit as FILE_CREATE_PIPE_INSTANCE, which the service does not grant to users. .NET 8 has no
    /// NamedPipeClientStream constructor taking PipeAccessRights, so CreateFile is called directly. SQOS
    /// Identification: the service may read our SID but not act as us.
    /// </summary>
    private static NamedPipeClientStream Open()
    {
        var handle = CreateFileW($@"\\.\pipe\{PipeName}", FileWriteData | FileReadAttributes | Synchronize, 0,
            IntPtr.Zero, OpenExisting, SecuritySqosPresent | SecurityIdentification, IntPtr.Zero);
        if (handle.IsInvalid)
        {
            var error = Marshal.GetLastPInvokeError();
            handle.Dispose();
            throw new IOException($"Pipe open failed: {error}");
        }
        return new NamedPipeClientStream(PipeDirection.Out, false, true, handle);
    }

    public void Dispose()
    {
        _cts.Cancel();
        _wake.Set();
        _thread.Join(500);
    }
}
