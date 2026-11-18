using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using Core;

namespace Helper;

/// <summary>Thin P/Invoke layer; all decision logic lives in Core.</summary>
internal static class Win32
{
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int max);
    [DllImport("user32.dll")] private static extern bool GetLastInputInfo(ref LastInputInfo info);
    [DllImport("user32.dll")] private static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
    [DllImport("user32.dll")] private static extern bool CloseDesktop(IntPtr desktop);
    [DllImport("kernel32.dll")] private static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern bool QueryFullProcessImageName(IntPtr proc, uint flags, StringBuilder name, ref int size);

    private const uint ProcessQueryLimitedInformation = 0x1000;
    private const uint DesktopSwitchDesktop = 0x0100;

    [StructLayout(LayoutKind.Sequential)]
    private struct LastInputInfo
    {
        public uint Size;
        public uint Time;
    }

    public static Sample Capture()
    {
        var hwnd = GetForegroundWindow();
        var title = new StringBuilder(512);
        if (hwnd != IntPtr.Zero) GetWindowText(hwnd, title, title.Capacity);
        var exe = hwnd == IntPtr.Zero ? "" : ExePathOf(hwnd);
        var process = exe.Length == 0 ? "" : Path.GetFileName(exe);
        return new Sample(process, exe, title.ToString(), IdleTime(), IsLocked());
    }

    private static string ExePathOf(IntPtr hwnd)
    {
        GetWindowThreadProcessId(hwnd, out var pid);
        var h = OpenProcess(ProcessQueryLimitedInformation, false, pid);
        if (h == IntPtr.Zero) return "";
        try
        {
            var sb = new StringBuilder(1024);
            var size = sb.Capacity;
            return QueryFullProcessImageName(h, 0, sb, ref size) ? sb.ToString() : "";
        }
        finally { CloseHandle(h); }
    }

    private static TimeSpan IdleTime()
    {
        var info = new LastInputInfo { Size = (uint)Marshal.SizeOf<LastInputInfo>() };
        if (!GetLastInputInfo(ref info)) return TimeSpan.Zero;
        var ms = unchecked((uint)Environment.TickCount - info.Time);
        return TimeSpan.FromMilliseconds(ms);
    }

    // While the workstation is locked the input desktop is Winlogon, which a normal user cannot open.
    private static bool IsLocked()
    {
        var d = OpenInputDesktop(0, false, DesktopSwitchDesktop);
        if (d == IntPtr.Zero) return true;
        CloseDesktop(d);
        return false;
    }
}
