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
public sealed record CampaignSummaryModel(Guid Id, string Name, string Description, string? CoverUrl, IReadOnlyList<Guid> Party, bool Locked, bool CanOpen, DateTimeOffset UpdatedAt, string? DmName = null, bool Dm = false);

public sealed record CampaignsResponse(List<CampaignSummaryModel> Campaigns, bool Dm);

/// <summary>
/// A party member as the campaign shows them: like the characters list, a character whose player locked it shows
/// only its name and player unless the reader holds the player's token; a character deleted since is "missing".
/// </summary>
public sealed record PartyMemberModel(Guid CharacterId, string Name, string? PlayerName, int? Level, string? Build, string? PortraitUrl, bool Locked, bool Missing);

/// <summary>A campaign; DmToken only in the answer to its creation (the creator's DM token).</summary>
public sealed record CampaignModel(Guid Id, string Name, string Description, string? CoverUrl, IReadOnlyList<Guid> Party, bool Locked, DateTimeOffset UpdatedAt, string? DmName = null, bool HasDmPassword = false, string? DmToken = null, bool UseHomebrew = false);

public sealed record CampaignResponse(CampaignModel Campaign, List<PartyMemberModel> Party, List<CampaignEntryModel> Entries, bool Dm);

public sealed record SaveCampaignRequest(string? Name, string? Description, string? CoverUrl, List<Guid>? Party, string? DmName = null, string? DmPassword = null, bool? UseHomebrew = null);

public sealed record SaveEntryRequest(string? Kind, string? Title, int? Number, string? OccurredOn, bool Visible, string? Body, string? DmNotes, string? ImageUrl, JsonElement? Data, int Sort);

/// <summary>Who is the DM: whoever holds the admin token (the master password), checked on every request.</summary>
internal static class CampaignAccess
{
    /// <summary>The site's admin (the master password): DM of every campaign.</summary>
    public static bool IsAdmin(HttpContext context, PlayerAccess access) =>
        access.HasAdminToken(context.Request.Headers[PlayerAccess.TokenHeader]);

    /// <summary>Whether the reader is this campaign's DM: its DM token (from its DM password), or the admin token.</summary>
    public static bool IsDm(HttpContext context, PlayerAccess access, Guid campaignId) =>
        access.HasCampaignDmToken(context.Request.Headers[PlayerAccess.TokenHeader], campaignId);

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

    public static CampaignModel Model(Campaign c) => new(c.Id, c.Name, c.Description, c.CoverUrl, c.Party, c.PasswordHash is not null, c.UpdatedAt, c.DmName, c.DmPasswordHash is not null, UseHomebrew: c.UseHomebrew);

    /// <summary>Whether the reader may read the campaign: it is open, or they gave its password, or they are the DM.</summary>
    public static bool CanOpen(HttpContext context, PlayerAccess access, Campaign c) =>
        c.PasswordHash is null || access.HasCampaignToken(context.Request.Headers[PlayerAccess.TokenHeader], c.Id);

    /// <summary>The header a reader names their player in (for their own notes).</summary>
    public const string PlayerHeader = "X-Player-Name";

    /// <summary>
    /// The player the reader says they are, if they may act as that player: the player is not locked, or the reader
    /// holds its token. Null otherwise (or for reserved names).
    /// </summary>
    public static async Task<string?> VerifiedPlayer(HttpContext context, PlayerAccess access)
    {
        var name = Uri.UnescapeDataString(context.Request.Headers[PlayerHeader].ToString()).Trim();
        if (name.Length == 0 || name.Length > 100 || PlayerAccess.IsReservedName(name))
        {
            return null;
        }
        return !await access.IsLockedAsync(name) || access.HasToken(context.Request.Headers[PlayerAccess.TokenHeader], name) ? name : null;
    }

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
            campaigns.Select(c => CampaignAccess.CanOpen(HttpContext, _access, c) || CampaignAccess.IsDm(HttpContext, _access, c.Id)
                ? new CampaignSummaryModel(c.Id, c.Name, c.Description, c.CoverUrl, c.Party, c.PasswordHash is not null, true, c.UpdatedAt, c.DmName, CampaignAccess.IsDm(HttpContext, _access, c.Id))
                : new CampaignSummaryModel(c.Id, c.Name, string.Empty, null, [], true, false, c.UpdatedAt, c.DmName)).ToList(),
            CampaignAccess.IsAdmin(HttpContext, _access)), ct);
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

        if (!CampaignAccess.CanOpen(HttpContext, _access, campaign) && !CampaignAccess.IsDm(HttpContext, _access, campaign.Id))
        {
            HttpContext.Response.StatusCode = StatusCodes.Status401Unauthorized;
            await HttpContext.Response.WriteAsJsonAsync(new { locked = campaign.Name }, ct);
            return;
        }

        var dm = CampaignAccess.IsDm(HttpContext, _access, campaign.Id);
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

        var reader = await CampaignAccess.VerifiedPlayer(HttpContext, _access);
        await Send.OkAsync(new CampaignResponse(CampaignAccess.Model(campaign), party, CampaignView.Entries(entries, dm, reader), dm), ct);
    }
}

