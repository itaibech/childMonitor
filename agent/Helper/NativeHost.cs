using Core;

namespace Helper;

/// <summary>Chrome/Edge native messaging host: reads extension messages from stdin, forwards to the pipe.</summary>
internal static class NativeHost
{
    public static int Run(PipeClient pipe)
    {
        var winUser = Environment.UserDomainName + "\\" + Environment.UserName;
        using var stdin = Console.OpenStandardInput();
        foreach (var json in NativeMessageReader.Read(stdin))
        {
            var line = PipeLine.FromExtension(json, winUser);
            if (line is not null) pipe.Send(line);
        }
        pipe.Flush(TimeSpan.FromSeconds(10));
        return 0;
    }
}
