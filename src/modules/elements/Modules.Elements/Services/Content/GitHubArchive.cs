using System.Formats.Tar;
using System.IO.Compression;
using System.Text.RegularExpressions;

namespace Starlights.Modules.Elements.Services.Content;

/// <summary>
/// A GitHub repository given as a link ("https://github.com/AuroraLegacy/elements", ".git" or "/tree/branch" allowed).
/// Only github.com links are accepted, and the server builds every address it fetches from the owner, name and
/// branch, so a pasted link can't point it anywhere else.
/// </summary>
public sealed partial record GitHubRepo(string Owner, string Name, string? Branch)
{
    [GeneratedRegex(@"^https://github\.com/(?<owner>[A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))/(?<name>[A-Za-z0-9._-]{1,100}?)(?:\.git)?(?:/tree/(?<branch>[A-Za-z0-9._/-]{1,200}))?/?$")]
    private static partial Regex LinkPattern();

    public static GitHubRepo? Parse(string? link)
    {
        var match = LinkPattern().Match((link ?? string.Empty).Trim());
        if (!match.Success)
        {
            return null;
        }
        var name = match.Groups["name"].Value;
        var branch = match.Groups["branch"].Success ? match.Groups["branch"].Value.TrimEnd('/') : null;
        if (name is "." or ".." || (branch is not null && (branch.Contains("..", StringComparison.Ordinal) || branch.StartsWith('/'))))
        {
            return null;
        }
        return new GitHubRepo(match.Groups["owner"].Value, name, string.IsNullOrEmpty(branch) ? null : branch);
    }

    public string Link => $"https://github.com/{Owner}/{Name}" + (Branch is null ? string.Empty : $"/tree/{Branch}");

    /// <summary>The newest commit of the branch (GitHub answers with just its id for this media type).</summary>
    public Uri CommitUri => new($"https://api.github.com/repos/{Owner}/{Name}/commits/{Uri.EscapeDataString(Branch ?? "HEAD")}");

    /// <summary>The repository's files at one commit, as a .tar.gz.</summary>
    public Uri ArchiveUri(string commit) => new($"https://codeload.github.com/{Owner}/{Name}/tar.gz/{commit}");

    /// <summary>What changed between two commits (commits and files), for the Content page; both must be commit ids.</summary>
    public Uri CompareUri(string from, string to) =>
        ContentVersions.CommitId().IsMatch(from) && ContentVersions.CommitId().IsMatch(to)
            ? new($"https://api.github.com/repos/{Owner}/{Name}/compare/{from}...{to}")
            : throw new ArgumentException("Only commit ids can be compared.");

    /// <summary>The repository's newest release (5etools publishes one per version).</summary>
    public Uri LatestReleaseUri => new($"https://api.github.com/repos/{Owner}/{Name}/releases/latest");
}

/// <summary>What an archive unpacked: files, bytes, and entries left out (links, paths outside the folder).</summary>
public sealed record ExtractResult(int Files, long Bytes, int Skipped);

/// <summary>
/// Unpacks a GitHub .tar.gz into a folder: the archive's top folder ("elements-1a2b3c/") is dropped, only regular
/// files and folders are written (no links), no path may leave the folder, and the total size and file count are
/// capped.
/// </summary>
public static class GitHubArchive
{
    public static async Task<ExtractResult> ExtractAsync(Stream tarGz, string target, Func<string, bool> include, long maxBytes, int maxFiles, CancellationToken ct = default)
    {
        var root = Path.GetFullPath(target);
        Directory.CreateDirectory(root);
        await using var gzip = new GZipStream(tarGz, CompressionMode.Decompress);
        using var reader = new TarReader(gzip);
        int files = 0, skipped = 0;
        long bytes = 0;
        while (await reader.GetNextEntryAsync(copyData: false, ct) is { } entry)
        {
            if (entry.EntryType is TarEntryType.GlobalExtendedAttributes or TarEntryType.ExtendedAttributes)
            {
                continue;
            }
            var name = entry.Name.Replace('\\', '/');
            var slash = name.IndexOf('/');
            var relative = slash < 0 ? string.Empty : name[(slash + 1)..].TrimEnd('/');
            if (relative.Length == 0)
            {
                continue;
            }
            var segments = relative.Split('/');
            var directory = entry.EntryType == TarEntryType.Directory;
            var regular = entry.EntryType is TarEntryType.RegularFile or TarEntryType.V7RegularFile or TarEntryType.ContiguousFile;
            if ((!directory && !regular) || relative.StartsWith('/') || segments.Any(s => s is ".." or "." or "") || relative.Contains(':'))
            {
                skipped++;
                continue;
            }
            if (!include(relative))
            {
                continue;
            }
            var path = Path.GetFullPath(Path.Combine(root, relative));
            if (!path.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.Ordinal))
            {
                skipped++;
                continue;
            }
            if (directory)
            {
                Directory.CreateDirectory(path);
                continue;
            }
            if (++files > maxFiles || (bytes += entry.Length) > maxBytes)
            {
                throw new InvalidDataException($"The archive is larger than allowed ({maxFiles:N0} files, {maxBytes / 1_000_000:N0} MB).");
            }
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            if (entry.DataStream is { } data)
            {
                await using var file = File.Create(path);
                await data.CopyToAsync(file, ct);
            }
            else
            {
                await File.WriteAllBytesAsync(path, [], ct);
            }
        }
        return new ExtractResult(files, bytes, skipped);
    }
}
