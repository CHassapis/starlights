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
            // only what the import and the Compendium read: the data folder and the release number
            await DownloadAsync(fiveETools, fiveECommit, FiveEToolsSource, p => p == "package.json" || p.StartsWith("data/", StringComparison.Ordinal), maxBytes: 3_000_000_000, maxFiles: 50_000);
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
            throw new InvalidOperationException(response.StatusCode == HttpStatusCode.NotFound
                ? $"{repo.Link} was not found (a private repository, a typo, or a branch that doesn't exist)."
                : $"GitHub did not answer for {repo.Link} ({(int)response.StatusCode}). Try again later.");
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
