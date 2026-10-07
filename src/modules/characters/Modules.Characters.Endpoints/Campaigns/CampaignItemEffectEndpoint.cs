using FastEndpoints;
using Microsoft.AspNetCore.Http;
using Starlights.Modules.Characters.Data;
using Starlights.Modules.Characters.Services.Campaigns;
using Starlights.Modules.Characters.Services.Players;
using Starlights.Platform.Data;

namespace Starlights.Modules.Characters.Endpoints.Campaigns;

/// <summary>A magic item's healing (Kind "heal") or temporary hit points ("tempHp"), rolled by the user, for another party member.</summary>
public sealed record ItemEffectRequest(Guid FromCharacterId, Guid ToCharacterId, string? Kind, int Amount);

/// <summary>Only who got it: players never see another character's hit points.</summary>
public sealed record ItemEffectResponse(string Name);

/// <summary>
/// A character uses a magic item on another member of the same campaign's party, from the Battle Action Simulator:
/// whoever may change the user (its player, or the DM) gives the other character the healing or temporary hit points
/// rolled, in that character's fight state. The same rules as a trade (see <see cref="TradeEndpoint"/>).
/// </summary>
public sealed class ItemEffectEndpoint : Endpoint<ItemEffectRequest, ItemEffectResponse>
{
    private readonly IPersistence _persistence;
    private readonly PlayerAccess _access;

    public ItemEffectEndpoint(IPersistence persistence, PlayerAccess access)
    {
        _persistence = persistence;
        _access = access;
    }

    public override void Configure()
    {
        Post("{campaignId:guid}/item-effect");
        Group<CampaignsGroup>();
        AllowAnonymous();
    }

    public override async Task HandleAsync(ItemEffectRequest req, CancellationToken ct)
    {
        var campaign = await _persistence.GetRepository<ICampaignsRepository>().GetCampaignAsync(Route<Guid>("campaignId"));
        if (campaign is null)
        {
            await Send.NotFoundAsync(ct);
            return;
        }
        var dm = CampaignAccess.IsDm(HttpContext, _access, campaign.Id);
        if (!dm && (!CampaignAccess.CanOpen(HttpContext, _access, campaign) || !await CampaignAccess.CanEditCharacter(HttpContext, _access, req.FromCharacterId)))
        {
            await Send.ForbiddenAsync(ct);
            return;
        }
        var characters = _persistence.GetRepository<ICharactersRepository>();
        var problem = PartyItemEffect.Validate(campaign, req.FromCharacterId, req.ToCharacterId, req.Kind, req.Amount);
        var to = problem is null ? await characters.GetCharacterAsync(req.ToCharacterId) : null;
        if (problem is not null || to is null || await characters.GetCharacterAsync(req.FromCharacterId) is null)
        {
            AddError(problem ?? "Use it on another character of this campaign's party.");
            await Send.ErrorsAsync(cancellation: ct);
            return;
        }

        to.UpdateCombat(PartyItemEffect.Apply(to.Combat, req.Kind!, req.Amount));
        await _persistence.SaveChangesAsync();
        await Send.OkAsync(new ItemEffectResponse(to.Name), ct);
    }
}
