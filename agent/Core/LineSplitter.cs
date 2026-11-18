using System.Text;

namespace Core;

/// <summary>
/// Splits a UTF-8 byte stream into '\n'-terminated lines with a hard per-line byte limit, so an untrusted
/// writer cannot make us buffer unbounded data. A trailing '\r' is trimmed.
/// </summary>
public sealed class LineSplitter(int maxLineBytes)
{
    private readonly List<byte> _pending = new();

    /// <summary>Appends complete lines to <paramref name="lines"/>; false once any line exceeds the limit.</summary>
    public bool TryFeed(ReadOnlySpan<byte> chunk, List<string> lines)
    {
        while (chunk.Length > 0)
        {
            var nl = chunk.IndexOf((byte)'\n');
            var part = nl < 0 ? chunk : chunk[..nl];
            if (_pending.Count + part.Length > maxLineBytes) return false;
            _pending.AddRange(part.ToArray());
            if (nl < 0) break;
            lines.Add(Decode());
            chunk = chunk[(nl + 1)..];
        }
        return true;
    }

    private string Decode()
    {
        var bytes = _pending.ToArray();
        _pending.Clear();
        var len = bytes.Length > 0 && bytes[^1] == (byte)'\r' ? bytes.Length - 1 : bytes.Length;
        return Encoding.UTF8.GetString(bytes, 0, len);
    }
}
