using System.Text;

namespace Core;

/// <summary>Chrome native messaging framing: 4-byte little-endian length + UTF-8 JSON.</summary>
public static class NativeMessageReader
{
    public const int MaxBytes = 1024 * 1024;

    public static IEnumerable<string> Read(Stream input)
    {
        var header = new byte[4];
        while (ReadExactly(input, header, 4))
        {
            var len = BitConverter.ToUInt32(header, 0);
            if (len > MaxBytes)
            {
                if (!Skip(input, len)) yield break;
                continue;
            }
            var body = new byte[len];
            if (!ReadExactly(input, body, (int)len)) yield break;
            yield return Encoding.UTF8.GetString(body);
        }
    }

    private static bool ReadExactly(Stream s, byte[] buf, int count)
    {
        var got = 0;
        while (got < count)
        {
            var n = s.Read(buf, got, count - got);
            if (n <= 0) return false;
            got += n;
        }
        return true;
    }

    private static bool Skip(Stream s, uint count)
    {
        var buf = new byte[8192];
        long left = count;
        while (left > 0)
        {
            var n = s.Read(buf, 0, (int)Math.Min(buf.Length, left));
            if (n <= 0) return false;
            left -= n;
        }
        return true;
    }
}
