using System.Text.Json;
using FastEndpoints;
using Microsoft.AspNetCore.Http;
using Starlights.Modules.Characters.Data;
using Starlights.Modules.Characters.Domain.Campaigns;
using Starlights.Modules.Characters.Services.Campaigns;
using Starlights.Modules.Characters.Services.Players;
using Starlights.Modules.Characters.Services.Processing;
using Starlights.Modules.Elements.Integration;
using Starlights.Platform.Data;

namespace Starlights.Modules.Characters.Endpoints.Campaigns;

/// <summary>One party member hands another an item (ItemId, Quantity 0 = all of it) and/or coins.</summary>
public sealed record TradeRequest(Guid FromCharacterId, Guid ToCharacterId, string? ItemId, int Quantity, Dictionary<string, int>? Coins);

public sealed record TradeResponse(string Given, int FromRevision);

/// <summary>
/// Players trade between their characters: whoever may change the giving character (its player, or the DM) hands an
/// item or coins to another character of the same campaign's party. It leaves the giver's equipment (unequipped,
/// with its rules) and arrives in the other character's, and the Gold tab gets a line for it.
/// </summary>
public sealed class TradeEndpoint : Endpoint<TradeRequest, TradeResponse>
{
    private readonly IPersistence _persistence;
    private readonly PlayerAccess _access;
    private readonly IItemCatalog _catalog;
    private readonly AttachedRegistrations _attached;
    private readonly IRegistrationProcessor _processor;

    public TradeEndpoint(IPersistence persistence, PlayerAccess access, IItemCatalog catalog, AttachedRegistrations attached, IRegistrationProcessor processor)
    {
        _persistence = persistence;
        _access = access;
        _catalog = catalog;
        _attached = attached;
        _processor = processor;
    }

    public override void Configure()
    {
        Post("{campaignId:guid}/trade");
        Group<CampaignsGroup>();
        AllowAnonymous();
    }

    public override async Task HandleAsync(TradeRequest req, CancellationToken ct)
    {
        var campaigns = _persistence.GetRepository<ICampaignsRepository>();
        var campaign = await campaigns.GetCampaignAsync(Route<Guid>("campaignId"));
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
        var from = await characters.GetCharacterAsync(req.FromCharacterId);
        var to = await characters.GetCharacterAsync(req.ToCharacterId);
        if (from is null || to is null || req.FromCharacterId == req.ToCharacterId || !campaign.Party.Contains(req.FromCharacterId) || !campaign.Party.Contains(req.ToCharacterId))
        {
            AddError("Trade only with another character of this campaign's party.");
            await Send.ErrorsAsync(cancellation: ct);
            return;
        }

        var result = InventoryTrade.Move(from.Inventory, to.Inventory, req.ItemId, req.Quantity, req.Coins ?? []);
        if (result.Problem is { } problem)
        {
            AddError(problem);
            await Send.ErrorsAsync(cancellation: ct);
            return;
        }

        // what was active on the giver (equipped, attuned) takes its rules with it
        var removed = result.Moved.Select(i => i.RegistrationId).OfType<Guid>().ToList();
        foreach (var registration in removed)
        {
            await _attached.RemoveAsync(from.Id, registration);
        }
        from.UpdateInventory(result.From);
        to.UpdateInventory(result.To);

        // the Gold tab's record of it, visible to the party
        var catalog = await _catalog.GetAsync(ct);
        var head = result.Moved.FirstOrDefault();
        var itemName = head is null ? null : head.Name ?? (head.ElementId is { } id ? catalog.Find(id)?.Name : null) ?? "an item";
        var coins = (req.Coins ?? []).Where(c => c.Value > 0).ToDictionary();
        var given = string.Join(" and ", new[]
        {
            itemName is null ? null : $"{(head!.Quantity > 1 ? $"{head.Quantity} × " : string.Empty)}{itemName}{(result.Moved.Count > 1 ? $" (with {result.Moved.Count - 1} things inside)" : string.Empty)}",
            coins.Count > 0 ? string.Join(" ", coins.Select(c => $"{c.Value} {c.Key}")) : null,
        }.OfType<string>());
        var line = CampaignEntry.Create(campaign.Id, CampaignEntry.Ledger);
        line.Update($"{from.Name} gave {to.Name}", null, DateTime.UtcNow.ToString("yyyy-MM-dd"), true, string.Empty, string.Empty, null,
            JsonSerializer.Serialize(new { coins, to = to.Id.Value.ToString(), items = itemName is null ? Array.Empty<string>() : [given.Split(" and ")[0]] }), 0);
        campaigns.Add(line);
        await _persistence.SaveChangesAsync();
        if (removed.Count > 0 || result.Moved.Any(i => i.Equipped is not null))
        {
            await _processor.ReproccessRegistrations(from.Id);
        }
        await Send.OkAsync(new TradeResponse(given, result.From.Revision), ct);
    }
}
