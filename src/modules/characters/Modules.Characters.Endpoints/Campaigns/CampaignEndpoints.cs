using System.Text;
using System.Text.Json;
using FastEndpoints;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Starlights.Modules.Characters.Data;
using Starlights.Modules.Characters.Domain.Appearances;
using Starlights.Modules.Characters.Domain.Campaigns;
using Starlights.Modules.Characters.Domain.Classes;
using Starlights.Modules.Characters.Domain.Progression;
using Starlights.Modules.Characters.Endpoints.Characters.Portraits;
using Starlights.Modules.Characters.Services.Campaigns;
using Starlights.Modules.Characters.Services.Players;
using Starlights.Platform.Data;

namespace Starlights.Modules.Characters.Endpoints.Campaigns;

public class CampaignsGroup : Group
{
    public CampaignsGroup()
    {
        Configure("campaigns", ep =>
        {
            ep.Description(d => d.WithTags("Campaigns"));
            ep.Options(o => o.RequireCors());
        });
    }
}

public sealed record CampaignSummaryModel(Guid Id, string Name, string Description, string? CoverUrl, int PartySize, DateTimeOffset UpdatedAt);

public sealed record CampaignsResponse(List<CampaignSummaryModel> Campaigns, bool Dm);

/// <summary>
/// A party member as the campaign shows them: like the characters list, a character whose player locked it shows
/// only its name and player unless the reader holds the player's token; a character deleted since is "missing".
/// </summary>
public sealed record PartyMemberModel(Guid CharacterId, string Name, string? PlayerName, int? Level, string? Build, string? PortraitUrl, bool Locked, bool Missing);

public sealed record CampaignModel(Guid Id, string Name, string Description, string? CoverUrl, IReadOnlyList<Guid> Party, DateTimeOffset UpdatedAt);

public sealed record CampaignResponse(CampaignModel Campaign, List<PartyMemberModel> Party, List<CampaignEntryModel> Entries, bool Dm);

public sealed record SaveCampaignRequest(string? Name, string? Description, string? CoverUrl, List<Guid>? Party);

public sealed record SaveEntryRequest(string? Kind, string? Title, int? Number, string? OccurredOn, bool Visible, string? Body, string? DmNotes, string? ImageUrl, JsonElement? Data, int Sort);

/// <summary>Who is the DM: whoever holds the admin token (the master password), checked on every request.</summary>
internal static class CampaignAccess
{
    public static bool IsDm(HttpContext context, PlayerAccess access) =>
        access.HasAdminToken(context.Request.Headers[PlayerAccess.TokenHeader]);

    public static string Folder(IConfiguration config, Guid campaignId) =>
        Path.Combine(PortraitFiles.Folder(config), "campaigns", campaignId.ToString("N"));

    public static string UrlPrefix(Guid campaignId) => $"/api/campaigns/{campaignId:N}/images/";

    /// <summary>Deletes an uploaded campaign picture that is no longer used.</summary>
    public static void DeleteImage(IConfiguration config, Guid campaignId, string? url)
    {
        var prefix = UrlPrefix(campaignId);
        if (url?.StartsWith(prefix, StringComparison.Ordinal) == true && PortraitFiles.FileName().IsMatch(url[prefix.Length..]))
        {
            File.Delete(Path.Combine(Folder(config, campaignId), url[prefix.Length..]));
        }
    }

    public static CampaignModel Model(Campaign c) => new(c.Id, c.Name, c.Description, c.CoverUrl, c.Party, c.UpdatedAt);
}

/// <summary>The campaigns; everyone can see that they exist, their names and descriptions.</summary>
public sealed class GetCampaignsEndpoint : EndpointWithoutRequest<CampaignsResponse>
{
    private readonly IPersistence _persistence;
    private readonly PlayerAccess _access;

    public GetCampaignsEndpoint(IPersistence persistence, PlayerAccess access)
    {
        _persistence = persistence;
        _access = access;
    }

