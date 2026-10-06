using FastEndpoints;
using Starlights.Modules.Characters.Data;
using Starlights.Modules.Characters.Domain.Characters;
using Starlights.Modules.Characters.Services.Processing;
using Starlights.Modules.Elements.Integration;
using Starlights.Platform.Data;

namespace Starlights.Modules.Characters.Endpoints.Characters.Extras;

public sealed record ExtraModel(string Id, Guid ElementId, string Name, IReadOnlyList<string> Categories, bool Applied);

public sealed record ExtrasResponse(List<ExtraModel> Extras);

public sealed record AddExtraRequest(Guid ElementId);

/// <summary>
/// The build options added on top of a character's normal build, like Aurora's additional options: an extra feat,
/// language, proficiency or spell, an optional class feature, a speed or vision bonus. Each is registered with the
/// rules engine; its choices appear in the builder's Extras section.
/// </summary>
public sealed class GetExtrasEndpoint : EndpointWithoutRequest<ExtrasResponse>
{
    private readonly IPersistence _persistence;
    private readonly IItemCatalog _catalog;

    public GetExtrasEndpoint(IPersistence persistence, IItemCatalog catalog)
    {
        _persistence = persistence;
        _catalog = catalog;
    }

    public override void Configure()
    {
        Get("{characterId:guid}/extras");
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

        var catalog = await _catalog.GetAsync(ct);
        // extras are build options; a multiclass is kept with them but listed by the multiclass endpoint
        await Send.OkAsync(new ExtrasResponse(character.Extras.Where(e => catalog.Find(e.ElementId) is { BuildOption: true }).Select(e =>
        {
            var info = catalog.Find(e.ElementId);
            return new ExtraModel(e.Id, e.ElementId, info?.Name ?? "Unknown option", info?.Categories ?? [], e.RegistrationId is not null);
        }).ToList()), ct);
    }
}

public sealed class AddExtraEndpoint : Endpoint<AddExtraRequest, ExtraModel>
{
    private readonly IPersistence _persistence;
    private readonly IItemCatalog _catalog;
    private readonly AttachedRegistrations _attached;
    private readonly IRegistrationProcessor _processor;

    public AddExtraEndpoint(IPersistence persistence, IItemCatalog catalog, AttachedRegistrations attached, IRegistrationProcessor processor)
    {
        _persistence = persistence;
        _catalog = catalog;
        _attached = attached;
        _processor = processor;
    }

    public override void Configure()
    {
        Post("{characterId:guid}/extras");
        Group<CharactersGroup>();
        AllowAnonymous();
    }

    public override async Task HandleAsync(AddExtraRequest req, CancellationToken ct)
    {
        var character = await _persistence.GetRepository<ICharactersRepository>().GetCharacterAsync(new CharacterId(Route<Guid>("characterId")));
        if (character is null)
        {
            await Send.NotFoundAsync(ct);
            return;
        }

        // only build options: anything else (a class, a species) belongs to the normal build
        var info = (await _catalog.GetAsync(ct)).Find(req.ElementId);
        if (info is not { BuildOption: true })
        {
            AddError(r => r.ElementId, "That is not an extra build option.");
            await Send.ErrorsAsync(cancellation: ct);
            return;
        }
        if (character.Extras.Count >= 100)
        {
            AddError("At most 100 extras.");
            await Send.ErrorsAsync(cancellation: ct);
            return;
        }

        var extra = new CharacterExtra { Id = Guid.NewGuid().ToString("N"), ElementId = req.ElementId };
        extra = extra with { RegistrationId = await _attached.SyncAsync(character.Id, null, req.ElementId, shouldExist: true) };
        character.UpdateExtras([.. character.Extras, extra]);
        await _persistence.SaveChangesAsync();
        await _processor.ReproccessRegistrations(character.Id);

        await Send.OkAsync(new ExtraModel(extra.Id, extra.ElementId, info.Name, info.Categories, extra.RegistrationId is not null), ct);
    }
}

public sealed class RemoveExtraEndpoint : EndpointWithoutRequest
{
    private readonly IPersistence _persistence;
    private readonly AttachedRegistrations _attached;
    private readonly IRegistrationProcessor _processor;

    public RemoveExtraEndpoint(IPersistence persistence, AttachedRegistrations attached, IRegistrationProcessor processor)
    {
        _persistence = persistence;
        _attached = attached;
        _processor = processor;
    }

    public override void Configure()
    {
        Delete("{characterId:guid}/extras/{extraId}");
        Group<CharactersGroup>();
        AllowAnonymous();
    }

    public override async Task HandleAsync(CancellationToken ct)
    {
        var character = await _persistence.GetRepository<ICharactersRepository>().GetCharacterAsync(new CharacterId(Route<Guid>("characterId")));
        var extra = character?.Extras.FirstOrDefault(e => e.Id == Route<string>("extraId"));
        if (character is null || extra is null)
        {
            await Send.NotFoundAsync(ct);
            return;
        }

        if (extra.RegistrationId is { } registration)
        {
            await _attached.RemoveAsync(character.Id, registration);
        }
        character.UpdateExtras(character.Extras.Where(e => e.Id != extra.Id));
        await _persistence.SaveChangesAsync();
        await _processor.ReproccessRegistrations(character.Id);

        await Send.NoContentAsync(ct);
    }
}
