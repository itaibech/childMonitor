using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
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
                log.LogWarning(e, "Pipe accept failed");
                try { await Task.Delay(TimeSpan.FromSeconds(5), ct); }
                catch (OperationCanceledException) { break; }
            }
            finally { pipe?.Dispose(); }
        }
    }

    private static NamedPipeServerStream Create()
    {
        var sec = new PipeSecurity();
        sec.AddAccessRule(Rule(WellKnownSidType.LocalSystemSid, PipeAccessRights.FullControl));
        sec.AddAccessRule(Rule(WellKnownSidType.BuiltinAdministratorsSid, PipeAccessRights.FullControl));
        // Read/write only: never CreateNewInstance, so users cannot host a rogue instance of this pipe.
        sec.AddAccessRule(Rule(WellKnownSidType.AuthenticatedUserSid, PipeAccessRights.ReadWrite));
        sec.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.NetworkSid, null),
            PipeAccessRights.FullControl, AccessControlType.Deny));
        return NamedPipeServerStreamAcl.Create(PipeName, PipeDirection.In, MaxInstances, PipeTransmissionMode.Byte,
            PipeOptions.Asynchronous, 0, 0, sec);
    }

    private static PipeAccessRule Rule(WellKnownSidType sid, PipeAccessRights rights) =>
        new(new SecurityIdentifier(sid, null), rights, AccessControlType.Allow);

    private async Task HandleAsync(NamedPipeServerStream pipe, CancellationToken ct)
    {
        await using var _ = pipe;
        try
        {
            using var reader = new StreamReader(pipe, new UTF8Encoding(false));
            var line = await reader.ReadLineAsync(ct); // impersonation needs data read first
            if (line is null) return;
            var client = Identify(pipe);
            if (client is null) return;
            for (; line is not null; line = await reader.ReadLineAsync(ct)) Accept(line, client);
        }
        catch (Exception e) when (e is IOException or OperationCanceledException or ObjectDisposedException) { }
        catch (Exception e) { log.LogWarning(e, "Pipe client failed"); }
    }

    private void Accept(string line, Client client)
    {
        if (line.Length > MaxLine) return;
        var item = PipeRowFilter.Rewrite(line, client.Sid, client.WinUser, supervised());
        if (item is not null) queue.Upsert(item.Type, item.Id, item.Json);
    }

    private Client? Identify(NamedPipeServerStream pipe)
    {
        try
        {
            SecurityIdentifier? sid = null;
            pipe.RunAsClient(() =>
            {
                using var id = WindowsIdentity.GetCurrent(TokenAccessLevels.Query);
                sid = id.User;
            });
            if (sid is null) return null;
            // Resolve the name as ourselves; an Identification-level token cannot do LSA lookups.
            return new Client(sid.Value, ((NTAccount)sid.Translate(typeof(NTAccount))).Value);
        }
        catch (SystemException e)
        {
            log.LogWarning(e, "Could not identify pipe client");
            return null;
        }
    }
}
