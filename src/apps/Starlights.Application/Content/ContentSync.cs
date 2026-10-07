using System.Diagnostics;
using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.RegularExpressions;
using Starlights.Modules.Characters.Data;
using Starlights.Modules.Characters.Services.Processing;
using Starlights.Modules.Elements.Integration;
using Starlights.Modules.Elements.Services.Content;
using Starlights.Platform.Data;

namespace Starlights.Application.Content;

/// <summary>The content links and the commits last brought in (kept in content-sources.json in the content folder).</summary>
public sealed record ContentSettings(string AuroraLink, string FiveEToolsLink, string? AuroraCommit = null, string? FiveEToolsCommit = null, DateTimeOffset? UpdatedAt = null);

/// <summary>What the content job is doing or last did.</summary>
public sealed record ContentJobStatus(bool Running, string? Step, IReadOnlyList<string> Log, DateTimeOffset? StartedAt, DateTimeOffset? FinishedAt, bool? Succeeded);

/// <summary>One content source as this server has it: the commit or release in use, when it last changed and was checked.</summary>
public sealed record ContentSourceStatus(string Name, string Link, string? Commit, string? Version, string? VersionDate, DateTimeOffset? ChangedAt, DateTimeOffset? CheckedAt);

/// <summary>What the server's own nightly job (the homelab's) is doing or last did, from the status file it writes.</summary>
public sealed record NightlyStatus(bool Running, DateTimeOffset? StartedAt, DateTimeOffset? FinishedAt, bool? Ok, IReadOnlyList<string> Changes, IReadOnlyList<string> Failures, DateTimeOffset? LastSuccessAt);

/// <summary>
/// The content as it is here: each source, whether an update is running, the last one that worked, and on a server
/// that updates with its own scripts, the command that does it (the page can't run it).
/// </summary>
public sealed record ContentStatus(IReadOnlyList<ContentSourceStatus> Sources, bool Running, DateTimeOffset? LastSuccessAt, NightlyStatus? Nightly, string? UpdateCommand);

/// <summary>What GitHub has for one source compared with what is here.</summary>
public sealed record ContentSourceCheck(
    string Name,
    string Link,
    bool? UpdateAvailable,
    string? Current,
    string? Latest,
    DateTimeOffset? LatestDate,
    int? CommitsBehind,
    IReadOnlyList<CommitSummary> Commits,
    int? FilesChanged,
    IReadOnlyList<string> Files,
    string? ReleaseNotes,
    string WhatDownloads,
    string? Problem);

/// <summary>An update check (asked for on the page, never automatic); Cached when it is a recent one shown again.</summary>
public sealed record ContentCheckResponse(DateTimeOffset CheckedAt, bool Cached, IReadOnlyList<ContentSourceCheck> Sources);

/// <summary>
/// Brings in the content from the two GitHub links an admin gives (Aurora Legacy's elements and the 5etools data),
/// when the install manages its own content (Content:SelfManaged, the self-hosting kit): downloads each repository at
/// its newest commit (skipped when nothing changed), sets up the base rules on an empty database, imports Aurora
/// Legacy, the 5etools deities and the built-in extras, builds the Compendium of Lore, and runs every character
/// through the rules again. One run at a time, in the background; the Content page shows its steps.
/// </summary>
public sealed partial class ContentSync
{
    public const string DefaultAurora = "https://github.com/AuroraLegacy/elements";
    public const string DefaultFiveETools = "https://github.com/5etools-mirror-3/5etools-src";
    private const long MaxDownload = 1_500_000_000;

    private static readonly HttpClient Http = CreateClient();
    private readonly IServiceScopeFactory _scopes;
    private readonly IConfiguration _config;
    private readonly ILogger<ContentSync> _logger;
    private readonly object _gate = new();
    private readonly List<string> _log = [];
    private bool _running;
    private string? _step;
    private DateTimeOffset? _started, _finished;
    private bool? _succeeded;
    private ContentCheckResponse? _lastCheck;
    private (string Path, DateTime Modified, FiveEToolsRelease? Release) _fiveETools = (string.Empty, default, null);

    public ContentSync(IServiceScopeFactory scopes, IConfiguration config, ILogger<ContentSync> logger)
    {
        _scopes = scopes;
        _config = config;
        _logger = logger;
    }

