using Microsoft.AspNetCore.Http;
using FastEndpoints;
using Starlights.Modules.Characters.Data;
using Starlights.Modules.Characters.Domain.Characters;
using Starlights.Modules.Characters.Services.Processing;
using Starlights.Modules.Elements.Integration;
using Starlights.Platform.Data;

namespace Starlights.Modules.Characters.Endpoints.Characters.Inventory;

/// <summary>
/// A character's inventory: items (equipped, attuned, notes), coins, treasure and quest items.
/// </summary>
public sealed class GetCharacterInventoryEndpoint : EndpointWithoutRequest<CharacterInventory>
{
    private readonly IPersistence _persistence;

    public GetCharacterInventoryEndpoint(IPersistence persistence)
    {
        _persistence = persistence;
    }

    public override void Configure()
    {
        Get("{characterId:guid}/inventory");
        Group<CharactersGroup>();
        AllowAnonymous();
    }

    public override async Task HandleAsync(CancellationToken ct)
    {
        var character = await _persistence.GetRepository<ICharactersRepository>().GetCharacterAsync(new CharacterId(Route<Guid>("characterId")));
        if (character is null)
        {
            await Send.NotFoundAsync(ct);
            return;
        }

        await Send.OkAsync(character.Inventory, ct);
    }
}

public sealed record InventorySaved(int Revision);

/// <summary>
/// Replaces a character's inventory (at most 1,000 items, texts and numbers within limits, containers valid).
/// </summary>
public sealed class UpdateCharacterInventoryEndpoint : Endpoint<CharacterInventory>
{
    private readonly IPersistence _persistence;
    private readonly IItemCatalog _catalog;
    private readonly AttachedRegistrations _attached;
    private readonly IRegistrationProcessor _processor;

    public UpdateCharacterInventoryEndpoint(IPersistence persistence, IItemCatalog catalog, AttachedRegistrations attached, IRegistrationProcessor processor)
    {
        _persistence = persistence;
        _catalog = catalog;
        _attached = attached;
        _processor = processor;
    }

    public override void Configure()
    {
        Put("{characterId:guid}/inventory");
        Group<CharactersGroup>();
        AllowAnonymous();
    }

    public override async Task HandleAsync(CharacterInventory req, CancellationToken ct)
    {
        if (req.Validate() is { } problem)
        {
            AddError(problem);
            await Send.ErrorsAsync(cancellation: ct);
            return;
        }

        var character = await _persistence.GetRepository<ICharactersRepository>().GetCharacterAsync(new CharacterId(Route<Guid>("characterId")));
        if (character is null)
        {
            await Send.NotFoundAsync(ct);
            return;
        }

        // a save from an older copy would undo what happened since (an item the DM gave): refuse it, the app
        // reloads and applies its change again
        if (req.Revision != character.Inventory.Revision)
        {
            AddError("The equipment changed meanwhile; load it again.");
            await Send.ErrorsAsync(StatusCodes.Status409Conflict, ct);
            return;
        }

        // registrations belong to the server (whatever the client sent): an item whose element has rules is
        // registered while it is active, i.e. equipped, or attuned when it needs attunement (as Aurora applies them);
        // mundane weapons and armor are not, the sheet works them out from the catalog
        var catalog = await _catalog.GetAsync(ct);
        var previous = character.Inventory.Items.Where(i => i.RegistrationId is not null).ToDictionary(i => i.Id, i => i.RegistrationId);
        var items = new List<InventoryItem>(req.Items.Count);
        foreach (var entry in req.Items)
        {
            var info = entry.ElementId is { } elementId ? catalog.Find(elementId) : null;
            var active = info is { HasRules: true, BuildOption: false } && !entry.Stored
                && (info.Magic?.Attunement == true ? entry.Attuned : entry.Equipped is not null);
            var registration = await _attached.SyncAsync(character.Id, previous.GetValueOrDefault(entry.Id), entry.ElementId, active);
            items.Add(entry with
            {
                Name = string.IsNullOrWhiteSpace(entry.Name) ? null : entry.Name.Trim(),
                Notes = string.IsNullOrWhiteSpace(entry.Notes) ? null : entry.Notes,
                RegistrationId = registration,
            });
        }

        // entries that are gone take their registrations with them
        var kept = items.Select(i => i.RegistrationId).OfType<Guid>().ToHashSet();
        foreach (var gone in previous.Values.OfType<Guid>().Where(id => !kept.Contains(id)))
        {
            await _attached.RemoveAsync(character.Id, gone);
        }

        character.UpdateInventory(req with { Version = 1, Revision = character.Inventory.Revision + 1, Items = items });
        await _persistence.SaveChangesAsync();

        // an item's rules came or went: work the character out again now, so the sheet is right when this returns
        // (the background processing that follows finds nothing left to change)
        var registrationsChanged = !previous.Values.OfType<Guid>().ToHashSet().SetEquals(kept);
        if (registrationsChanged)
        {
            await _processor.ReproccessRegistrations(character.Id);
        }
        await Send.OkAsync(new InventorySaved(character.Inventory.Revision), ct);
    }
}
