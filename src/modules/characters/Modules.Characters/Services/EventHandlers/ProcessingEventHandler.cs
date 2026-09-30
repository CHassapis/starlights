using Microsoft.Extensions.Logging;
using Starlights.Modules.Characters.Data;
using Starlights.Modules.Characters.Domain;
using Starlights.Modules.Characters.Domain.Registrations.Eventing;
using Starlights.Modules.Characters.Services.Processing;
using Starlights.Modules.Elements.Integration;
using Starlights.Platform.Data;
using Starlights.Platform.Eventing;

namespace Starlights.Modules.Characters.Services.EventHandlers;

public sealed class ProcessingEventHandler : IDomainEventHandler<RegistrationCreatedEvent>
{
    private readonly ILogger<ProcessingEventHandler> _logger;
    private readonly IRegistrationProcessor _registrationProcessor;
    private readonly IPersistence _persistence;
    private readonly IElementsModuleQueries _elements;

    public ProcessingEventHandler(ILogger<ProcessingEventHandler> logger, IRegistrationProcessor registrationProcessor, IPersistence persistence, IElementsModuleQueries elements)
    {
        _logger = logger;
        _registrationProcessor = registrationProcessor;
        _persistence = persistence;
        _elements = elements;
    }

    public async Task HandleAsync(RegistrationCreatedEvent raisedEvent)
    {
        using var activity = CharactersInstrumentation.StartActivity($"{nameof(RegistrationCreatedEvent)} | {raisedEvent.AssociatedElementName} ({raisedEvent.AssociatedElementType})");

        try
        {
            await _registrationProcessor.ProcessRegistration(new(raisedEvent.RegistrationId));

            // gaining an element that other rules' requirements mention (e.g. a 2024 background's ability score
            // grant, which switches off a 2014 race's own increases) changes which of those rules apply
            var registration = await _persistence.GetRepository<IRegistrationRepository>().GetRegistrationAsync(new(raisedEvent.RegistrationId));
            if (registration is not null && (await _elements.GetElementsReferencedByRequirements()).Contains(registration.AssociatedElementId.Value))
            {
                await _registrationProcessor.ReproccessRegistrations(registration.CharacterId);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error processing registration '{RegistrationId}'", raisedEvent.RegistrationId);
            activity?.AddException(ex);
        }
    }
}
