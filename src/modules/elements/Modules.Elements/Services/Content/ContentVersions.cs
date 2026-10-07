using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Starlights.Modules.Elements.Services.Content;

/// <summary>A git checkout's state: its commit, when that last changed (the reflog) and when it was last fetched.</summary>
public sealed record GitCheckoutState(string? Commit, string? Branch, DateTimeOffset? ChangedAt, DateTimeOffset? FetchedAt);

/// <summary>A 5etools data folder's release, from the newest entry of its changelog.json ("2.36.1", "2026-09-23").</summary>
public sealed record FiveEToolsRelease(string Version, string? Date);

/// <summary>A commit as the Content page lists it: short id, first line of the message, when.</summary>
public sealed record CommitSummary(string Id, string Message, DateTimeOffset? Date);

/// <summary>What GitHub's compare says between the commit here and the newest one.</summary>
public sealed record CompareSummary(string Status, int AheadBy, IReadOnlyList<CommitSummary> Commits, int FilesChanged, IReadOnlyList<string> Files, DateTimeOffset? BaseDate, DateTimeOffset? HeadDate);

/// <summary>A repository's newest release (5etools publishes one per version).</summary>
public sealed record ReleaseSummary(string Tag, string? Name, DateTimeOffset? PublishedAt, string Notes);

/// <summary>
/// Reading which content is here and what GitHub has, for the Content page: a checkout's commit straight from its
/// .git folder (no git program: HEAD, loose refs, packed-refs and the reflog are plain text), the 5etools release
/// from its changelog, and GitHub's compare and release answers. Nothing here downloads or changes anything.
/// </summary>
public static partial class ContentVersions
{
    [GeneratedRegex("^[0-9a-f]{40}$")]
    public static partial Regex CommitId();

    /// <summary>The checkout in a folder, or null when it is not one (a downloaded archive has no .git).</summary>
    public static GitCheckoutState? ReadCheckout(string folder)
    {
        var git = Path.Combine(folder, ".git");
        if (File.Exists(git))
        {
            // a worktree: ".git" names the real folder
            var line = File.ReadAllText(git).Trim();
            if (!line.StartsWith("gitdir:", StringComparison.Ordinal))
            {
                return null;
            }
            git = Path.GetFullPath(Path.Combine(folder, line["gitdir:".Length..].Trim()));
        }
        var head = Path.Combine(git, "HEAD");
        if (!File.Exists(head))
        {
            return null;
        }
        var text = File.ReadAllText(head).Trim();
        string? branch = null;
        var commit = text;
        if (text.StartsWith("ref:", StringComparison.Ordinal))
        {
            var reference = text[4..].Trim();
            branch = reference.StartsWith("refs/heads/", StringComparison.Ordinal) ? reference["refs/heads/".Length..] : reference;
            commit = ResolveRef(git, reference) ?? string.Empty;
        }
        var fetchHead = Path.Combine(git, "FETCH_HEAD");
        return new GitCheckoutState(
            CommitId().IsMatch(commit) ? commit : null,
            branch,
            LastReflogTime(Path.Combine(git, "logs", "HEAD")),
            File.Exists(fetchHead) ? new DateTimeOffset(File.GetLastWriteTimeUtc(fetchHead), TimeSpan.Zero) : null);
    }

    private static string? ResolveRef(string git, string reference)
    {
        if (reference.Contains("..", StringComparison.Ordinal))
        {
            return null;
        }
        var loose = Path.Combine(git, reference);
        if (File.Exists(loose))
        {
            return File.ReadAllText(loose).Trim();
        }
        var packed = Path.Combine(git, "packed-refs");
        if (!File.Exists(packed))
        {
            return null;
        }
        foreach (var line in File.ReadLines(packed))
        {
            var parts = line.Split(' ', 2);
            if (parts.Length == 2 && parts[1].Trim() == reference && CommitId().IsMatch(parts[0]))
            {
                return parts[0];
            }
        }
        return null;
    }

    /// <summary>When HEAD last moved: the time in the reflog's last line ("old new Name &lt;mail&gt; 1790752184 +0300\tpull").</summary>
    public static DateTimeOffset? LastReflogTime(string reflog)
    {
        if (!File.Exists(reflog))
        {
            return null;
        }
        var last = File.ReadLines(reflog).LastOrDefault(l => l.Length > 0);
        if (last is null)
        {
            return null;
        }
        var who = last.Split('\t', 2)[0];
        var close = who.LastIndexOf('>');
        var parts = close < 0 ? [] : who[(close + 1)..].Trim().Split(' ');
        return parts.Length >= 1 && long.TryParse(parts[0], NumberStyles.None, CultureInfo.InvariantCulture, out var seconds)
            ? DateTimeOffset.FromUnixTimeSeconds(seconds)
            : null;
    }

