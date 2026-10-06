using System.Text.Json;
using System.Text.Json.Nodes;
using FastEndpoints;
using Microsoft.AspNetCore.Http;
using Starlights.Modules.Characters.Data;
using Starlights.Modules.Characters.Domain.Campaigns;
using Starlights.Modules.Characters.Services.Campaigns;
using Starlights.Modules.Characters.Services.Players;
using Starlights.Platform.Data;

namespace Starlights.Modules.Characters.Endpoints.Campaigns;

/// <summary>An encounter being run: the DM gets all of it (Dm true), players what FightView lets them see.</summary>
public sealed record FightResponse(Guid CampaignId, string CampaignName, Guid EntryId, string Title, bool Dm, JsonElement Fight);

/// <summary>The DM saves the whole fight; Revision is the one it started from (a stale save is refused).</summary>
public sealed record SaveFightRequest(JsonElement? Fight, int Revision);

/// <summary>A player marks a condition on a creature (or takes it off), as their character in the party.</summary>
public sealed record MarkFightRequest(Guid CharacterId, string? CombatantId, string? Condition, bool On);

public sealed record ActiveFightsResponse(List<FightResponse> Fights);

internal static class CampaignFights
{
    public static FightResponse Response(Campaign campaign, CampaignEntry entry, bool dm)
    {
        var fight = FightView.Parse(entry.Fight);
        var shown = dm ? fight : FightView.ForPlayers(fight);
        // an encounter the DM has not revealed keeps its title to itself
        var title = dm || entry.Visible ? entry.Title : "Encounter";
        return new FightResponse(campaign.Id, campaign.Name, entry.Id, title, dm, JsonSerializer.SerializeToElement(shown));
    }

    public static bool CanRead(HttpContext context, PlayerAccess access, Campaign campaign) =>
        CampaignAccess.CanOpen(context, access, campaign) || CampaignAccess.IsDm(context, access, campaign.Id);
}

/// <summary>An encounter's fight: the DM's whole of it; for players, only while it runs and without its secrets.</summary>
public sealed class GetFightEndpoint : EndpointWithoutRequest<FightResponse>
{
    private readonly IPersistence _persistence;
    private readonly PlayerAccess _access;

    public GetFightEndpoint(IPersistence persistence, PlayerAccess access)
    {
        _persistence = persistence;
        _access = access;
    }

    public override void Configure()
    {
        Get("{campaignId:guid}/entries/{entryId:guid}/fight");
        Group<CampaignsGroup>();
        AllowAnonymous();
    }

    public override async Task HandleAsync(CancellationToken ct)
    {
        var campaigns = _persistence.GetRepository<ICampaignsRepository>();
        var campaign = await campaigns.GetCampaignAsync(Route<Guid>("campaignId"));
        var entry = campaign is null ? null : await campaigns.GetEntryAsync(campaign.Id, Route<Guid>("entryId"));
        if (campaign is null || entry is null || entry.Kind != "encounter")
        {
            await Send.NotFoundAsync(ct);
            return;
        }
        if (!CampaignFights.CanRead(HttpContext, _access, campaign))
        {
            await Send.UnauthorizedAsync(ct);
            return;
        }
        var dm = CampaignAccess.IsDm(HttpContext, _access, campaign.Id);
        if (!dm && !FightView.Active(FightView.Parse(entry.Fight)))
        {
            await Send.NotFoundAsync(ct);
            return;
        }
        await Send.OkAsync(CampaignFights.Response(campaign, entry, dm), ct);
    }
}

/// <summary>The DM saves the fight (the initiative order, hit points, conditions, whose turn it is).</summary>
public sealed class SaveFightEndpoint : Endpoint<SaveFightRequest, FightResponse>
{
    private readonly IPersistence _persistence;
    private readonly PlayerAccess _access;

    public SaveFightEndpoint(IPersistence persistence, PlayerAccess access)
    {
        _persistence = persistence;
        _access = access;
    }

    public override void Configure()
    {
        Put("{campaignId:guid}/entries/{entryId:guid}/fight");
        Group<CampaignsGroup>();
        AllowAnonymous();
    }

