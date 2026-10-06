using System.Text.Json;
using System.Text.Json.Nodes;

namespace Starlights.Modules.Characters.Services.Campaigns;

/// <summary>
/// An encounter being run (CampaignEntry.Fight): its JSON, checked when the DM saves it, and what players may see of
/// it. The DM keeps everything; players see the initiative order, the round, whose turn it is and every creature's
/// conditions, but of a monster only how hurt it looks ("bloodied"), never its hit points, its notes or what it
/// really is (its Compendium link), and its armor class and saves only when the DM shares them. Creatures the DM has
/// hidden are left out.
/// </summary>
public static class FightView
{
    /// <summary>The conditions and effects anyone in the party may mark on a creature from their simulator.</summary>
    public static readonly IReadOnlySet<string> Markable = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        "Blinded", "Charmed", "Deafened", "Frightened", "Grappled", "Incapacitated", "Invisible", "Paralyzed", "Petrified", "Poisoned",
        "Prone", "Restrained", "Stunned", "Unconscious", "Faerie Fire", "Dodging", "Guiding Bolt", "Hex", "Hunter's Mark", "Bane", "Bless",
        "Reckless", "Vexed", "Concentrating",
    };

    private const int MaxCombatants = 60;
    private const int MaxLength = 100_000;

    public static JsonObject Parse(string? json)
    {
        try
        {
            return JsonNode.Parse(string.IsNullOrWhiteSpace(json) ? "{}" : json) as JsonObject ?? [];
        }
        catch (JsonException)
        {
            return [];
        }
    }

    public static int Revision(JsonObject fight) => fight["revision"]?.GetValueKind() == JsonValueKind.Number ? fight["revision"]!.GetValue<int>() : 0;

    public static bool Active(JsonObject fight) => fight["active"]?.GetValueKind() == JsonValueKind.True;

    /// <summary>What is wrong with a fight the DM saves, or null when it is fine.</summary>
    public static string? Validate(JsonObject fight)
    {
        if (fight.ToJsonString().Length > MaxLength)
        {
            return "The encounter is too big.";
        }
        if (fight["combatants"] is not JsonArray combatants)
        {
            return fight.ContainsKey("combatants") ? "The creatures must be a list." : null;
        }
        if (combatants.Count > MaxCombatants)
        {
            return $"At most {MaxCombatants} creatures in an encounter.";
        }
        var ids = new HashSet<string>();
        foreach (var c in combatants)
        {
            if (c is not JsonObject o || o["id"]?.GetValueKind() != JsonValueKind.String || !ids.Add(o["id"]!.GetValue<string>()))
            {
                return "Every creature needs an id of its own.";
            }
            if (o["name"]?.GetValueKind() != JsonValueKind.String || o["name"]!.GetValue<string>().Length is 0 or > 100)
            {
                return "Every creature needs a name of at most 100 characters.";
            }
            if (o["conditions"] is { } conditions && (conditions is not JsonArray list || list.Count > 30))
            {
                return "At most 30 conditions on a creature.";
            }
        }
        return null;
    }

    /// <summary>How hurt a creature looks: unhurt, hurt, bloodied (half or less) or down.</summary>
    public static string Health(int hp, int max) =>
        hp <= 0 ? "down" : max <= 0 || hp >= max ? "unhurt" : hp * 2 <= max ? "bloodied" : "hurt";

    /// <summary>The fight as players see it (see the class summary).</summary>
    public static JsonObject ForPlayers(JsonObject fight)
    {
        var shareStats = fight["shareStats"]?.GetValueKind() == JsonValueKind.True;
        var visible = new JsonArray();
        var shown = new HashSet<string>();
        foreach (var c in fight["combatants"] as JsonArray ?? [])
        {
            if (c is not JsonObject o || o["hidden"]?.GetValueKind() == JsonValueKind.True)
            {
                continue;
            }
            var kind = o["kind"]?.GetValueKind() == JsonValueKind.String ? o["kind"]!.GetValue<string>() : "monster";
            var copy = new JsonObject
            {
                ["id"] = o["id"]?.DeepClone(),
                ["kind"] = kind,
                ["name"] = o["name"]?.DeepClone(),
                ["initiative"] = o["initiative"]?.DeepClone(),
                ["conditions"] = o["conditions"]?.DeepClone() ?? new JsonArray(),
            };
            if (kind == "pc")
            {
                copy["characterId"] = o["characterId"]?.DeepClone();
            }
            else
            {
                if (Number(o["hp"]) is { } hp && Number(o["maxHp"]) is { } max)
                {
                    copy["health"] = Health(hp, max);
                }
                if (shareStats)
                {
                    copy["ac"] = o["ac"]?.DeepClone();
                    copy["saves"] = o["saves"]?.DeepClone();
                }
            }
            shown.Add(copy["id"]?.GetValue<string>() ?? string.Empty);
            visible.Add(copy);
        }
        var turn = fight["turn"]?.GetValueKind() == JsonValueKind.String ? fight["turn"]!.GetValue<string>() : null;
        return new JsonObject
        {
            ["revision"] = Revision(fight),
            ["active"] = Active(fight),
            ["round"] = fight["round"]?.DeepClone() ?? 1,
            ["turn"] = turn is not null && shown.Contains(turn) ? turn : null,
            ["shareStats"] = shareStats,
            ["combatants"] = visible,
        };
    }

    /// <summary>
    /// Marks a condition on a visible creature, or takes it off (a player from their simulator). False when there is
    /// no such creature or condition.
    /// </summary>
    public static bool Mark(JsonObject fight, string combatantId, string condition, bool on, string by)
    {
        if (!Markable.Contains(condition))
        {
            return false;
        }
        var name = Markable.First(m => string.Equals(m, condition, StringComparison.OrdinalIgnoreCase));
        var target = (fight["combatants"] as JsonArray ?? []).OfType<JsonObject>()
            .FirstOrDefault(o => o["id"]?.GetValueKind() == JsonValueKind.String && o["id"]!.GetValue<string>() == combatantId && o["hidden"]?.GetValueKind() != JsonValueKind.True);
        if (target is null)
        {
            return false;
        }
        if (target["conditions"] is not JsonArray conditions)
        {
            conditions = [];
            target["conditions"] = conditions;
        }
        var existing = conditions.OfType<JsonObject>().FirstOrDefault(c => string.Equals(c["name"]?.ToString(), name, StringComparison.OrdinalIgnoreCase));
        if (on && existing is null)
        {
            conditions.Add(new JsonObject { ["name"] = name, ["by"] = by });
        }
        else if (!on && existing is not null)
        {
            conditions.Remove(existing);
        }
        return true;
    }

    private static int? Number(JsonNode? node) =>
        node?.GetValueKind() == JsonValueKind.Number && node.AsValue().TryGetValue<double>(out var n) ? (int)n : null;
}
