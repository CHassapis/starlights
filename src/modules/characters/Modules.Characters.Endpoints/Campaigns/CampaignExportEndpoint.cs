using System.IO.Compression;
using System.Text;
using System.Text.Json;
using FastEndpoints;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Starlights.Modules.Characters.Data;
using Starlights.Modules.Characters.Endpoints.Characters.Portraits;
using Starlights.Modules.Characters.Services.Campaigns;
using Starlights.Modules.Characters.Services.Players;
using Starlights.Modules.Elements.Integration;
using Starlights.Platform.Data;

namespace Starlights.Modules.Characters.Endpoints.Campaigns;

/// <summary>
/// Export campaign (the DM's): one .zip with campaign.json (see <see cref="CampaignExport"/>), the campaign's
/// pictures and the party's portraits and story pictures. Only this campaign's DM (its DM password or the admin)
/// may export it; it holds nothing the DM can't read already, and never a password, token or private note.
/// </summary>
public sealed class ExportCampaignEndpoint : EndpointWithoutRequest
{
    private const string ReadMe = """
        A Starlights campaign export.

        campaign.json   the campaign, its entries (sessions, codex, quests, ledger, magic items, notes, maps,
                        encounters with their fights), the party's characters and who carries which magic item.
                        "notIncluded" lists what is left out on purpose (passwords, tokens, private notes).
        pictures/       the campaign's pictures and the party's portraits; "files" in campaign.json maps each
                        file to the address the campaign uses for it.

        Keep it private: it holds the DM's notes. It is a copy for reading and keeping; Starlights can't import it yet.
        """;

    private readonly IPersistence _persistence;
    private readonly PlayerAccess _access;
    private readonly IItemCatalog _catalog;

    public ExportCampaignEndpoint(IPersistence persistence, PlayerAccess access, IItemCatalog catalog)
    {
        _persistence = persistence;
        _access = access;
        _catalog = catalog;
    }

    public override void Configure()
    {
        Get("{campaignId:guid}/export");
        Group<CampaignsGroup>();
        AllowAnonymous();
    }