    public override async Task HandleAsync(SaveFightRequest req, CancellationToken ct)
    {
        if (!CampaignAccess.IsDm(HttpContext, _access, Route<Guid>("campaignId")))
        {
            await Send.ForbiddenAsync(ct);
            return;
        }
        var campaigns = _persistence.GetRepository<ICampaignsRepository>();
        var campaign = await campaigns.GetCampaignAsync(Route<Guid>("campaignId"));
        var entry = campaign is null ? null : await campaigns.GetEntryAsync(campaign.Id, Route<Guid>("entryId"));
        if (campaign is null || entry is null || entry.Kind != "encounter")
        {
            await Send.NotFoundAsync(ct);
            return;
        }
        var fight = req.Fight?.ValueKind == JsonValueKind.Object ? FightView.Parse(req.Fight.Value.GetRawText()) : null;
        if (fight is null || FightView.Validate(fight) is { } problem)
        {
            AddError(fight is null ? "The encounter must be a JSON object." : FightView.Validate(fight)!);
            await Send.ErrorsAsync(cancellation: ct);
            return;
        }
        var current = FightView.Parse(entry.Fight);
        if (FightView.Revision(current) != req.Revision)
        {
            // changed since (a player marked a condition): the DM's page reloads it and tries again
            HttpContext.Response.StatusCode = StatusCodes.Status409Conflict;
            await HttpContext.Response.WriteAsJsonAsync(CampaignFights.Response(campaign, entry, dm: true), ct);
            return;
        }
        fight["revision"] = req.Revision + 1;
        entry.SetFight(fight.ToJsonString());
        await _persistence.SaveChangesAsync();
        await Send.OkAsync(CampaignFights.Response(campaign, entry, dm: true), ct);
    }
}

/// <summary>
/// A player marks a condition on a creature in a running fight (Frightened, Faerie Fire…) or takes it off: as a
/// character of the party they may change (unlocked, or their token).
/// </summary>
public sealed class MarkFightEndpoint : Endpoint<MarkFightRequest, FightResponse>
{
    private readonly IPersistence _persistence;
    private readonly PlayerAccess _access;

    public MarkFightEndpoint(IPersistence persistence, PlayerAccess access)
    {
        _persistence = persistence;
        _access = access;
    }

    public override void Configure()
    {
        Post("{campaignId:guid}/entries/{entryId:guid}/fight/mark");
        Group<CampaignsGroup>();
        AllowAnonymous();
    }

    public override async Task HandleAsync(MarkFightRequest req, CancellationToken ct)
    {
        var campaigns = _persistence.GetRepository<ICampaignsRepository>();
        var campaign = await campaigns.GetCampaignAsync(Route<Guid>("campaignId"));
        var entry = campaign is null ? null : await campaigns.GetEntryAsync(campaign.Id, Route<Guid>("entryId"));
        if (campaign is null || entry is null || entry.Kind != "encounter")
        {
            await Send.NotFoundAsync(ct);
            return;
        }
        var dm = CampaignAccess.IsDm(HttpContext, _access, campaign.Id);
        if (!dm && (!CampaignFights.CanRead(HttpContext, _access, campaign) || !campaign.Party.Contains(req.CharacterId) || !await CampaignAccess.CanEditCharacter(HttpContext, _access, req.CharacterId)))
        {
            await Send.ForbiddenAsync(ct);
            return;
        }
        var fight = FightView.Parse(entry.Fight);
        var character = await _persistence.GetRepository<ICharactersRepository>().GetCharacterAsync(req.CharacterId);
        var by = dm && character is null ? "DM" : character?.Name ?? "?";
        if (!FightView.Active(fight) || !FightView.Mark(fight, req.CombatantId ?? string.Empty, req.Condition ?? string.Empty, req.On, by))
        {
            AddError("No such creature or condition in a running encounter.");
            await Send.ErrorsAsync(cancellation: ct);
            return;
        }
        fight["revision"] = FightView.Revision(fight) + 1;
        entry.SetFight(fight.ToJsonString());
        await _persistence.SaveChangesAsync();
        await Send.OkAsync(CampaignFights.Response(campaign, entry, dm), ct);
    }
}

/// <summary>The fights running in the campaigns a character's party is in, for its Battle Action Simulator.</summary>
public sealed class GetActiveFightsEndpoint : EndpointWithoutRequest<ActiveFightsResponse>
{
    private readonly IPersistence _persistence;
    private readonly PlayerAccess _access;

    public GetActiveFightsEndpoint(IPersistence persistence, PlayerAccess access)
    {
        _persistence = persistence;
        _access = access;
    }

    public override void Configure()
    {
        Get("fights");
        Group<CampaignsGroup>();
        AllowAnonymous();
    }

    public override async Task HandleAsync(CancellationToken ct)
    {
        var fights = new List<FightResponse>();
        if (!Guid.TryParse(Query<string>("characterId", isRequired: false), out var characterId))
        {
            await Send.OkAsync(new ActiveFightsResponse(fights), ct);
            return;
        }
        var campaigns = _persistence.GetRepository<ICampaignsRepository>();
        foreach (var campaign in await campaigns.GetCampaignsAsync())
        {
            if (!campaign.Party.Contains(characterId) || !CampaignFights.CanRead(HttpContext, _access, campaign))
            {
                continue;
            }
            var dm = CampaignAccess.IsDm(HttpContext, _access, campaign.Id);
            foreach (var entry in await campaigns.GetEntriesAsync(campaign.Id))
            {
                if (entry.Kind == "encounter" && FightView.Active(FightView.Parse(entry.Fight)))
                {
                    fights.Add(CampaignFights.Response(campaign, entry, dm));
                }
            }
        }
        await Send.OkAsync(new ActiveFightsResponse(fights), ct);
    }
}