    public override void Configure()
    {
        Get("");
        Group<CampaignsGroup>();
        AllowAnonymous();
    }

    public override async Task HandleAsync(CancellationToken ct)
    {
        var campaigns = await _persistence.GetRepository<ICampaignsRepository>().GetCampaignsAsync();
        await Send.OkAsync(new CampaignsResponse(
            campaigns.Select(c => new CampaignSummaryModel(c.Id, c.Name, c.Description, c.CoverUrl, c.Party.Count, c.UpdatedAt)).ToList(),
            CampaignAccess.IsDm(HttpContext, _access)), ct);
    }
}

/// <summary>
/// A campaign with its party and entries: everything for the DM, for players only what the DM revealed (see
/// <see cref="CampaignView"/>).
/// </summary>
public sealed class GetCampaignEndpoint : EndpointWithoutRequest<CampaignResponse>
{
    private readonly IPersistence _persistence;
    private readonly PlayerAccess _access;

    public GetCampaignEndpoint(IPersistence persistence, PlayerAccess access)
    {
        _persistence = persistence;
        _access = access;
    }

    public override void Configure()
    {
        Get("{campaignId:guid}");
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

        var dm = CampaignAccess.IsDm(HttpContext, _access);
        var entries = await campaigns.GetEntriesAsync(campaign.Id);

        var characters = _persistence.GetRepository<ICharactersRepository>();
        var locked = await _access.GetLockedPlayersAsync();
        var tokens = HttpContext.Request.Headers[PlayerAccess.TokenHeader].ToString();
        var party = new List<PartyMemberModel>();
        foreach (var id in campaign.Party)
        {
            var character = await characters.GetCharacterAsync(id);
            if (character is null)
            {
                party.Add(new PartyMemberModel(id, "A character no longer here", null, null, null, null, false, true));
                continue;
            }
            if (locked.Contains(character.PlayerName) && !_access.HasToken(tokens, character.PlayerName))
            {
                party.Add(new PartyMemberModel(id, character.Name, character.PlayerName, null, null, null, true, false));
                continue;
            }
            var classes = character.GetRequiredComponent<ClassComponent>();
            var build = new StringBuilder();
            foreach (var c in classes.Classes)
            {
                build.Append(build.Length > 0 ? " / " : string.Empty).Append(c.Name);
                if (classes.IsMulticlass)
                {
                    build.Append($" {c.Level}");
                }
            }
            party.Add(new PartyMemberModel(id, character.Name, character.PlayerName, character.GetRequiredComponent<ProgressionComponent>().CharacterLevel,
                build.ToString(), character.GetRequiredComponent<AppearanceComponent>().PortraitUrl, false, false));
        }

        await Send.OkAsync(new CampaignResponse(CampaignAccess.Model(campaign), party, CampaignView.Entries(entries, dm), dm), ct);
    }
}

/// <summary>Starts a campaign (the DM only).</summary>
public sealed class CreateCampaignEndpoint : Endpoint<SaveCampaignRequest, CampaignModel>
{
    private readonly IPersistence _persistence;
    private readonly PlayerAccess _access;

    public CreateCampaignEndpoint(IPersistence persistence, PlayerAccess access)
    {
        _persistence = persistence;
        _access = access;
    }

    public override void Configure()
    {
        Post("");
        Group<CampaignsGroup>();
        AllowAnonymous();
    }

