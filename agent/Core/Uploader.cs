using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Core;

public sealed class Uploader(Queue q, HttpClient http, Config cfg, SupervisionStore? supervision = null)
{
    public const int BatchSize = 500;
    private const string InvalidToken = "invalid token";

    private static readonly Dictionary<string, string> BatchKeys = new()
    {
        ["app"] = "app_sessions", ["web"] = "web_sessions", ["event"] = "events", ["user"] = "users",
    };

    private readonly SupervisionStore _supervision = supervision ?? new SupervisionStore(SupervisionStore.DefaultPath);

    private enum Outcome { Ok, Poison, Stop }

    public async Task<int> FlushAsync(CancellationToken ct)
    {
        var sent = 0;
        for (var first = true; ; first = false)
        {
            var rows = q.Oldest(BatchSize);
            if (rows.Count == 0 && !first) break;
            var outcome = await PostAsync(rows, ct);
            if (outcome == Outcome.Stop) break;
            if (rows.Count > 0) q.Delete(rows.Select(r => r.Seq));
            if (outcome == Outcome.Ok) sent += rows.Count;
            if (rows.Count < BatchSize) break;
        }
        return sent;
    }

    private async Task<Outcome> PostAsync(IReadOnlyList<QueuedRow> rows, CancellationToken ct)
    {
        try
        {
            using var req = BuildRequest(rows);
            using var res = await http.SendAsync(req, ct);
            if (res.IsSuccessStatusCode) return await HandleSuccess(res, ct);
            return await ClassifyFailure(res, ct);
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException && !ct.IsCancellationRequested)
        {
            return Outcome.Stop;
        }
    }

    private HttpRequestMessage BuildRequest(IReadOnlyList<QueuedRow> rows)
    {
        var batch = new JsonObject { ["agent_version"] = Config.AgentVersion };
        foreach (var g in rows.GroupBy(r => r.Type).Where(g => BatchKeys.ContainsKey(g.Key)))
            batch[BatchKeys[g.Key]] = new JsonArray(g.Select(r => JsonNode.Parse(r.Json)).ToArray());
        var body = new JsonObject { ["token"] = cfg.Token, ["batch"] = batch };
        var req = new HttpRequestMessage(HttpMethod.Post, $"{cfg.SupabaseUrl.TrimEnd('/')}/rest/v1/rpc/ingest")
        {
            Content = JsonContent.Create(body),
        };
        req.Headers.Add("apikey", cfg.ApiKey);
        req.Headers.Authorization = new("Bearer", cfg.ApiKey);
        return req;
    }

    private async Task<Outcome> HandleSuccess(HttpResponseMessage res, CancellationToken ct)
    {
        try
        {
            var doc = await res.Content.ReadFromJsonAsync<JsonElement>(ct);
            if (doc.TryGetProperty("supervised_sids", out var sids) && sids.ValueKind == JsonValueKind.Array)
                _supervision.Save(sids.EnumerateArray().Select(s => s.GetString()).OfType<string>());
        }
        catch (JsonException)
        {
            // Body is advisory; the rows were accepted.
        }
        return Outcome.Ok;
    }

    private static async Task<Outcome> ClassifyFailure(HttpResponseMessage res, CancellationToken ct)
    {
        var code = (int)res.StatusCode;
        if (code < 400 || code >= 500) return Outcome.Stop;
        if (res.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden
            or HttpStatusCode.RequestTimeout or HttpStatusCode.TooManyRequests) return Outcome.Stop;
        var text = await res.Content.ReadAsStringAsync(ct);
        return text.Contains(InvalidToken, StringComparison.OrdinalIgnoreCase) ? Outcome.Stop : Outcome.Poison;
    }
}
