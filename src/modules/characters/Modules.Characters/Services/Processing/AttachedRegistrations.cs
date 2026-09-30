using Microsoft.Extensions.Logging;
using Starlights.Modules.Characters.Data;
using Starlights.Modules.Characters.Domain;
using Starlights.Modules.Characters.Domain.Characters;
using Starlights.Modules.Characters.Domain.Registrations;
using Starlights.Modules.Elements.Integration;
using Starlights.Platform.Data;

namespace Starlights.Modules.Characters.Services.Processing;

/// <summary>
/// Registrations for things attached to a character outside the build: active magic items and extras (an
/// additional feat, an optional class feature). They are parentless registrations, like the character creation
/// root, so the rules engine applies their rules (a Cloak of Protection's +1 to saves, a granted spell) the same
/// way as a class feature's. The caller keeps the returned registration id and saves the changes.
/// </summary>
public sealed class AttachedRegistrations
{
    private readonly IPersistence _persistence;
    private readonly IRegistrationManager _manager;
    private readonly IElementsModuleQueries _elements;
    private readonly ILogger<AttachedRegistrations> _logger;

    public AttachedRegistrations(IPersistence persistence, IRegistrationManager manager, IElementsModuleQueries elements, ILogger<AttachedRegistrations> logger)
    {
        _persistence = persistence;
        _manager = manager;
        _elements = elements;
        _logger = logger;
    }

    /// <summary>
    /// Makes the character have (or not have) a registration of the element; returns the id to keep, or null.
    /// A registration of another element, or one that should not exist, is removed with everything it brought.
    /// </summary>
    public async Task<Guid?> SyncAsync(CharacterId characterId, Guid? currentRegistrationId, Guid? elementId, bool shouldExist)
    {
        var registrations = _persistence.GetRepository<IRegistrationRepository>();
        var current = currentRegistrationId is { } id ? await registrations.GetRegistrationAsync(new RegistrationId(id)) : null;
        if (current is not null && (current.CharacterId != characterId || current.ParentRegistrationId is not null))
        {
            // not one of ours: never touch registrations of the build
            _logger.LogWarning("registration {RegistrationId} is not an attached registration of character {CharacterId}; ignoring it", currentRegistrationId, characterId);
            current = null;
        }

        if (current is not null && (!shouldExist || current.AssociatedElementId.Value != elementId))
        {
            await _manager.Unregister(current);
            current = null;
        }

        if (current is null && shouldExist && elementId is { } element)
        {
            var definition = await _elements.GetElementWithRules(element);
            if (definition is null)
            {
                _logger.LogWarning("element {ElementId} for an attached registration does not exist", element);
                return null;
            }

            var registration = Registration.Create(characterId, new(definition.Id), definition.Name, definition.Type);
            await _manager.Register(registration);
            return registration.Id.Value;
        }

        return current?.Id.Value;
    }

    /// <summary>Removes an attached registration (and everything it brought), if it still exists.</summary>
    public async Task RemoveAsync(CharacterId characterId, Guid registrationId)
    {
        var registration = await _persistence.GetRepository<IRegistrationRepository>().GetRegistrationAsync(new RegistrationId(registrationId));
        if (registration is not null && registration.CharacterId == characterId && registration.ParentRegistrationId is null)
        {
            await _manager.Unregister(registration);
        }
    }
}
