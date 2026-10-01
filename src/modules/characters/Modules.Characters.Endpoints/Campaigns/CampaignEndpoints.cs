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

/// <summary>
/// A campaign in the list. A password-protected one the reader has not opened shows only its name: no
/// description, cover or party.
/// </summary>
public sealed record CampaignSummaryModel(Guid Id, string Name, string Description, string? CoverUrl, IReadOnlyList<Guid> Party, bool Locked, bool CanOpen, DateTimeOffset UpdatedAt);

public sealed record CampaignsResponse(List<CampaignSummaryModel> Campaigns, bool Dm);

/// <summary>
/// A party member as the campaign shows them: like the characters list, a character whose player locked it shows
/// only its name and player unless the reader holds the player's token; a character deleted since is "missing".
/// </summary>
public sealed record PartyMemberModel(Guid CharacterId, string Name, string? PlayerName, int? Level, string? Build, string? PortraitUrl, bool Locked, bool Missing);

public sealed record CampaignModel(Guid Id, string Name, string Description, string? CoverUrl, IReadOnlyList<Guid> Party, bool Locked, DateTimeOffset UpdatedAt);

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

    public static CampaignModel Model(Campaign c) => new(c.Id, c.Name, c.Description, c.CoverUrl, c.Party, c.PasswordHash is not null, c.UpdatedAt);

    /// <summary>Whether the reader may read the campaign: it is open, or they gave its password, or they are the DM.</summary>
    public static bool CanOpen(HttpContext context, PlayerAccess access, Campaign c) =>
        c.PasswordHash is null || access.HasCampaignToken(context.Request.Headers[PlayerAccess.TokenHeader], c.Id);

    /// <summary>Whether the reader may change the character: its player is not locked, or they hold the player's token.</summary>
    public static async Task<bool> CanEditCharacter(HttpContext context, PlayerAccess access, Guid characterId)
    {
        var player = await access.GetCharacterPlayerAsync(characterId);
        return string.IsNullOrEmpty(player) || !await access.IsLockedAsync(player) || access.HasToken(context.Request.Headers[PlayerAccess.TokenHeader], player);
    }
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
            campaigns.Select(c => CampaignAccess.CanOpen(HttpContext, _access, c)
                ? new CampaignSummaryModel(c.Id, c.Name, c.Description, c.CoverUrl, c.Party, c.PasswordHash is not null, true, c.UpdatedAt)
                : new CampaignSummaryModel(c.Id, c.Name, string.Empty, null, [], true, false, c.UpdatedAt)).ToList(),
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

        if (!CampaignAccess.CanOpen(HttpContext, _access, campaign))
        {
            HttpContext.Response.StatusCode = StatusCodes.Status401Unauthorized;
            await HttpContext.Response.WriteAsJsonAsync(new { locked = campaign.Name }, ct);
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

public sealed record CampaignPasswordRequest(string? Password);

public sealed record CampaignUnlockResponse(string Token);

public sealed record JoinCampaignRequest(Guid CharacterId);

/// <summary>Opens a password-protected campaign: the right password gives a token the browser keeps (as for players).</summary>
public sealed class UnlockCampaignEndpoint : Endpoint<CampaignPasswordRequest, CampaignUnlockResponse>
{
    private readonly IPersistence _persistence;
    private readonly PlayerAccess _access;

    public UnlockCampaignEndpoint(IPersistence persistence, PlayerAccess access)
    {
        _persistence = persistence;
        _access = access;
    }

    public override void Configure()
    {
        Post("{campaignId:guid}/unlock");
        Group<CampaignsGroup>();
        AllowAnonymous();
    }

    public override async Task HandleAsync(CampaignPasswordRequest req, CancellationToken ct)
    {
        var campaign = await _persistence.GetRepository<ICampaignsRepository>().GetCampaignAsync(Route<Guid>("campaignId"));
        if (campaign is null)
        {
            await Send.NotFoundAsync(ct);
            return;
        }
        if (campaign.PasswordHash is not null && !PlayerAccess.VerifyPassword(req.Password ?? string.Empty, campaign.PasswordHash))
        {
            AddError("That is not the campaign's password.");
            await Send.ErrorsAsync(StatusCodes.Status401Unauthorized, ct);
            return;
        }
        await Send.OkAsync(new CampaignUnlockResponse(_access.IssueCampaignToken(campaign.Id)), ct);
    }
}

/// <summary>Sets the campaign's password, or with an empty one opens it again (the DM only).</summary>
public sealed class SetCampaignPasswordEndpoint : Endpoint<CampaignPasswordRequest>
{
    private readonly IPersistence _persistence;
    private readonly PlayerAccess _access;

    public SetCampaignPasswordEndpoint(IPersistence persistence, PlayerAccess access)
    {
        _persistence = persistence;
        _access = access;
    }

    public override void Configure()
    {
        Put("{campaignId:guid}/password");
        Group<CampaignsGroup>();
        AllowAnonymous();
    }

    public override async Task HandleAsync(CampaignPasswordRequest req, CancellationToken ct)
    {
        if (!CampaignAccess.IsDm(HttpContext, _access))
        {
            await Send.ForbiddenAsync(ct);
            return;
        }
        var password = req.Password ?? string.Empty;
        if (password.Length is > 0 and < 6 || password.Length > 200)
        {
            AddError("A campaign password has 6 to 200 characters (empty removes it).");
            await Send.ErrorsAsync(cancellation: ct);
            return;
        }
        var campaign = await _persistence.GetRepository<ICampaignsRepository>().GetCampaignAsync(Route<Guid>("campaignId"));
        if (campaign is null)
        {
            await Send.NotFoundAsync(ct);
            return;
        }
        campaign.SetPasswordHash(password.Length == 0 ? null : PlayerAccess.HashPassword(password));
        await _persistence.SaveChangesAsync();
        await Send.NoContentAsync(ct);
    }
}

/// <summary>
/// A player joins their character to a campaign: they must be able to open the campaign (its password, if it has
/// one) and to change the character (its player's password, if locked). The DM can add any character.
/// </summary>
public sealed class JoinCampaignEndpoint : Endpoint<JoinCampaignRequest, CampaignModel>
{
    private readonly IPersistence _persistence;
    private readonly PlayerAccess _access;

    public JoinCampaignEndpoint(IPersistence persistence, PlayerAccess access)
    {
        _persistence = persistence;
        _access = access;
    }

    public override void Configure()
    {
        Post("{campaignId:guid}/party");
        Group<CampaignsGroup>();
        AllowAnonymous();
    }

    public override async Task HandleAsync(JoinCampaignRequest req, CancellationToken ct)
    {
        var campaign = await _persistence.GetRepository<ICampaignsRepository>().GetCampaignAsync(Route<Guid>("campaignId"));
        var character = await _persistence.GetRepository<ICharactersRepository>().GetCharacterAsync(req.CharacterId);
        if (campaign is null || character is null)
        {
            await Send.NotFoundAsync(ct);
            return;
        }
        if (!CampaignAccess.CanOpen(HttpContext, _access, campaign) || !await CampaignAccess.CanEditCharacter(HttpContext, _access, req.CharacterId))
        {
            await Send.ForbiddenAsync(ct);
            return;
        }
        if (!campaign.Join(req.CharacterId))
        {
            AddError("The party is full (20 characters).");
            await Send.ErrorsAsync(cancellation: ct);
            return;
        }
        await _persistence.SaveChangesAsync();
        await Send.OkAsync(CampaignAccess.Model(campaign), ct);
    }
}

/// <summary>Takes a character out of a campaign: whoever may change the character, or the DM.</summary>
public sealed class LeaveCampaignEndpoint : EndpointWithoutRequest
{
    private readonly IPersistence _persistence;
    private readonly PlayerAccess _access;

    public LeaveCampaignEndpoint(IPersistence persistence, PlayerAccess access)
    {
        _persistence = persistence;
        _access = access;
    }

    public override void Configure()
    {
        Delete("{campaignId:guid}/party/{characterId:guid}");
        Group<CampaignsGroup>();
        AllowAnonymous();
    }

    public override async Task HandleAsync(CancellationToken ct)
    {
        var campaign = await _persistence.GetRepository<ICampaignsRepository>().GetCampaignAsync(Route<Guid>("campaignId"));
        if (campaign is null)
        {
            await Send.NotFoundAsync(ct);
            return;
        }
        var characterId = Route<Guid>("characterId");
        if (!CampaignAccess.IsDm(HttpContext, _access) && !await CampaignAccess.CanEditCharacter(HttpContext, _access, characterId))
        {
            await Send.ForbiddenAsync(ct);
            return;
        }
        campaign.Leave(characterId);
        await _persistence.SaveChangesAsync();
        await Send.NoContentAsync(ct);
    }
}