/// <summary>Starts a campaign: anyone can, choosing a DM password; its DM token comes back with it.</summary>
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
        // anyone can start a campaign and run it: the DM password they choose makes them its DM on any device
        var admin = CampaignAccess.IsAdmin(HttpContext, _access);
        var dmPassword = req.DmPassword ?? string.Empty;
        var campaigns = _persistence.GetRepository<ICampaignsRepository>();
        var problem = Campaign.Validate(req.Name, req.Description, req.CoverUrl, req.Party)
            ?? ((dmPassword.Length is > 0 and < 6 || dmPassword.Length > 200 || (dmPassword.Length == 0 && !admin)) ? "Choose a DM password of 6 to 200 characters: it lets you run the campaign from any device." : null)
            ?? ((req.DmName?.Trim().Length ?? 0) > 100 ? "The DM's name is too long (100 characters at most)." : null)
            ?? ((await campaigns.GetCampaignsAsync()).Count >= 200 ? "At most 200 campaigns." : null);
        if (problem is not null)
        {
            AddError(problem);
            await Send.ErrorsAsync(cancellation: ct);
            return;
        }

        var campaign = Campaign.Create(req.Name!);
        campaign.Update(req.Name!, req.Description ?? string.Empty, req.CoverUrl, req.Party ?? []);
        campaign.SetDm(req.DmName, dmPassword.Length > 0 ? PlayerAccess.HashPassword(dmPassword) : null);
        campaigns.Add(campaign);
        await _persistence.SaveChangesAsync();
        await Send.OkAsync(CampaignAccess.Model(campaign) with { DmToken = _access.IssueCampaignDmToken(campaign.Id) }, ct);
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
        if (!CampaignAccess.IsDm(HttpContext, _access, Route<Guid>("campaignId")))
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
        // left out (an older page): unchanged
        if (req.UseHomebrew is bool useHomebrew)
        {
            campaign.SetUseHomebrew(useHomebrew);
        }
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
        if (!CampaignAccess.IsDm(HttpContext, _access, Route<Guid>("campaignId")))
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
        if (!CampaignAccess.IsDm(HttpContext, _access, Route<Guid>("campaignId")))
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
        if (!CampaignAccess.IsDm(HttpContext, _access, Route<Guid>("campaignId")))
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
        if (!CampaignAccess.IsDm(HttpContext, _access, Route<Guid>("campaignId")))
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
        if (!CampaignAccess.IsDm(HttpContext, _access, Route<Guid>("campaignId")))
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
        if (!CampaignAccess.IsDm(HttpContext, _access, Route<Guid>("campaignId")))
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
        if (!CampaignAccess.IsDm(HttpContext, _access, Route<Guid>("campaignId")) && !await CampaignAccess.CanEditCharacter(HttpContext, _access, characterId))
        {
            await Send.ForbiddenAsync(ct);
            return;
        }
        campaign.Leave(characterId);
        await _persistence.SaveChangesAsync();
        await Send.NoContentAsync(ct);
    }
}

public sealed record GiveRequest(Guid CharacterId, Guid? CampaignItemId, Guid? ElementId, Guid? BaseElementId, int Quantity, Dictionary<string, int>? Coins, bool FromFund, string? Note, string? ImageUrl = null);

public sealed record GiveResponse(string Given, CampaignEntryModel Ledger);

/// <summary>
/// The DM gives a party member something: one of the campaign's own magic items (copied onto the character as a
/// homebrew item with its picture), an item of the content, or coins into their purse. It goes straight into the
/// character's equipment (the player does not have to add it, and can remove it), and the Gold tab gets a line for
/// it (with a line out of the party fund when it came from there).
/// </summary>
public sealed class GiveEndpoint : Endpoint<GiveRequest, GiveResponse>
{
    private readonly IPersistence _persistence;
    private readonly PlayerAccess _access;
    private readonly Modules.Elements.Integration.IItemCatalog _catalog;

    public GiveEndpoint(IPersistence persistence, PlayerAccess access, Modules.Elements.Integration.IItemCatalog catalog)
    {
        _persistence = persistence;
        _access = access;
        _catalog = catalog;
    }

    public override void Configure()
    {
        Post("{campaignId:guid}/give");
        Group<CampaignsGroup>();
        AllowAnonymous();
    }