    public override async Task HandleAsync(SaveCampaignRequest req, CancellationToken ct)
    {
        if (!CampaignAccess.IsDm(HttpContext, _access))
        {
            await Send.ForbiddenAsync(ct);
            return;
        }
        var campaigns = _persistence.GetRepository<ICampaignsRepository>();
        if (Campaign.Validate(req.Name, req.Description, req.CoverUrl, req.Party) is { } problem || (await campaigns.GetCampaignsAsync()).Count >= 50)
        {
            AddError(Campaign.Validate(req.Name, req.Description, req.CoverUrl, req.Party) ?? "At most 50 campaigns.");
            await Send.ErrorsAsync(cancellation: ct);
            return;
        }

        var campaign = Campaign.Create(req.Name!);
        campaign.Update(req.Name!, req.Description ?? string.Empty, req.CoverUrl, req.Party ?? []);
        campaigns.Add(campaign);
        await _persistence.SaveChangesAsync();
        await Send.OkAsync(CampaignAccess.Model(campaign), ct);
    }
}

/// <summary>Changes a campaign's name, description, cover or party (the DM only).</summary>
public sealed class UpdateCampaignEndpoint : Endpoint<SaveCampaignRequest, CampaignModel>
{
    private readonly IPersistence _persistence;
    private readonly PlayerAccess _access;

    public UpdateCampaignEndpoint(IPersistence persistence, PlayerAccess access)
    {
        _persistence = persistence;
        _access = access;
    }

    public override void Configure()
    {
        Put("{campaignId:guid}");
        Group<CampaignsGroup>();
        AllowAnonymous();
    }

    public override async Task HandleAsync(SaveCampaignRequest req, CancellationToken ct)
    {
        if (!CampaignAccess.IsDm(HttpContext, _access))
        {
            await Send.ForbiddenAsync(ct);
            return;
        }
        if (Campaign.Validate(req.Name, req.Description, req.CoverUrl, req.Party) is { } problem)
        {
            AddError(problem);
            await Send.ErrorsAsync(cancellation: ct);
            return;
        }
        var campaign = await _persistence.GetRepository<ICampaignsRepository>().GetCampaignAsync(Route<Guid>("campaignId"));
        if (campaign is null)
        {
            await Send.NotFoundAsync(ct);
            return;
        }

        if (campaign.CoverUrl != req.CoverUrl)
        {
            CampaignAccess.DeleteImage(Config, campaign.Id, campaign.CoverUrl);
        }
        campaign.Update(req.Name!, req.Description ?? string.Empty, req.CoverUrl, req.Party ?? []);
        await _persistence.SaveChangesAsync();
        await Send.OkAsync(CampaignAccess.Model(campaign), ct);
    }
}

/// <summary>Deletes a campaign with all its entries and pictures (the DM only).</summary>
public sealed class DeleteCampaignEndpoint : EndpointWithoutRequest
{
    private readonly IPersistence _persistence;
    private readonly PlayerAccess _access;

    public DeleteCampaignEndpoint(IPersistence persistence, PlayerAccess access)
    {
        _persistence = persistence;
        _access = access;
    }

    public override void Configure()
    {
        Delete("{campaignId:guid}");
        Group<CampaignsGroup>();
        AllowAnonymous();
    }

    public override async Task HandleAsync(CancellationToken ct)
    {
        if (!CampaignAccess.IsDm(HttpContext, _access))
        {
            await Send.ForbiddenAsync(ct);
            return;
        }
        var campaigns = _persistence.GetRepository<ICampaignsRepository>();
        var campaign = await campaigns.GetCampaignAsync(Route<Guid>("campaignId"));
        if (campaign is null)
        {
            await Send.NotFoundAsync(ct);
            return;
        }

        campaigns.Remove(campaign);
        await _persistence.SaveChangesAsync();
        var folder = CampaignAccess.Folder(Config, campaign.Id);
        if (Directory.Exists(folder))
        {
            Directory.Delete(folder, recursive: true);
        }
        await Send.NoContentAsync(ct);
    }
}

/// <summary>Adds an entry to a campaign (the DM only).</summary>
public sealed class CreateCampaignEntryEndpoint : Endpoint<SaveEntryRequest, CampaignEntryModel>
{
    private readonly IPersistence _persistence;
    private readonly PlayerAccess _access;