    [GeneratedRegex("^[0-9a-f]{40}$")]
    private static partial Regex CommitId();

    private static HttpClient CreateClient()
    {
        // no redirects: every address is built here from a checked link, and nothing may send the server elsewhere
        var client = new HttpClient(new SocketsHttpHandler { AllowAutoRedirect = false, AutomaticDecompression = DecompressionMethods.None }) { Timeout = TimeSpan.FromMinutes(20) };
        client.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("Starlights", "1.0"));
        return client;
    }

    /// <summary>Whether this install brings in its own content (the kit); otherwise the server's own scripts do.</summary>
    public bool SelfManaged => _config.GetValue("Content:SelfManaged", false);

    private string Folder => _config["Content:Folder"] ?? "/data/content";
    private string AuroraPath => _config["Aurora:ContentPath"] ?? Path.Combine(Folder, "aurora-elements");
    private string FiveEToolsSource => _config["Content:FiveEToolsSource"] ?? Path.Combine(Folder, "5etools");
    private string LorePath => _config["Content:LorePath"] ?? "/data/lore";
    private string LoreIngest => _config["Content:LoreIngest"] ?? "/app/lore-ingest/lore-ingest/ingest.ts";
    private string SettingsPath => Path.Combine(Folder, "content-sources.json");
    private string FiveEToolsData => _config["FiveETools:Path"] ?? Path.Combine(FiveEToolsSource, "data");

    public ContentSettings Settings()
    {
        try
        {
            if (File.Exists(SettingsPath) && JsonSerializer.Deserialize<ContentSettings>(File.ReadAllText(SettingsPath)) is { } saved)
            {
                return saved;
            }
        }
        catch (JsonException)
        {
        }
        return new ContentSettings(DefaultAurora, DefaultFiveETools);
    }

    public void SaveLinks(GitHubRepo aurora, GitHubRepo fiveETools)
    {
        var now = Settings();
        // a different repository means a fresh download, even at the same commit id
        Save(now with
        {
            AuroraLink = aurora.Link,
            FiveEToolsLink = fiveETools.Link,
            AuroraCommit = aurora.Link == now.AuroraLink ? now.AuroraCommit : null,
            FiveEToolsCommit = fiveETools.Link == now.FiveEToolsLink ? now.FiveEToolsCommit : null,
        });
    }

    private void Save(ContentSettings settings)
    {
        Directory.CreateDirectory(Folder);
        File.WriteAllText(SettingsPath, JsonSerializer.Serialize(settings, new JsonSerializerOptions { WriteIndented = true }));
    }

    public ContentJobStatus Status()
    {
        lock (_gate)
        {
            return new ContentJobStatus(_running, _step, [.. _log], _started, _finished, _succeeded);
        }
    }

    /// <summary>
    /// The content as it is here, read from disk without asking GitHub: Aurora Legacy's commit (from its checkout, or
    /// the one the content job last downloaded) and the 5etools release (its changelog), the last update that worked,
    /// and whether one runs now (the content job, or the nightly job's status file on a server with its own scripts).
    /// </summary>
    public ContentStatus LocalStatus()
    {
        var settings = Settings();
        var checkout = Directory.Exists(AuroraPath) ? ContentVersions.ReadCheckout(AuroraPath) : null;
        var aurora = new ContentSourceStatus("Aurora Legacy", settings.AuroraLink, checkout?.Commit ?? settings.AuroraCommit, null, null,
            checkout?.ChangedAt ?? (SelfManaged ? settings.UpdatedAt : null), checkout?.FetchedAt);
        var release = FiveEToolsRelease();
        var fiveETools = new ContentSourceStatus("5etools", settings.FiveEToolsLink, settings.FiveEToolsCommit, release?.Version, release?.Date,
            SelfManaged ? settings.UpdatedAt : null, null);
        var nightly = SelfManaged ? null : ReadNightly();
        var job = Status();
        return new ContentStatus(
            [aurora, fiveETools],
            SelfManaged ? job.Running : nightly?.Running ?? false,
            SelfManaged ? settings.UpdatedAt : nightly?.LastSuccessAt,
            nightly,
            SelfManaged ? null : _config["Content:UpdateCommand"]);
    }

    private FiveEToolsRelease? FiveEToolsRelease()
    {
        var path = Path.Combine(FiveEToolsData, "changelog.json");
        var modified = File.Exists(path) ? File.GetLastWriteTimeUtc(path) : default;
        lock (_gate)
        {
            if (_fiveETools.Path == path && _fiveETools.Modified == modified)
            {
                return _fiveETools.Release;
            }
        }
        var release = modified == default ? null : ContentVersions.ReadFiveEToolsRelease(FiveEToolsData);
        lock (_gate)
        {
            _fiveETools = (path, modified, release);
        }
        return release;
    }

    /// <summary>The status file the server's nightly job writes (Content:StatusFile), when there is one.</summary>
    private NightlyStatus? ReadNightly()
    {
        var path = _config["Content:StatusFile"];
        if (string.IsNullOrWhiteSpace(path) || !File.Exists(path))
        {
            return null;
        }
        try
        {
            return JsonSerializer.Deserialize<NightlyStatus>(File.ReadAllText(path), new JsonSerializerOptions(JsonSerializerDefaults.Web));
        }
        catch (Exception ex) when (ex is JsonException or IOException or UnauthorizedAccessException)
        {
            _logger.LogWarning(ex, "Could not read the nightly status file {Path}", path);
            return null;
        }
    }

    /// <summary>
    /// Asks GitHub what is newer than the content here: Aurora Legacy's commits and changed files since the commit in
    /// use (compare), the 5etools release against the one in the changelog. Only when the admin asks (the page's
    /// button), at most once a minute, and an answer is kept 10 minutes: GitHub allows 60 checks an hour without a
    /// sign-in, shared with the content job. Nothing is downloaded or changed.
    /// </summary>
    public async Task<ContentCheckResponse> CheckAsync(bool force, CancellationToken ct = default)
    {
        var last = _lastCheck;
        var age = last is null ? TimeSpan.MaxValue : DateTimeOffset.UtcNow - last.CheckedAt;
        if (last is not null && (age < TimeSpan.FromMinutes(1) || (!force && age < TimeSpan.FromMinutes(10))))
        {
            return last with { Cached = true };
        }
        var status = LocalStatus();
        var settings = Settings();
        var sources = new List<ContentSourceCheck>
        {
            await CheckAuroraAsync(settings, status.Sources[0], ct),
            await CheckFiveEToolsAsync(settings, status.Sources[1], ct),
        };
        var answer = new ContentCheckResponse(DateTimeOffset.UtcNow, false, sources);
        _lastCheck = answer;
        return answer;
    }

    private async Task<ContentSourceCheck> CheckAuroraAsync(ContentSettings settings, ContentSourceStatus here, CancellationToken ct)
    {
        var downloads = SelfManaged
            ? "Update downloads the whole repository at its newest commit, unpacks it next to the current one, then swaps it in and imports what changed."
            : "The server's nightly job pulls these commits (git pull) and imports what changed.";
        var fail = (string problem) => new ContentSourceCheck(here.Name, here.Link, null, here.Commit, null, null, null, [], null, [], null, downloads, problem);
        var repo = GitHubRepo.Parse(settings.AuroraLink);
        if (repo is null)
        {
            return fail("The link is not a GitHub repository link.");
        }
        try
        {
            var latest = await LatestCommitAsync(repo);
            if (here.Commit == latest)
            {
                return new ContentSourceCheck(here.Name, here.Link, false, here.Commit, latest, null, 0, [], 0, [], null, downloads, null);
            }
            if (here.Commit is null || !ContentVersions.CommitId().IsMatch(here.Commit))
            {
                return new ContentSourceCheck(here.Name, here.Link, true, null, latest, null, null, [], null, [], null, downloads, null);
            }
            var compare = await GetGitHubAsync(repo.CompareUri(here.Commit, latest), ct);
            if (compare is null)
            {
                return new ContentSourceCheck(here.Name, here.Link, true, here.Commit, latest, null, null, [], null, [], null, downloads,
                    "GitHub couldn't compare the two commits (the history may have been rewritten); updating brings in the newest.");
            }
            var summary = ContentVersions.ParseCompare(compare);
            return new ContentSourceCheck(here.Name, here.Link, summary.AheadBy > 0 || summary.Status != "identical", here.Commit, latest, summary.HeadDate,
                summary.AheadBy, summary.Commits, summary.FilesChanged, summary.Files, null, downloads, null);
        }
        catch (Exception ex) when (ex is InvalidOperationException or HttpRequestException or TaskCanceledException or JsonException)
        {
            return fail(ex.Message);
        }
    }

    private async Task<ContentSourceCheck> CheckFiveEToolsAsync(ContentSettings settings, ContentSourceStatus here, CancellationToken ct)
    {
        var downloads = SelfManaged
            ? "Update downloads only its data folder, package.json and two script files at the newest commit, then rebuilds the Compendium of Lore."
            : "The server's nightly job fetches the newest release, rebuilds the Compendium of Lore and imports the deities.";
        var fail = (string problem) => new ContentSourceCheck(here.Name, here.Link, null, here.Version, null, null, null, [], null, [], null, downloads, problem);
        var repo = GitHubRepo.Parse(settings.FiveEToolsLink);
        if (repo is null)
        {
            return fail("The link is not a GitHub repository link.");
        }
        try
        {
            var json = await GetGitHubAsync(repo.LatestReleaseUri, ct);
            if (json is not null && ContentVersions.ParseRelease(json) is { } release)
            {
                var newer = here.Version is null || ContentVersions.CompareVersions(release.Tag, here.Version) > 0;
                return new ContentSourceCheck(here.Name, here.Link, newer, here.Version, release.Tag.TrimStart('v'), release.PublishedAt, null, [], null, [],
                    newer ? release.Notes : null, downloads, null);
            }
            // a fork without releases: its newest commit against the one the content job downloaded
            var latest = await LatestCommitAsync(repo);
            bool? available = here.Commit is null ? (SelfManaged ? true : null) : latest != here.Commit;
            return new ContentSourceCheck(here.Name, here.Link, available, here.Commit ?? here.Version, latest[..7], null, null, [], null, [], null, downloads,
                available is null ? "This repository has no releases, so the version here can't be compared with it." : null);
        }
        catch (Exception ex) when (ex is InvalidOperationException or HttpRequestException or TaskCanceledException or JsonException)
        {
            return fail(ex.Message);
        }
    }

    /// <summary>A GitHub API answer as JSON, or null when GitHub has nothing there (404); refuses on its rate limit.</summary>
    private static async Task<string?> GetGitHubAsync(Uri uri, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, uri);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/vnd.github+json"));
        using var response = await Http.SendAsync(request, ct);
        if (response.StatusCode == HttpStatusCode.NotFound)
        {
            return null;
        }
        if (response.StatusCode is HttpStatusCode.Forbidden or HttpStatusCode.TooManyRequests)
        {
            throw new InvalidOperationException("GitHub's limit of 60 checks an hour was reached. Try again later.");
        }
        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException($"GitHub did not answer ({(int)response.StatusCode}). Try again later.");
        }
        return await response.Content.ReadAsStringAsync(ct);
    }

    /// <summary>Starts a run in the background; false when one is already running.</summary>
    public bool Start(bool force)
    {
        lock (_gate)
        {
            if (_running)
            {
                return false;
            }
            _running = true;
            _log.Clear();
            _started = DateTimeOffset.UtcNow;
            _finished = null;
            _succeeded = null;
        }
        _ = Task.Run(async () =>
        {
            var ok = false;
            try
            {
                await RunAsync(force);
                ok = true;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Content update failed");
                Write($"Failed: {ex.Message}");
            }
            lock (_gate)
            {
                _running = false;
                _step = null;
                _finished = DateTimeOffset.UtcNow;
                _succeeded = ok;
            }
        });
        return true;
    }

    private void Step(string step)
    {
        lock (_gate)
        {
            _step = step;
        }
        Write(step);
    }

    private void Write(string line)
    {
        lock (_gate)
        {
            _log.Add($"{DateTimeOffset.UtcNow:HH:mm:ss}  {line}");
            if (_log.Count > 300)
            {
                _log.RemoveAt(0);
            }
        }
        _logger.LogInformation("Content: {Line}", line);
    }

    private async Task RunAsync(bool force)
    {
        var settings = Settings();
        var aurora = GitHubRepo.Parse(settings.AuroraLink) ?? throw new InvalidOperationException("The Aurora Legacy link is not a GitHub repository link.");
        var fiveETools = GitHubRepo.Parse(settings.FiveEToolsLink) ?? throw new InvalidOperationException("The 5etools link is not a GitHub repository link.");

        Step($"Checking {aurora.Link}");
        var auroraCommit = await LatestCommitAsync(aurora);
        var auroraChanged = force || auroraCommit != settings.AuroraCommit || !Directory.Exists(AuroraPath);
        if (auroraChanged)
        {
            Step($"Downloading Aurora Legacy ({auroraCommit[..7]})");
            await DownloadAsync(aurora, auroraCommit, AuroraPath, _ => true, maxBytes: 2_000_000_000, maxFiles: 50_000);
        }
        else
        {
            Write("Aurora Legacy has not changed.");
        }

        Step($"Checking {fiveETools.Link}");
        var fiveECommit = await LatestCommitAsync(fiveETools);
        var fiveEChanged = force || fiveECommit != settings.FiveEToolsCommit || !Directory.Exists(Path.Combine(FiveEToolsSource, "data"));
        if (fiveEChanged)
        {
            Step($"Downloading the 5etools data ({fiveECommit[..7]})");
            // only what the import and the Compendium read: the data folder, the release number, and the book and
            // source name tables in js/parser.js and js/render.js
            await DownloadAsync(fiveETools, fiveECommit, FiveEToolsSource, p => p is "package.json" or "js/parser.js" or "js/render.js" || p.StartsWith("data/", StringComparison.Ordinal), maxBytes: 3_000_000_000, maxFiles: 50_000);
        }
        else
        {
            Write("The 5etools data has not changed.");
        }

        using (var scope = _scopes.CreateScope())
        {
            var queries = scope.ServiceProvider.GetRequiredService<IElementsModuleQueries>();
            if ((await queries.GetCharacterCreationElements()).Count == 0)
            {
                Step("Setting up the base rules (first run)");
                await scope.ServiceProvider.GetRequiredService<IElementsModuleInitializer>().InitializeAsync();
            }
        }

        var imported = 0;
        foreach (var (index, changed, what) in new[] { ("AuroraLegacy.index", auroraChanged, "Aurora Legacy"), ("5etools", fiveEChanged, "the 5etools deities"), ("starlights", auroraChanged || fiveEChanged, "the built-in extras") })
        {
            if (!changed)
            {
                continue;
            }
            Step($"Importing {what}");
            using var scope = _scopes.CreateScope();
            var result = await scope.ServiceProvider.GetRequiredService<IAuroraImporter>().ImportAsync(index, replace: false, update: true);
            imported += result.ElementsImported + result.ElementsReplaced;
            Write($"{result.ElementsImported:N0} new, {result.ElementsReplaced:N0} updated");
        }

        if (fiveEChanged || !File.Exists(Path.Combine(LorePath, "current.json")))
        {
            Step("Building the Compendium of Lore");
            await BuildLoreAsync(force: fiveEChanged);
        }

        if (imported > 0)
        {
            Step("Bringing new choices to every character");
            using var scope = _scopes.CreateScope();
            var characters = await scope.ServiceProvider.GetRequiredService<IPersistence>().GetRepository<ICharactersRepository>().GetCharactersAsync();
            var processor = scope.ServiceProvider.GetRequiredService<IRegistrationProcessor>();
            var count = 0;
            foreach (var character in characters.ToList())
            {
                if (!(await processor.ReproccessRegistrations(character.Id)).HasError)
                {
                    count++;
                }
            }
            Write($"{count} characters updated");
        }

        Save(Settings() with { AuroraCommit = auroraCommit, FiveEToolsCommit = fiveECommit, UpdatedAt = DateTimeOffset.UtcNow });
        _lastCheck = null;
        Step("Done");
    }

    private static async Task<string> LatestCommitAsync(GitHubRepo repo)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, repo.CommitUri);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/vnd.github.sha"));
        using var response = await Http.SendAsync(request);
        var body = (await response.Content.ReadAsStringAsync()).Trim();
        if (!response.IsSuccessStatusCode || !CommitId().IsMatch(body))
        {
            throw new InvalidOperationException(response.StatusCode switch
            {
                HttpStatusCode.NotFound => $"{repo.Link} was not found (a private repository, a typo, or a branch that doesn't exist).",
                HttpStatusCode.Forbidden or HttpStatusCode.TooManyRequests => "GitHub's limit of 60 checks an hour was reached. Try again later.",
                _ => $"GitHub did not answer for {repo.Link} ({(int)response.StatusCode}). Try again later.",
            });
        }
        return body;
    }

    /// <summary>Downloads a repository at a commit next to the target folder, unpacks it, then swaps it in.</summary>
    private async Task DownloadAsync(GitHubRepo repo, string commit, string target, Func<string, bool> include, long maxBytes, int maxFiles)
    {
        var parent = Path.GetDirectoryName(Path.GetFullPath(target))!;
        Directory.CreateDirectory(parent);
        var archive = Path.Combine(parent, $".{Path.GetFileName(target)}.tar.gz");
        var fresh = target + ".new";
        var old = target + ".old";
        try
        {
            using (var response = await Http.GetAsync(repo.ArchiveUri(commit), HttpCompletionOption.ResponseHeadersRead))
            {
                if (!response.IsSuccessStatusCode)
                {
                    throw new InvalidOperationException($"The download from GitHub failed ({(int)response.StatusCode}).");
                }
                await using var source = await response.Content.ReadAsStreamAsync();
                await using var file = File.Create(archive);
                var buffer = new byte[81920];
                long total = 0;
                int read;
                while ((read = await source.ReadAsync(buffer)) > 0)
                {
                    if ((total += read) > MaxDownload)
                    {
                        throw new InvalidDataException("The download is larger than allowed (1.5 GB).");
                    }
                    await file.WriteAsync(buffer.AsMemory(0, read));
                }
                Write($"Downloaded {total / 1_000_000.0:N1} MB");
            }
            if (Directory.Exists(fresh))
            {
                Directory.Delete(fresh, recursive: true);
            }
            await using (var file = File.OpenRead(archive))
            {
                var result = await GitHubArchive.ExtractAsync(file, fresh, include, maxBytes, maxFiles);
                Write($"Unpacked {result.Files:N0} files");
            }
            if (Directory.Exists(old))
            {
                Directory.Delete(old, recursive: true);
            }
            if (Directory.Exists(target))
            {
                Directory.Move(target, old);
            }
            Directory.Move(fresh, target);
            if (Directory.Exists(old))
            {
                Directory.Delete(old, recursive: true);
            }
        }
        finally
        {
            File.Delete(archive);
            if (Directory.Exists(fresh))
            {
                Directory.Delete(fresh, recursive: true);
            }
        }
    }

    /// <summary>Runs the Compendium's builder (Node) on the 5etools data; the web app serves what it writes.</summary>
    private async Task BuildLoreAsync(bool force)
    {
        Directory.CreateDirectory(LorePath);
        var start = new ProcessStartInfo(_config["Content:Node"] ?? "node")
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            WorkingDirectory = Path.GetDirectoryName(Path.GetDirectoryName(LoreIngest))!,
        };
        foreach (var argument in new[] { LoreIngest, "--src", FiveEToolsSource, "--out", LorePath })
        {
            start.ArgumentList.Add(argument);
        }
        if (force)
        {
            start.ArgumentList.Add("--force");
        }
        using var process = Process.Start(start) ?? throw new InvalidOperationException("The Compendium builder could not start.");
        var output = process.StandardOutput.ReadToEndAsync();
        var errors = process.StandardError.ReadToEndAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromMinutes(30));
        await process.WaitForExitAsync(timeout.Token);
        var lines = ((await output) + (await errors)).Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        foreach (var line in lines.TakeLast(4))
        {
            Write(line);
        }
        if (process.ExitCode != 0)
        {
            throw new InvalidOperationException($"The Compendium builder stopped with code {process.ExitCode}.");
        }
    }
}