    public override async Task HandleAsync(CancellationToken ct)
    {
        var campaigns = _persistence.GetRepository<ICampaignsRepository>();
        var campaign = await campaigns.GetCampaignAsync(Route<Guid>("campaignId"));
        if (campaign is null)
        {
            await Send.NotFoundAsync(ct);
            return;
        }
        if (!CampaignAccess.IsDm(HttpContext, _access, campaign.Id))
        {
            await Send.ForbiddenAsync(ct);
            return;
        }

        var entries = await campaigns.GetEntriesAsync(campaign.Id);
        var characters = _persistence.GetRepository<ICharactersRepository>();
        var snapshots = _persistence.GetRepository<ICharacterSnapshotsRepository>();
        var locked = await _access.GetLockedPlayersAsync();
        var tokens = HttpContext.Request.Headers[PlayerAccess.TokenHeader].ToString();
        var portraitsFolder = PortraitFiles.Folder(Config);

        // the archive's pictures: path in the zip, file on disk, the address the campaign uses for it
        var files = new List<(string Path, string Source, string Url)>();
        void AddFolder(string folder, string zipFolder, string urlPrefix)
        {
            if (!Directory.Exists(folder))
            {
                return;
            }
            foreach (var file in Directory.EnumerateFiles(folder).Select(Path.GetFileName).OfType<string>().Where(n => PortraitFiles.FileName().IsMatch(n)).Order(StringComparer.Ordinal))
            {
                files.Add(($"{zipFolder}/{file}", Path.Combine(folder, file), urlPrefix + file));
            }
        }
        AddFolder(CampaignAccess.Folder(Config, campaign.Id), "pictures/campaign", CampaignAccess.UrlPrefix(campaign.Id));

        var party = new List<ExportedCharacter>();
        var equipment = new List<(Guid, string, Domain.Characters.CharacterInventory)>();
        foreach (var id in campaign.Party)
        {
            var character = await characters.GetCharacterAsync(id);
            if (character is null)
            {
                party.Add(new ExportedCharacter(id, "A character no longer here", null, Locked: false, Missing: true));
                continue;
            }
            equipment.Add((id, character.Name, character.Inventory));
            if (locked.Contains(character.PlayerName) && !_access.HasToken(tokens, character.PlayerName))
            {
                party.Add(new ExportedCharacter(id, character.Name, character.PlayerName, Locked: true, Missing: false));
                continue;
            }
            var (level, build, portrait) = CampaignAccess.Describe(character);
            using var rows = JsonDocument.Parse(await snapshots.CaptureAsync(id));
            party.Add(new ExportedCharacter(id, character.Name, character.PlayerName, Locked: false, Missing: false, level, build, portrait,
                JsonSerializer.SerializeToElement(character.Combat, CampaignExport.Json), rows.RootElement.Clone()));
            // a portrait the character uploaded (only names the server made: never a path from the database)
            if (portrait?.StartsWith(PortraitFiles.UrlPrefix, StringComparison.Ordinal) == true && portrait[PortraitFiles.UrlPrefix.Length..] is var name
                && PortraitFiles.FileName().IsMatch(name) && File.Exists(Path.Combine(portraitsFolder, name)) && files.All(f => f.Url != portrait))
            {
                files.Add(($"pictures/portraits/{name}", Path.Combine(portraitsFolder, name), portrait));
            }
            AddFolder(StoryImages.Folder(Config, id), $"pictures/story/{id:N}", StoryImages.UrlPrefix(id));
        }

        var catalog = await _catalog.GetAsync(ct);
        var items = CampaignExport.ItemReferences(entries)
            .Select(r => catalog.Find(r.Key) is { } item
                ? new ExportedItem(r.Key, item.Name, item.Source, item.AuroraId, r.Value)
                : new ExportedItem(r.Key, "(not in this server's content)", null, null, r.Value))
            .ToList();

        var document = new CampaignExportDocument(
            CampaignExport.Format,
            CampaignExport.FormatVersion,
            DateTimeOffset.UtcNow,
            string.IsNullOrWhiteSpace(Config["STARLIGHTS_COMMIT"]) ? null : Config["STARLIGHTS_COMMIT"],
            CampaignExport.Campaign(campaign),
            CampaignExport.Entries(entries),
            party,
            CampaignItemHolders.Find(entries, campaign.Name, equipment),
            items,
            files.Select(f => new ExportedFile(f.Path, f.Url)).ToList(),
            CampaignExport.NotIncluded);

        // built in a temporary file (deleted when it has been sent): pictures are stored as they are, the text packed
        var temp = Path.Combine(Path.GetTempPath(), $"starlights-export-{Guid.NewGuid():N}.zip");
        await using (var output = File.Create(temp))
        {
            using var zip = new ZipArchive(output, ZipArchiveMode.Create);
            await using (var json = zip.CreateEntry("campaign.json", CompressionLevel.Optimal).Open())
            {
                await JsonSerializer.SerializeAsync(json, document, CampaignExport.Json, ct);
            }
            await using (var readMe = zip.CreateEntry("README.txt", CompressionLevel.Optimal).Open())
            {
                await readMe.WriteAsync(Encoding.UTF8.GetBytes(ReadMe), ct);
            }
            foreach (var (path, source, _) in files)
            {
                await using var entry = zip.CreateEntry(path, CompressionLevel.NoCompression).Open();
                await using var picture = File.OpenRead(source);
                await picture.CopyToAsync(entry, ct);
            }
        }

        await using var stream = new FileStream(temp, FileMode.Open, FileAccess.Read, FileShare.Read | FileShare.Delete, 81920, FileOptions.DeleteOnClose | FileOptions.Asynchronous);
        var fileName = $"starlights-campaign-{CampaignExport.Slug(campaign.Name)}-{DateTime.UtcNow:yyyy-MM-dd}.zip";
        await Send.StreamAsync(stream, fileName, stream.Length, "application/zip", cancellation: ct);
    }
}
