namespace Core;

/// <summary>Bounded in-memory buffer for pipe lines while the service is unreachable; drops oldest.</summary>
public sealed class SendBuffer
{
    public const int DefaultCapacity = 1000;
    private readonly int _capacity;
    private readonly List<string> _items = new();
    private readonly object _lock = new();

    public SendBuffer(int capacity = DefaultCapacity) => _capacity = capacity;

    public void Add(string line)
    {
        lock (_lock)
        {
            _items.Add(line);
            Trim();
        }
    }

    public List<string> Drain()
    {
        lock (_lock)
        {
            var copy = new List<string>(_items);
            _items.Clear();
            return copy;
        }
    }

    /// <summary>Put undelivered lines back in front of anything added since.</summary>
    public void Requeue(IEnumerable<string> lines)
    {
        lock (_lock)
        {
            _items.InsertRange(0, lines);
            Trim();
        }
    }

    private void Trim()
    {
        if (_items.Count > _capacity) _items.RemoveRange(0, _items.Count - _capacity);
    }
}