    /// <summary>The newest release in a 5etools data folder's changelog.json, or null without one.</summary>
    public static FiveEToolsRelease? ReadFiveEToolsRelease(string dataFolder)
    {
        var path = Path.Combine(dataFolder, "changelog.json");
        if (!File.Exists(path))
        {
            return null;
        }
        try
        {
            using var stream = File.OpenRead(path);
            using var json = JsonDocument.Parse(stream);
            if (json.RootElement.ValueKind != JsonValueKind.Array)
            {
                return null;
            }
            FiveEToolsRelease? newest = null;
            foreach (var entry in json.RootElement.EnumerateArray())
            {
                if (entry.ValueKind == JsonValueKind.Object && entry.TryGetProperty("ver", out var ver) && ver.ValueKind == JsonValueKind.String)
                {
                    var date = entry.TryGetProperty("date", out var d) && d.ValueKind == JsonValueKind.String ? d.GetString() : null;
                    var release = new FiveEToolsRelease(ver.GetString()!, date);
                    if (newest is null || CompareVersions(release.Version, newest.Version) > 0)
                    {
                        newest = release;
                    }
                }
            }
            return newest;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <summary>"v2.37.0" against "2.36.1": above zero when the first is newer (numbers part by part; text as a last resort).</summary>
    public static int CompareVersions(string a, string b)
    {
        static int[]? Parts(string v)
        {
            var numbers = new List<int>();
            foreach (var p in v.Trim().TrimStart('v', 'V').Split('.', '-').Take(3))
            {
                if (!int.TryParse(p, NumberStyles.None, CultureInfo.InvariantCulture, out var n))
                {
                    break;
                }
                numbers.Add(n);
            }
            return numbers.Count == 0 ? null : [.. numbers];
        }
        var (x, y) = (Parts(a), Parts(b));
        if (x is null || y is null)
        {
            return string.CompareOrdinal(a.Trim().TrimStart('v', 'V'), b.Trim().TrimStart('v', 'V'));
        }
        for (var i = 0; i < Math.Max(x.Length, y.Length); i++)
        {
            var c = (i < x.Length ? x[i] : 0).CompareTo(i < y.Length ? y[i] : 0);
            if (c != 0)
            {
                return c;
            }
        }
        return 0;
    }

    /// <summary>GitHub's compare answer (repos/{owner}/{name}/compare/{base}...{head}), the newest commits first.</summary>
    public static CompareSummary ParseCompare(string json, int maxCommits = 15, int maxFiles = 40)
    {
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;
        var commits = new List<CommitSummary>();
        if (root.TryGetProperty("commits", out var list) && list.ValueKind == JsonValueKind.Array)
        {
            commits.AddRange(list.EnumerateArray().Select(Commit));
            commits.Reverse();
        }
        var files = root.TryGetProperty("files", out var f) && f.ValueKind == JsonValueKind.Array
            ? f.EnumerateArray().Select(x => x.TryGetProperty("filename", out var n) ? n.GetString() ?? "" : "").Where(n => n.Length > 0).ToList()
            : [];
        var baseDate = root.TryGetProperty("base_commit", out var b) && b.ValueKind == JsonValueKind.Object ? Commit(b).Date : null;
        return new CompareSummary(
            root.TryGetProperty("status", out var s) && s.ValueKind == JsonValueKind.String ? s.GetString()! : "unknown",
            root.TryGetProperty("ahead_by", out var a) && a.ValueKind == JsonValueKind.Number ? a.GetInt32() : 0,
            commits.Take(maxCommits).ToList(),
            files.Count,
            files.Take(maxFiles).ToList(),
            baseDate,
            commits.FirstOrDefault()?.Date ?? baseDate);
    }

    /// <summary>GitHub's latest-release answer (repos/{owner}/{name}/releases/latest).</summary>
    public static ReleaseSummary? ParseRelease(string json, int maxNotes = 2000)
    {
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;
        if (!root.TryGetProperty("tag_name", out var tag) || tag.ValueKind != JsonValueKind.String)
        {
            return null;
        }
        var notes = root.TryGetProperty("body", out var body) && body.ValueKind == JsonValueKind.String ? body.GetString()!.Trim() : string.Empty;
        return new ReleaseSummary(
            tag.GetString()!,
            root.TryGetProperty("name", out var name) && name.ValueKind == JsonValueKind.String ? name.GetString() : null,
            root.TryGetProperty("published_at", out var at) && at.ValueKind == JsonValueKind.String && DateTimeOffset.TryParse(at.GetString(), CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var when) ? when : null,
            notes.Length > maxNotes ? notes[..maxNotes] + "…" : notes);
    }

    private static CommitSummary Commit(JsonElement c)
    {
        var sha = c.TryGetProperty("sha", out var s) && s.ValueKind == JsonValueKind.String ? s.GetString()! : string.Empty;
        var inner = c.TryGetProperty("commit", out var i) && i.ValueKind == JsonValueKind.Object ? i : default;
        var message = inner.ValueKind == JsonValueKind.Object && inner.TryGetProperty("message", out var m) && m.ValueKind == JsonValueKind.String ? m.GetString()! : string.Empty;
        DateTimeOffset? date = null;
        if (inner.ValueKind == JsonValueKind.Object && inner.TryGetProperty("committer", out var who) && who.ValueKind == JsonValueKind.Object
            && who.TryGetProperty("date", out var d) && d.ValueKind == JsonValueKind.String
            && DateTimeOffset.TryParse(d.GetString(), CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var parsed))
        {
            date = parsed;
        }
        var first = message.Split('\n', 2)[0].Trim();
        return new CommitSummary(sha.Length >= 7 ? sha[..7] : sha, first.Length > 140 ? first[..137] + "…" : first, date);
    }
}
