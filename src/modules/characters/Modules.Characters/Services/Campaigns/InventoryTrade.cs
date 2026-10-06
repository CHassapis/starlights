using Starlights.Modules.Characters.Domain.Characters;

namespace Starlights.Modules.Characters.Services.Campaigns;

/// <summary>What a trade moved: both inventories after it, the entries that left the giver, and why it could not happen.</summary>
public sealed record TradeResult(CharacterInventory From, CharacterInventory To, IReadOnlyList<InventoryItem> Moved, string? Problem = null);

/// <summary>
/// One character hands another an item (or some of a stack) and/or coins. The item arrives on the person: not
/// equipped, not attuned, not in a container, with its charges and notes. A container goes with what is inside it.
/// </summary>
public static class InventoryTrade
{
    public static TradeResult Move(CharacterInventory giver, CharacterInventory taker, string? itemId, int quantity, IReadOnlyDictionary<string, int> coins)
    {
        TradeResult Fail(string problem) => new(giver, taker, [], problem);
        if (coins.Any(c => !CharacterInventory.CoinKinds.Contains(c.Key) || c.Value < 0))
        {
            return Fail("Coins are cp, sp, ep, gp and pp, none below 0.");
        }
        var given = coins.Where(c => c.Value > 0).ToDictionary();
        if (given.Any(c => giver.Coins.GetValueOrDefault(c.Key) < c.Value))
        {
            return Fail("Not that many coins in the purse.");
        }
        if (itemId is null && given.Count == 0)
        {
            return Fail("Give an item or some coins.");
        }

        var fromItems = giver.Items.ToList();
        var toItems = taker.Items.ToList();
        var moved = new List<InventoryItem>();
        if (itemId is not null)
        {
            var item = fromItems.FirstOrDefault(i => i.Id == itemId);
            if (item is null)
            {
                return Fail("That item is not in the inventory (any more).");
            }
            var count = quantity <= 0 ? item.Quantity : quantity;
            if (count > item.Quantity)
            {
                return Fail($"There are only {item.Quantity}.");
            }

            static InventoryItem Arrived(InventoryItem i, string? containerId) => i with
            {
                Id = Guid.NewGuid().ToString("N"),
                Equipped = null,
                Attuned = false,
                Stored = false,
                Attack = null,
                ContainerId = containerId,
                RegistrationId = null,
            };

            if (count < item.Quantity)
            {
                // part of a stack: the giver keeps the rest
                fromItems[fromItems.IndexOf(item)] = item with { Quantity = item.Quantity - count };
                toItems.Add(Arrived(item, null) with { Quantity = count });
                moved.Add(item with { Quantity = count, RegistrationId = null });
            }
            else
            {
                // the item, and when it is a container everything inside it (at any depth), keeping the nesting
                var newIds = new Dictionary<string, string>();
                var queue = new Queue<InventoryItem>([item]);
                while (queue.Count > 0)
                {
                    var next = queue.Dequeue();
                    var arrived = Arrived(next, next.Id == item.Id ? null : newIds[next.ContainerId!]);
                    newIds[next.Id] = arrived.Id;
                    toItems.Add(arrived);
                    moved.Add(next);
                    fromItems.Remove(next);
                    foreach (var inside in fromItems.Where(i => i.ContainerId == next.Id).ToList())
                    {
                        queue.Enqueue(inside);
                    }
                }
            }
        }

        var fromCoins = new Dictionary<string, int>(giver.Coins);
        var toCoins = new Dictionary<string, int>(taker.Coins);
        foreach (var (kind, n) in given)
        {
            fromCoins[kind] -= n;
            toCoins[kind] = toCoins.GetValueOrDefault(kind) + n;
        }
        var newFrom = giver with { Revision = giver.Revision + 1, Items = fromItems, Coins = fromCoins };
        var newTo = taker with { Revision = taker.Revision + 1, Items = toItems, Coins = toCoins };
        if ((newFrom.Validate() ?? newTo.Validate()) is { } problem)
        {
            return Fail(problem);
        }
        return new TradeResult(newFrom, newTo, moved);
    }
}