    public CreateCampaignEntryEndpoint(IPersistence persistence, PlayerAccess access)
    {
        _persistence = persistence;
        _access = access;
    }

    public override void Configure()
    {
        Post("{campaignId:guid}/entries");
        Group<CampaignsGroup>();
        AllowAnonymous();
    }

    public override async Task HandleAsync(SaveEntryRequest req, CancellationToken ct)
    {
        if (!CampaignAccess.IsDm(HttpContext, _access))
        {
            await Send.ForbiddenAsync(ct);
            return;
        }
        var data = req.Data?.ValueKind is JsonValueKind.Object ? req.Data.Value.GetRawText() : "{}";
        if (CampaignEntry.Validate(req.Kind, req.Title, req.Number, req.OccurredOn, req.Body, req.DmNotes, req.ImageUrl, data) is { } problem)
        {
            AddError(problem);
            await Send.ErrorsAsync(cancellation: ct);
            return;
        }
        var campaigns = _persistence.GetRepository<ICampaignsRepository>();
        var campaign = await campaigns.GetCampaignAsync(Route<Guid>("campaignId"));
        if (campaign is null)
        {
            await Send.NotFoundAsync(ct);
            return;
        }
        if (await campaigns.CountEntriesAsync(campaign.Id) >= 5000)
        {
            AddError("At most 5,000 entries in a campaign.");
            await Send.ErrorsAsync(cancellation: ct);
            return;
        }

        var entry = CampaignEntry.Create(campaign.Id, req.Kind!);
        entry.Update(req.Title!, req.Number, req.OccurredOn, req.Visible, req.Body ?? string.Empty, req.DmNotes ?? string.Empty, req.ImageUrl, data, req.Sort);
        campaigns.Add(entry);
        await _persistence.SaveChangesAsync();
        await Send.OkAsync(CampaignView.Entry(entry, dm: true), ct);
    }
}

/// <summary>Changes an entry (the DM only); a replaced picture is deleted.</summary>
public sealed class UpdateCampaignEntryEndpoint : Endpoint<SaveEntryRequest, CampaignEntryModel>
{
    private readonly IPersistence _persistence;
    private readonly PlayerAccess _access;

    public UpdateCampaignEntryEndpoint(IPersistence persistence, PlayerAccess access)
    {
        _persistence = persistence;
        _access = access;
    }

    public override void Configure()
    {
        Put("{campaignId:guid}/entries/{entryId:guid}");
        Group<CampaignsGroup>();
        AllowAnonymous();
    }

    public override async Task HandleAsync(SaveEntryRequest req, CancellationToken ct)
    {
        if (!CampaignAccess.IsDm(HttpContext, _access))
        {
            await Send.ForbiddenAsync(ct);
            return;
        }
        var entry = await _persistence.GetRepository<ICampaignsRepository>().GetEntryAsync(Route<Guid>("campaignId"), Route<Guid>("entryId"));
        if (entry is null)
        {
            await Send.NotFoundAsync(ct);
            return;
        }
        var data = req.Data?.ValueKind is JsonValueKind.Object ? req.Data.Value.GetRawText() : "{}";
        // the kind stays what it was
        if (CampaignEntry.Validate(entry.Kind, req.Title, req.Number, req.OccurredOn, req.Body, req.DmNotes, req.ImageUrl, data) is { } problem)
        {
            AddError(problem);
            await Send.ErrorsAsync(cancellation: ct);
            return;
        }

        if (entry.ImageUrl != req.ImageUrl)
        {
            CampaignAccess.DeleteImage(Config, entry.CampaignId, entry.ImageUrl);
        }
        entry.Update(req.Title!, req.Number, req.OccurredOn, req.Visible, req.Body ?? string.Empty, req.DmNotes ?? string.Empty, req.ImageUrl, data, req.Sort);
        await _persistence.SaveChangesAsync();
        await Send.OkAsync(CampaignView.Entry(entry, dm: true), ct);
    }
}

