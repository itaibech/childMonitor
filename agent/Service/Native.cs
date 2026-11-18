using System.Runtime.InteropServices;
using System.Security.Principal;

namespace Service;

/// <summary>Thin P/Invoke layer over WTS/userenv/advapi32; no decision logic.</summary>
internal static class Native
{
    private static readonly IntPtr CurrentServer = IntPtr.Zero;
    private const int WtsUserName = 5;
    private const int WtsDomainName = 7;
    private const uint CreateUnicodeEnvironment = 0x00000400;
    private const uint CreateNoWindow = 0x08000000;

    [StructLayout(LayoutKind.Sequential)]
    private struct WtsSessionInfo
    {
        public int SessionId;
        public IntPtr WinStationName;
        public int State;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct StartupInfo
    {
        public int Cb;
        public string? Reserved, Desktop, Title;
        public int X, Y, XSize, YSize, XCountChars, YCountChars, FillAttribute, Flags;
        public short ShowWindow, Reserved2;
        public IntPtr Reserved2Ptr, StdInput, StdOutput, StdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessInformation
    {
        public IntPtr Process, Thread;
        public int ProcessId, ThreadId;
    }

    [DllImport("wtsapi32.dll", SetLastError = true)]
    private static extern bool WTSEnumerateSessionsW(IntPtr server, int reserved, int version,
        out IntPtr info, out int count);
    [DllImport("wtsapi32.dll", SetLastError = true)]
    private static extern bool WTSQuerySessionInformationW(IntPtr server, int sessionId, int infoClass,
        out IntPtr buffer, out int bytes);
    [DllImport("wtsapi32.dll")] private static extern void WTSFreeMemory(IntPtr memory);
    [DllImport("wtsapi32.dll", SetLastError = true)]
    private static extern bool WTSQueryUserToken(int sessionId, out IntPtr token);
    [DllImport("userenv.dll", SetLastError = true)]
    private static extern bool CreateEnvironmentBlock(out IntPtr env, IntPtr token, bool inherit);
    [DllImport("userenv.dll")] private static extern bool DestroyEnvironmentBlock(IntPtr env);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CreateProcessAsUserW(IntPtr token, string app, string cmdLine, IntPtr procAttr,
        IntPtr threadAttr, bool inherit, uint flags, IntPtr env, string cwd, ref StartupInfo si,
        out ProcessInformation pi);

    [DllImport("kernel32.dll")] private static extern IntPtr GetCurrentThread();
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool OpenThreadToken(IntPtr thread, uint access, bool openAsSelf, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool GetTokenInformation(IntPtr token, int infoClass, IntPtr info, int length,
        out int returned);

    private const uint TokenQuery = 0x0008;
    private const int TokenUserClass = 1;

    /// <summary>
    /// Called while impersonating a pipe client. OpenAsSelf=true is required when the client allows only
    /// SecurityIdentification (OpenThreadToken docs). Returns IntPtr.Zero on failure.
    /// </summary>
    public static IntPtr OpenThreadTokenAsSelf() =>
        OpenThreadToken(GetCurrentThread(), TokenQuery, true, out var token) ? token : IntPtr.Zero;

    /// <summary>SID string of a token's user (TOKEN_USER); always closes the token.</summary>
    public static string? TokenUserSidAndClose(IntPtr token)
    {
        if (token == IntPtr.Zero) return null;
        var buf = IntPtr.Zero;
        try
        {
            GetTokenInformation(token, TokenUserClass, IntPtr.Zero, 0, out var size);
            if (size <= 0) return null;
            buf = Marshal.AllocHGlobal(size);
            if (!GetTokenInformation(token, TokenUserClass, buf, size, out _)) return null;
            return new SecurityIdentifier(Marshal.ReadIntPtr(buf)).Value; // TOKEN_USER.User.Sid
        }
        finally
        {
            if (buf != IntPtr.Zero) Marshal.FreeHGlobal(buf);
            CloseHandle(token);
        }
    }

    /// <summary>Ids of all WTS sessions except session 0.</summary>
    public static List<int> SessionIds()
    {
        var ids = new List<int>();
        if (!WTSEnumerateSessionsW(CurrentServer, 0, 1, out var info, out var count)) return ids;
        try
        {
            var size = Marshal.SizeOf<WtsSessionInfo>();
            for (var i = 0; i < count; i++)
            {
                var s = Marshal.PtrToStructure<WtsSessionInfo>(info + i * size);
                if (s.SessionId != 0) ids.Add(s.SessionId);
            }
        }
        finally { WTSFreeMemory(info); }
        return ids;
    }

    /// <summary>Signed-in user of a session (SID + DOMAIN\user), or null when nobody is signed in.</summary>
    public static SessionUser? QueryUser(int sessionId)
    {
        var user = QueryString(sessionId, WtsUserName);
        if (string.IsNullOrEmpty(user)) return null;
        var domain = QueryString(sessionId, WtsDomainName) ?? "";
        try
        {
            var account = new NTAccount(domain, user);
            var sid = (SecurityIdentifier)account.Translate(typeof(SecurityIdentifier));
            return new SessionUser(sid.Value, domain.Length == 0 ? user : domain + "\\" + user);
        }
        catch (SystemException)
        {
            return null;
        }
    }

    private static string? QueryString(int sessionId, int infoClass)
    {
        if (!WTSQuerySessionInformationW(CurrentServer, sessionId, infoClass, out var buf, out _)) return null;
        try { return Marshal.PtrToStringUni(buf); }
        finally { WTSFreeMemory(buf); }
    }

    /// <summary>Starts <paramref name="exe"/> as the session's user on winsta0\default; null on failure.</summary>
    public static System.Diagnostics.Process? LaunchInSession(int sessionId, string exe)
    {
        if (!WTSQueryUserToken(sessionId, out var token)) return null;
        var env = IntPtr.Zero;
        try
        {
            if (!CreateEnvironmentBlock(out env, token, false)) env = IntPtr.Zero;
            var si = new StartupInfo { Cb = Marshal.SizeOf<StartupInfo>(), Desktop = @"winsta0\default" };
            var flags = CreateNoWindow | (env == IntPtr.Zero ? 0 : CreateUnicodeEnvironment);
            if (!CreateProcessAsUserW(token, exe, $"\"{exe}\"", IntPtr.Zero, IntPtr.Zero, false, flags, env,
                    Path.GetDirectoryName(exe)!, ref si, out var pi)) return null;
            try
            {
                var p = System.Diagnostics.Process.GetProcessById(pi.ProcessId);
                _ = p.Handle; // open our own handle while pi.Process still pins the PID
                return p;
            }
            catch (Exception e) when (e is ArgumentException or InvalidOperationException
                                          or System.ComponentModel.Win32Exception) { return null; }
            finally
            {
                CloseHandle(pi.Thread);
                CloseHandle(pi.Process);
            }
        }
        finally
        {
            if (env != IntPtr.Zero) DestroyEnvironmentBlock(env);
            CloseHandle(token);
        }
    }
}
