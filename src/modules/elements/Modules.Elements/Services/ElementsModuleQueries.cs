using Starlights.Modules.Elements.Data;
using Starlights.Modules.Elements.Domain;
using Starlights.Modules.Elements.Domain.Components;
using Starlights.Modules.Elements.Integration;
using Starlights.Modules.Elements.Integration.Models;
using Starlights.Modules.Elements.Integration.Models.Rules;
using Starlights.Platform.Data;

namespace Starlights.Modules.Elements.Services;

internal class ElementsModuleQueries : IElementsModuleQueries
{
    private readonly IPersistence _persistence;

    public ElementsModuleQueries(IPersistence persistence)
    {
        _persistence = persistence;
    }

    public async Task<CharacterCreationDataModel?> GetCharacterCreationElement(Guid uiid)
    {
        var repository = _persistence.GetRepository<IElementsRepository>();
        var element = await repository.GetElementAsync(uiid);
        return element?.AsCharacterCreationDataModel();
    }

    public async Task<List<CharacterCreationDataModel>> GetCharacterCreationElements()
    {
        var repository = _persistence.GetRepository<IElementsRepository>();
        var elements = await repository.GetElementsByTypeAsync(ElementTypeConstants.CharacterCreation);
        return elements.ConvertAll(element => element.AsCharacterCreationDataModel());
    }

    public async Task<ElementDataModel?> GetElementWithRules(Guid elementId)
    {
        var repository = _persistence.GetRepository<IElementsRepository>();
        var element = await repository.GetElementAsync(elementId);
        return element?.AsElementDataModel();
    }

    public async Task<List<IncludeRuleDataModel>> GetElementIncludeRules(Guid elementId)
    {
        var repository = _persistence.GetRepository<IElementsRepository>();
        var element = await repository.GetElementAsync(elementId);
        return element?.AsElementDataModel().IncludeRules ?? [];
    }

    public async Task<AbilityDataModel?> GetAbilityModel(Guid elementId)
    {
        var repository = _persistence.GetRepository<IElementsRepository>();
        var element = await repository.GetElementAsync(elementId);
        return element?.AsAbilityDataModel();
    }

    public async Task<SkillDataModel?> GetSkillModel(Guid elementId)
    {
        var repository = _persistence.GetRepository<IElementsRepository>();
        var element = await repository.GetElementAsync(elementId);
        return element?.AsSkillDataModel();
    }

    public async Task<SavingThrowDataModel?> GetSavingThrowModel(Guid elementId)
    {
        var repository = _persistence.GetRepository<IElementsRepository>();
        var element = await repository.GetElementAsync(elementId);
        return element?.AsSavingThrowDataModel();
    }

    public async Task<List<ElementDataModel>> GetElementsByType(string elementType)
    {
        var repository = _persistence.GetRepository<IElementsRepository>();
        var elements = await repository.GetElementsByTypeAsync(elementType);
        return elements.ConvertAll(e => e.AsElementDataModel());
    }

    public async Task<List<ElementDataModel>> GetSelectionOptions(string elementType, string? supports)
    {
        var repository = _persistence.GetRepository<IElementsRepository>();
        var elements = await repository.GetElementsByTypeAsync(elementType);

        if (!string.IsNullOrWhiteSpace(supports))
        {
            var matches = SupportsExpression.Compile(supports);
            elements = elements.FindAll(e => matches(
                e.GetComponent<SupportsComponent>()?.Supports ?? [],
                e.GetComponent<AuroraSourceComponent>()?.AuroraId));
        }

        return elements.ConvertAll(e => e.AsElementDataModel());
    }

    // rebuilt every few minutes: it only changes when content is imported
    private static (DateTime Loaded, IReadOnlySet<Guid> Ids)? s_referenced;

    public async Task<IReadOnlySet<Guid>> GetElementsReferencedByRequirements()
    {
        if (s_referenced is { } cached && DateTime.UtcNow - cached.Loaded < TimeSpan.FromMinutes(5))
        {
            return cached.Ids;
        }

        var requirements = await _persistence.GetRepository<IElementsRepository>().GetRuleRequirementsAsync();
        var ids = requirements
            .SelectMany(r => r.Split([',', '|', '!', '(', ')', ' '], StringSplitOptions.RemoveEmptyEntries))
            .Select(term => Guid.TryParse(term, out var id) ? id : Guid.Empty)
            .Where(id => id != Guid.Empty)
            .ToHashSet();

        s_referenced = (DateTime.UtcNow, ids);
        return ids;
    }

    public async Task<List<ElementDataModel>> GetElementsWithRules(IReadOnlyCollection<Guid> elementIds)
    {
        if (elementIds.Count == 0)
        {
            return [];
        }

        var repository = _persistence.GetRepository<IElementsRepository>();
        var elements = await repository.GetElementsByIdsAsync(elementIds);
        return elements.ConvertAll(e => e.AsElementDataModel());
    }
}
