using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Principal;
using Core;
using Microsoft.Extensions.Logging;

namespace Service;

/// <summary>
/// Receives JSON lines from Helpers. The client's SID comes from the pipe (impersonation), never from the row:
/// rows from unsupervised clients are dropped and <c>win_user</c> is overwritten (see <see cref="PipeRowFilter"/>).
/// </summary>
internal sealed class PipeServer(Queue queue, Func<IReadOnlySet<string>> supervised, ILogger<PipeServer> log)
{
    public const string PipeName = "ChildMonitorPipe";
    private const int MaxInstances = 32;
    private const int MaxLine = 64 * 1024;
    private const int ChunkSize = 4096;

    private int _live;

    private sealed record Client(string Sid, string WinUser);

    public async Task RunAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            NamedPipeServerStream? pipe = null;
            try
            {
                pipe = Create();
                await pipe.WaitForConnectionAsync(ct);
                var connected = pipe;
                pipe = null;
                _ = Task.Run(() => HandleAsync(connected, ct), CancellationToken.None);
            }
            catch (OperationCanceledException) { break; }
            catch (Exception e)
            {
                log.LogWarning(e, "Pipe create/accept failed (another process may own {Pipe}); retrying", PipeName);
                try { await Task.Delay(TimeSpan.FromSeconds(5), ct); }
                catch (OperationCanceledException) { break; }
            }
            finally { if (pipe is not null) Release(pipe); }
        }
    }

    /// <summary>
    /// When none of our instances exist, insist on creating the first one (FILE_FLAG_FIRST_PIPE_INSTANCE) so we
    /// never join a pipe squatted by another process.
    /// </summary>
    private NamedPipeServerStream Create()
    {
        var options = PipeOptions.Asynchronous;
        if (Volatile.Read(ref _live) == 0) options |= PipeOptions.FirstPipeInstance;
        var pipe = NamedPipeServerStreamAcl.Create(PipeName, PipeDirection.In, MaxInstances,
            PipeTransmissionMode.Byte, options, 0, 0, Security());
        Interlocked.Increment(ref _live);
        return pipe;
    }

    private void Release(NamedPipeServerStream pipe)
    {
        pipe.Dispose();
        Interlocked.Decrement(ref _live);
    }

    private static PipeSecurity Security()
    {
        var sec = new PipeSecurity();
        sec.AddAccessRule(Rule(WellKnownSidType.LocalSystemSid, PipeAccessRights.FullControl));
        sec.AddAccessRule(Rule(WellKnownSidType.BuiltinAdministratorsSid, PipeAccessRights.FullControl));
        // Read/write only: never CreateNewInstance, so users cannot host a rogue instance of this pipe.
        sec.AddAccessRule(Rule(WellKnownSidType.AuthenticatedUserSid, PipeAccessRights.ReadWrite));
        sec.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.NetworkSid, null),
            PipeAccessRights.FullControl, AccessControlType.Deny));
        return sec;
    }

    private static PipeAccessRule Rule(WellKnownSidType sid, PipeAccessRights rights) =>
        new(new SecurityIdentifier(sid, null), rights, AccessControlType.Allow);

    private async Task HandleAsync(NamedPipeServerStream pipe, CancellationToken ct)
    {
        try
        {
            var buf = new byte[ChunkSize];
            var n = await pipe.ReadAsync(buf, ct); // impersonation needs a read first; this one is bounded
            if (n == 0) return;
            var client = Identify(pipe);
            if (client is null || !supervised().Contains(client.Sid)) return; // disconnect at once
            var splitter = new LineSplitter(MaxLine);
            var lines = new List<string>();
            for (; n > 0; n = await pipe.ReadAsync(buf, ct))
            {
                var ok = splitter.TryFeed(buf.AsSpan(0, n), lines);
                foreach (var line in lines) Accept(line, client);
                lines.Clear();
                if (!ok) return; // oversized line: drop the client
            }
        }
        catch (Exception e) when (e is IOException or OperationCanceledException or ObjectDisposedException) { }
        catch (Exception e) { log.LogWarning(e, "Pipe client failed"); }
        finally { Release(pipe); }
    }

    private void Accept(string line, Client client)
    {
        var item = PipeRowFilter.Rewrite(line, client.Sid, client.WinUser, supervised());
        if (item is not null) queue.Upsert(item.Type, item.Id, item.Json);
    }

    /// <summary>
    /// Impersonate, open the thread token as self (required at Identification level), revert, then read the SID
    /// and resolve the name outside impersonation — the documented pattern for identify-level clients.
    /// </summary>
    private Client? Identify(NamedPipeServerStream pipe)
    {
        try
        {
            var token = IntPtr.Zero;
            pipe.RunAsClient(() => token = Native.OpenThreadTokenAsSelf());
            var sid = Native.TokenUserSidAndClose(token);
            if (sid is null) return null;
            var name = new SecurityIdentifier(sid).Translate(typeof(NTAccount)).Value;
            return new Client(sid, name);
        }
        catch (SystemException e)
        {
            log.LogWarning(e, "Could not identify pipe client");
            return null;
        }
    }
}
