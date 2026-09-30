using FastEndpoints;
using Starlights.Modules.Characters.Data;
using Starlights.Modules.Characters.Domain.Characters;
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

/// <summary>
/// Replaces a character's inventory (at most 1,000 items, texts and numbers within limits, containers valid).
/// </summary>
public sealed class UpdateCharacterInventoryEndpoint : Endpoint<CharacterInventory>
{
    private readonly IPersistence _persistence;

    public UpdateCharacterInventoryEndpoint(IPersistence persistence)
    {
        _persistence = persistence;
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

        // registrations belong to the server: keep the ones entries already had, whatever the client sent
        var registrations = character.Inventory.Items.Where(i => i.RegistrationId is not null).ToDictionary(i => i.Id, i => i.RegistrationId);
        character.UpdateInventory(req with
        {
            Version = 1,
            Items = req.Items.ConvertAll(i => i with
            {
                Name = string.IsNullOrWhiteSpace(i.Name) ? null : i.Name.Trim(),
                Notes = string.IsNullOrWhiteSpace(i.Notes) ? null : i.Notes,
                RegistrationId = registrations.GetValueOrDefault(i.Id),
            }),
        });
        await _persistence.SaveChangesAsync();
        await Send.NoContentAsync(ct);
    }
}