/// <summary>Deletes an entry and its picture (the DM only).</summary>
public sealed class DeleteCampaignEntryEndpoint : EndpointWithoutRequest
{
    private readonly IPersistence _persistence;
    private readonly PlayerAccess _access;

    public DeleteCampaignEntryEndpoint(IPersistence persistence, PlayerAccess access)
    {
        _persistence = persistence;
        _access = access;
    }

    public override void Configure()
    {
        Delete("{campaignId:guid}/entries/{entryId:guid}");
        Group<CampaignsGroup>();
        AllowAnonymous();
    }

    public override async Task HandleAsync(CancellationToken ct)
    {
        if (!CampaignAccess.IsDm(HttpContext, _access))
        {
            await Send.ForbiddenAsync(ct);
            return;
        }
        var campaigns = _persistence.GetRepository<ICampaignsRepository>();
        var entry = await campaigns.GetEntryAsync(Route<Guid>("campaignId"), Route<Guid>("entryId"));
        if (entry is null)
        {
            await Send.NotFoundAsync(ct);
            return;
        }

        campaigns.Remove(entry);
        await _persistence.SaveChangesAsync();
        CampaignAccess.DeleteImage(Config, entry.CampaignId, entry.ImageUrl);
        await Send.NoContentAsync(ct);
    }
}

/// <summary>Stores a picture for a campaign (a cover, a person's portrait, a handout) under a random name (the DM only).</summary>
public sealed class UploadCampaignImageEndpoint : Endpoint<UploadPortraitRequest, UploadStoryImageResponse>
{
    private readonly IPersistence _persistence;
    private readonly PlayerAccess _access;

    public UploadCampaignImageEndpoint(IPersistence persistence, PlayerAccess access)
    {
        _persistence = persistence;
        _access = access;
    }

    public override void Configure()
    {
        Post("{campaignId:guid}/images");
        Group<CampaignsGroup>();
        AllowAnonymous();
    }

    public override async Task HandleAsync(UploadPortraitRequest req, CancellationToken ct)
    {
        if (!CampaignAccess.IsDm(HttpContext, _access))
        {
            await Send.ForbiddenAsync(ct);
            return;
        }
        var campaign = await _persistence.GetRepository<ICampaignsRepository>().GetCampaignAsync(Route<Guid>("campaignId"));
        if (campaign is null)
        {
            await Send.NotFoundAsync(ct);
            return;
        }

        var (url, error) = await PortraitFiles.SaveAsync(CampaignAccess.Folder(Config, campaign.Id), CampaignAccess.UrlPrefix(campaign.Id), req.Data, ct);
        if (url is null)
        {
            AddError(r => r.Data, error!);
            await Send.ErrorsAsync(cancellation: ct);
            return;
        }
        await Send.OkAsync(new UploadStoryImageResponse(url), ct);
    }
}

/// <summary>Serves a campaign picture; the random file name is what keeps an unrevealed one private.</summary>
public sealed class GetCampaignImageEndpoint : EndpointWithoutRequest
{
    public override void Configure()
    {
        Get("{campaignId:guid}/images/{file}");
        Group<CampaignsGroup>();
        AllowAnonymous();
    }

    public override async Task HandleAsync(CancellationToken ct)
    {
        var name = Route<string>("file") ?? string.Empty;
        var path = Path.Combine(CampaignAccess.Folder(Config, Route<Guid>("campaignId")), name);
        if (!PortraitFiles.FileName().IsMatch(name) || !File.Exists(path))
        {
            await Send.NotFoundAsync(ct);
            return;
        }

        var contentType = Path.GetExtension(name) switch { ".png" => "image/png", ".webp" => "image/webp", _ => "image/jpeg" };
        HttpContext.Response.Headers.CacheControl = "private, max-age=31536000, immutable";
        await Send.FileAsync(new FileInfo(path), contentType, cancellation: ct);
    }
}
