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
            // likewise an element with a rule for a statistic that requirements test: a species' walking speed
            // decides Fast Movement's "[innate speed:1]", whichever of the two the character gained first
            else if (registration is not null && await ChangesTestedStatistic(registration.AssociatedElementId.Value))
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

    private async Task<bool> ChangesTestedStatistic(Guid elementId)
    {
        var tested = await _elements.GetStatisticsReferencedByRequirements();
        if (tested is null || tested.Count == 0)
        {
            return false;
        }
        var element = await _elements.GetElementWithRules(elementId);
        return element?.StatisticRules.Any(r => tested.Contains(r.Name)) == true;
    }
}