    public override async Task HandleAsync(GiveRequest req, CancellationToken ct)
    {
        if (!CampaignAccess.IsDm(HttpContext, _access, Route<Guid>("campaignId")))
        {
            await Send.ForbiddenAsync(ct);
            return;
        }
        var campaigns = _persistence.GetRepository<ICampaignsRepository>();
        var campaign = await campaigns.GetCampaignAsync(Route<Guid>("campaignId"));
        var character = await _persistence.GetRepository<ICharactersRepository>().GetCharacterAsync(req.CharacterId);
        if (campaign is null || character is null || !campaign.Party.Contains(req.CharacterId))
        {
            AddError("Give only to a character in this campaign's party.");
            await Send.ErrorsAsync(StatusCodes.Status404NotFound, ct);
            return;
        }
        var coins = (req.Coins ?? []).Where(c => c.Value != 0).ToDictionary();
        if (coins.Any(c => !Domain.Characters.CharacterInventory.CoinKinds.Contains(c.Key) || c.Value is < 0 or > 1_000_000) || req.Quantity is < 0 or > 1000 || (req.Note?.Length ?? 0) > 500)
        {
            AddError("Coins are cp, sp, ep, gp and pp from 0 to 1,000,000; at most 1,000 of an item.");
            await Send.ErrorsAsync(cancellation: ct);
            return;
        }

        // a picture handed over with it: one of this campaign's uploads
        if (req.ImageUrl is { } picture && !picture.StartsWith(CampaignAccess.UrlPrefix(campaign.Id), StringComparison.Ordinal))
        {
            AddError("The picture must be one uploaded to this campaign.");
            await Send.ErrorsAsync(cancellation: ct);
            return;
        }

        Domain.Characters.InventoryItem? item = null;
        var elementToGive = req.ElementId;
        var baseToGive = req.BaseElementId;
        var pictureToGive = req.ImageUrl;
        string? nameToGive = null;
        if (req.CampaignItemId is { } campaignItemId)
        {
            var entry = await campaigns.GetEntryAsync(campaign.Id, campaignItemId);
            if (entry is null || entry.Kind != CampaignEntry.MagicItem)
            {
                await Send.NotFoundAsync(ct);
                return;
            }
            using var data = JsonDocument.Parse(entry.Data);
            string? Text(string name) => data.RootElement.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String && v.GetString() is { Length: > 0 } s ? s : null;
            pictureToGive ??= entry.ImageUrl;
            if (Text("elementId") is { } bookItem && Guid.TryParse(bookItem, out var bookId))
            {
                // an item of the books with the campaign's picture (and name): it goes as that item, so its rules apply
                elementToGive = bookId;
                baseToGive = Text("baseElementId") is { } b && Guid.TryParse(b, out var baseId) ? baseId : null;
                nameToGive = entry.Title;
            }
            else
            {
                item = new Domain.Characters.InventoryItem
                {
                    Id = Guid.NewGuid().ToString("N"),
                    Name = entry.Title,
                    Quantity = Math.Max(1, req.Quantity),
                    Card = true,
                    Custom = new Domain.Characters.CustomItem
                    {
                        Category = Text("category") ?? "Wondrous Item",
                        Description = entry.Body,
                        Magic = true,
                        Rarity = Text("rarity"),
                        Attunement = Text("attunement") is { } a && !a.Equals("no", StringComparison.OrdinalIgnoreCase),
                        Weight = data.RootElement.TryGetProperty("weight", out var w) && w.ValueKind == JsonValueKind.Number ? w.GetDecimal() : null,
                        ImageUrl = pictureToGive,
                        Source = campaign.Name,
                    },
                };
            }
        }
        if (item is null && elementToGive is { } elementId)
        {
            var catalog = await _catalog.GetAsync(ct);
            if (catalog.Find(elementId) is not { BuildOption: false } info)
            {
                AddError("That is not an item.");
                await Send.ErrorsAsync(cancellation: ct);
                return;
            }
            item = new Domain.Characters.InventoryItem
            {
                Id = Guid.NewGuid().ToString("N"),
                ElementId = elementId,
                BaseElementId = baseToGive,
                // the DM's own name for it, when it differs from the book's
                Name = nameToGive is not null && !nameToGive.Equals(info.Name, StringComparison.OrdinalIgnoreCase) ? nameToGive : null,
                Quantity = Math.Max(1, req.Quantity),
                Card = true,
                ImageUrl = pictureToGive,
            };
        }
        if (item is null && coins.Count == 0)
        {
            AddError("Give an item or some coins.");
            await Send.ErrorsAsync(cancellation: ct);
            return;
        }

        var inventory = character.Inventory;
        var purse = new Dictionary<string, int>(inventory.Coins);
        foreach (var (kind, n) in coins)
        {
            purse[kind] = purse.GetValueOrDefault(kind) + n;
        }
        var updated = inventory with
        {
            Revision = inventory.Revision + 1,
            Items = item is null ? inventory.Items : [.. inventory.Items, item],
            Coins = purse,
        };
        if (updated.Validate() is { } problem)
        {
            AddError(problem);
            await Send.ErrorsAsync(cancellation: ct);
            return;
        }
        character.UpdateInventory(updated);

        // the Gold tab's record of it
        var itemName = item?.Name ?? (item?.ElementId is { } id ? (await _catalog.GetAsync(ct)).Find(id)?.Name : null);
        var given = string.Join(" and ", new[] { item is null ? null : $"{(item.Quantity > 1 ? $"{item.Quantity} × " : string.Empty)}{itemName}", coins.Count > 0 ? string.Join(" ", coins.Select(c => $"{c.Value} {c.Key}")) : null }.OfType<string>());
        var line = CampaignEntry.Create(campaign.Id, CampaignEntry.Ledger);
        var lineData = JsonSerializer.Serialize(new { coins, to = character.Id.Value.ToString(), items = itemName is null ? Array.Empty<string>() : [itemName] });
        line.Update($"Given to {character.Name}", null, DateTime.UtcNow.ToString("yyyy-MM-dd"), true, req.Note ?? string.Empty, string.Empty, null, lineData, 0);
        campaigns.Add(line);
        if (req.FromFund && coins.Count > 0)
        {
            var fundLine = CampaignEntry.Create(campaign.Id, CampaignEntry.Ledger);
            fundLine.Update($"Paid out to {character.Name}", null, DateTime.UtcNow.ToString("yyyy-MM-dd"), true, string.Empty, string.Empty, null,
                JsonSerializer.Serialize(new { coins = coins.ToDictionary(c => c.Key, c => -c.Value), to = "party", items = Array.Empty<string>() }), 0);
            campaigns.Add(fundLine);
        }
        await _persistence.SaveChangesAsync();
        await Send.OkAsync(new GiveResponse(given, CampaignView.Entry(line, dm: true)), ct);
    }
}

