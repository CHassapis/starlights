using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Xml.Linq;
using FastEndpoints;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Starlights.Modules.Characters.Data.EntityFramework;
using Starlights.Modules.Elements.Data.EntityFramework;

namespace Starlights.Application.Content;

/// <summary>A module's database changes: how many of the ones this version knows are applied, the newest, and any not yet.</summary>
public sealed record MigrationState(string Module, int Applied, int Known, string? Latest, IReadOnlyList<string> Pending);

/// <summary>What is in the database and the homebrew folder, counted cheaply.</summary>
public sealed record ServerCounts(int Characters, int Players, int Campaigns, int CampaignEntries, int Elements, int HomebrewFiles, int HomebrewItems, int HomebrewMonsters);

/// <summary>
/// The admin's look at the server (the Content page): the Starlights version it runs (the git commit it was built
/// from, when the build passed it in), when it was built and started, the database and its changes per module, a
/// few counts, and the content (see <see cref="ContentSync.LocalStatus"/>).
/// </summary>
public sealed record ServerStatusResponse(
    string? Commit,
    DateTimeOffset BuiltAt,
    DateTimeOffset StartedAt,
    bool DatabaseReachable,
    string? DatabaseProblem,
    IReadOnlyList<MigrationState> Migrations,
    ServerCounts? Counts,
    ContentStatus Content);

/// <summary>Version, database and content status for the admin (everything under /api/admin needs the admin).</summary>
public sealed class ServerStatusEndpoint : EndpointWithoutRequest<ServerStatusResponse>
{
    private readonly IDbContextFactory<CharactersContext> _characters;
    private readonly IDbContextFactory<ElementsContext> _elements;
    private readonly ContentSync _sync;

    public ServerStatusEndpoint(IDbContextFactory<CharactersContext> characters, IDbContextFactory<ElementsContext> elements, ContentSync sync)
    {
        _characters = characters;
        _elements = elements;
        _sync = sync;
    }

    public override void Configure()
    {
        Get("admin/status");
        AllowAnonymous();
    }

    public override async Task HandleAsync(CancellationToken ct)
    {
        var migrations = new List<MigrationState>();
        ServerCounts? counts = null;
        string? problem = null;
        try
        {
            await using var characters = await _characters.CreateDbContextAsync(ct);
            await using var elements = await _elements.CreateDbContextAsync(ct);
            migrations.Add(await MigrationsAsync("Characters", characters.Database, ct));
            migrations.Add(await MigrationsAsync("Elements", elements.Database, ct));
            var (files, items, monsters) = Homebrew(Config["Aurora:HomebrewPath"] ?? "/data/homebrew");
            counts = new ServerCounts(
                await CountAsync(characters.Database, "characters.character", ct),
                await CountAsync(characters.Database, "characters.player", ct),
                await CountAsync(characters.Database, "characters.campaign", ct),
                await CountAsync(characters.Database, "characters.campaign_entry", ct),
                await CountAsync(elements.Database, "elements.element", ct),
                files,
                items,
                monsters);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            problem = ex.Message;
        }

        var commit = Config["STARLIGHTS_COMMIT"];
        await Send.OkAsync(new ServerStatusResponse(
            string.IsNullOrWhiteSpace(commit) || commit == "unknown" ? null : commit.Trim(),
            new DateTimeOffset(File.GetLastWriteTimeUtc(typeof(Program).Assembly.Location), TimeSpan.Zero),
            new DateTimeOffset(Process.GetCurrentProcess().StartTime.ToUniversalTime(), TimeSpan.Zero),
            problem is null,
            problem,
            migrations,
            counts,
            _sync.LocalStatus()), ct);
    }

    /// <summary>The module's migrations against the shared history table (both modules write to the same one).</summary>
    private static async Task<MigrationState> MigrationsAsync(string module, DatabaseFacade database, CancellationToken ct)
    {
        var known = database.GetMigrations().ToList();
        var applied = (await database.GetAppliedMigrationsAsync(ct)).ToHashSet(StringComparer.Ordinal);
        var done = known.Where(applied.Contains).ToList();
        return new MigrationState(module, done.Count, known.Count, done.LastOrDefault(), known.Where(m => !applied.Contains(m)).ToList());
    }

    // (only these fixed table names: nothing from the request goes into the query)
    private static Task<int> CountAsync(DatabaseFacade database, string table, CancellationToken ct) =>
        database.SqlQueryRaw<int>($"SELECT COUNT(*) AS [Value] FROM {table}").SingleAsync(ct);

    /// <summary>Homebrew element files, items made on the Homebrew page, and homebrew monsters.</summary>
    private static (int Files, int Items, int Monsters) Homebrew(string folder)
    {
        if (!Directory.Exists(folder))
        {
            return (0, 0, 0);
        }
        var files = Directory.EnumerateFiles(folder, "*.xml").Count();
        var items = 0;
        var monsters = 0;
        try
        {
            var itemsFile = Path.Combine(folder, "starlights-items.xml");
            if (File.Exists(itemsFile))
            {
                items = XDocument.Load(itemsFile).Root?.Elements("element").Count() ?? 0;
            }
            var monstersFile = Path.Combine(folder, "starlights-monsters.json");
            if (File.Exists(monstersFile))
            {
                monsters = (JsonNode.Parse(File.ReadAllText(monstersFile)) as JsonArray)?.Count ?? 0;
            }
        }
        catch (Exception ex) when (ex is System.Xml.XmlException or JsonException or IOException)
        {
        }
        return (files, items, monsters);
    }
}
