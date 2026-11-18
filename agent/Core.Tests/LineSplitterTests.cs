using System.Text;

namespace Core.Tests;

public sealed class LineSplitterTests
{
    private static byte[] B(string s) => Encoding.UTF8.GetBytes(s);

    [Fact]
    public void Normal_line_is_returned_without_newline()
    {
        var s = new LineSplitter(64);
        var lines = new List<string>();
        Assert.True(s.TryFeed(B("{\"a\":1}\n"), lines));
        Assert.Equal(new[] { "{\"a\":1}" }, lines);
    }

    [Fact]
    public void Two_lines_in_one_chunk_and_a_line_split_across_chunks()
    {
        var s = new LineSplitter(64);
        var lines = new List<string>();
        Assert.True(s.TryFeed(B("one\r\ntwo\nthr"), lines));
        Assert.Equal(new[] { "one", "two" }, lines);
        lines.Clear();
        Assert.True(s.TryFeed(B("ee\n"), lines));
        Assert.Equal(new[] { "three" }, lines);
    }

    [Fact]
    public void Multibyte_char_split_across_chunks_decodes()
    {
        var s = new LineSplitter(64);
        var lines = new List<string>();
        var bytes = B("שלום\n");
        Assert.True(s.TryFeed(bytes.AsSpan(0, 3), lines));
        Assert.True(s.TryFeed(bytes.AsSpan(3), lines));
        Assert.Equal(new[] { "שלום" }, lines);
    }

    [Fact]
    public void Line_over_the_limit_fails_even_without_newline()
    {
        var s = new LineSplitter(8);
        var lines = new List<string>();
        Assert.True(s.TryFeed(B("12345678\n"), lines));
        Assert.False(s.TryFeed(B("123456789"), lines));
        Assert.False(new LineSplitter(8).TryFeed(B("1234\n123456789\n"), new List<string>()));
    }
}
