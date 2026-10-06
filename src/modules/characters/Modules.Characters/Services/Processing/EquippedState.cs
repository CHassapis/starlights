using Starlights.Modules.Characters.Domain.Characters;
using Starlights.Modules.Elements.Integration;

namespace Starlights.Modules.Characters.Services.Processing;

/// <summary>
/// What a character is wearing and holding, for Aurora's equipped conditions ("[armor:none],[shield:none]" on
/// Unarmored Movement, "![armor:heavy]" on Fast Movement, "[primary:any],([secondary:none]||[shield:any])" on
/// Dueling). A two-handed weapon fills both hands; a shield is in the secondary hand.
/// </summary>
internal sealed class EquippedState
{
    private readonly ArmorInfo? _armor;
    private readonly string? _armorName;
    private readonly bool _shield;
    private readonly (WeaponInfo? Weapon, string Name)? _primary;
    private readonly (WeaponInfo? Weapon, string Name)? _secondary;

    private EquippedState(ArmorInfo? armor, string? armorName, bool shield, (WeaponInfo?, string)? primary, (WeaponInfo?, string)? secondary)
    {
        _armor = armor;
        _armorName = armorName;
        _shield = shield;
        _primary = primary;
        _secondary = secondary;
    }

    public static EquippedState From(CharacterInventory inventory, ItemCatalogSnapshot? catalog)
    {
        ArmorInfo? armor = null;
        string? armorName = null;
        var shield = false;
        (WeaponInfo?, string)? primary = null;
        (WeaponInfo?, string)? secondary = null;
        foreach (var item in inventory.Items.Where(i => i.Equipped is not null && !i.Stored))
        {
            var info = item.ElementId is { } id ? catalog?.Find(id) : null;
            var baseInfo = item.BaseElementId is { } baseId ? catalog?.Find(baseId) : null;
            var itemArmor = baseInfo?.Armor ?? info?.Armor;
            var weapon = baseInfo?.Weapon ?? info?.Weapon;
            var name = (baseInfo ?? info)?.Name ?? item.Name ?? string.Empty;
            if (itemArmor?.Kind == "Shield")
            {
                shield = true;
                secondary ??= (null, name);
                continue;
            }
            switch (item.Equipped)
            {
                case "Armor" when itemArmor is not null:
                    armor = itemArmor;
                    armorName = name;
                    break;
                case "Main Hand":
                    primary ??= (weapon, name);
                    break;
                case "Off Hand":
                    secondary ??= (weapon, name);
                    break;
                case "Two-Handed":
                    primary ??= (weapon, name);
                    secondary ??= (weapon, name);
                    break;
            }
        }
        return new EquippedState(armor, armorName, shield, primary, secondary);
    }

    /// <summary>Whether a term holds ("armor:none", "armor:heavy", "shield:any", "primary:versatile").</summary>
    public bool Holds(string term)
    {
        var cut = term.IndexOf(':');
        if (cut < 0)
        {
            return false;
        }
        var slot = term[..cut].Trim();
        var what = term[(cut + 1)..].Trim();
        return slot switch
        {
            "armor" => what switch
            {
                "none" => _armor is null,
                "any" => _armor is not null,
                _ => _armor is not null && (string.Equals(_armor.Kind, what, StringComparison.OrdinalIgnoreCase) || string.Equals(_armorName, what, StringComparison.OrdinalIgnoreCase)),
            },
            "shield" => what switch
            {
                "none" => !_shield,
                "any" => _shield,
                _ => false,
            },
            "primary" => Hand(_primary, what),
            "secondary" => Hand(_secondary, what),
            _ => false,
        };
    }

    private static bool Hand((WeaponInfo? Weapon, string Name)? held, string what) => what switch
    {
        "none" => held is null,
        "any" => held is not null,
        // a weapon property ("versatile", "light") or the weapon's name ("double-bladed scimitar")
        _ => held is { } h && ((h.Weapon?.Properties.Any(p => string.Equals(p, what, StringComparison.OrdinalIgnoreCase)) ?? false) || string.Equals(h.Name, what, StringComparison.OrdinalIgnoreCase)),
    };
}