public sealed record CampaignDmRequest(string? Name, string? Password);

/// <summary>Becomes a campaign's DM on this device: the right DM password gives its DM token.</summary>
public sealed class UnlockCampaignDmEndpoint : Endpoint<CampaignPasswordRequest, CampaignUnlockResponse>
{
    private readonly IPersistence _persistence;
    private readonly PlayerAccess _access;

    public UnlockCampaignDmEndpoint(IPersistence persistence, PlayerAccess access)
    {
        _persistence = persistence;
        _access = access;
    }

    public override void Configure()
    {
        Post("{campaignId:guid}/dm-unlock");
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
        if (campaign.DmPasswordHash is null || string.IsNullOrEmpty(req.Password) || !PlayerAccess.VerifyPassword(req.Password, campaign.DmPasswordHash))
        {
            await Send.UnauthorizedAsync(ct);
            return;
        }
        await Send.OkAsync(new CampaignUnlockResponse(_access.IssueCampaignDmToken(campaign.Id)), ct);
    }
}

/// <summary>Changes who runs a campaign (shown name) and its DM password (empty keeps it) — the DM only.</summary>
public sealed class SetCampaignDmEndpoint : Endpoint<CampaignDmRequest, CampaignModel>
{
    private readonly IPersistence _persistence;
    private readonly PlayerAccess _access;

    public SetCampaignDmEndpoint(IPersistence persistence, PlayerAccess access)
    {
        _persistence = persistence;
        _access = access;
    }

    public override void Configure()
    {
        Put("{campaignId:guid}/dm");
        Group<CampaignsGroup>();
        AllowAnonymous();
    }

    public override async Task HandleAsync(CampaignDmRequest req, CancellationToken ct)
    {
        if (!CampaignAccess.IsDm(HttpContext, _access, Route<Guid>("campaignId")))
        {
            await Send.ForbiddenAsync(ct);
            return;
        }
        var password = req.Password ?? string.Empty;
        if (password.Length is > 0 and < 6 || password.Length > 200 || (req.Name?.Trim().Length ?? 0) > 100)
        {
            AddError("A DM password has 6 to 200 characters (empty keeps the current one); a name at most 100.");
            await Send.ErrorsAsync(cancellation: ct);
            return;
        }
        var campaign = await _persistence.GetRepository<ICampaignsRepository>().GetCampaignAsync(Route<Guid>("campaignId"));
        if (campaign is null)
        {
            await Send.NotFoundAsync(ct);
            return;
        }
        campaign.SetDm(req.Name, password.Length > 0 ? PlayerAccess.HashPassword(password) : campaign.DmPasswordHash);
        await _persistence.SaveChangesAsync();
        await Send.OkAsync(CampaignAccess.Model(campaign), ct);
    }
}
