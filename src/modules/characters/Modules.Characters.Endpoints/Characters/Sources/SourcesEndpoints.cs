using FastEndpoints;
using Starlights.Modules.Characters.Data;
using Starlights.Modules.Characters.Domain.Characters;
using Starlights.Platform.Data;

namespace Starlights.Modules.Characters.Endpoints.Characters.Sources;

public sealed record CharacterSourcesModel
{
    /// <summary>The source books switched off for the character.</summary>
    public List<string> Restricted { get; init; } = [];
}

/// <summary>
/// The source books a character does not use (its Sources section).
/// </summary>
public sealed class GetCharacterSourcesEndpoint : EndpointWithoutRequest<CharacterSourcesModel>
{
    private readonly IPersistence _persistence;

    public GetCharacterSourcesEndpoint(IPersistence persistence)
    {
        _persistence = persistence;
    }

    public override void Configure()
    {
        Get("{characterId:guid}/sources");
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

        await Send.OkAsync(new CharacterSourcesModel { Restricted = [.. character.RestrictedSources] }, ct);
    }
}

/// <summary>
/// Changes which source books a character uses. Existing picks stay; the dropdowns stop offering the rest.
/// </summary>
public sealed class UpdateCharacterSourcesEndpoint : Endpoint<CharacterSourcesModel>
{
    private readonly IPersistence _persistence;

    public UpdateCharacterSourcesEndpoint(IPersistence persistence)
    {
        _persistence = persistence;
    }

    public override void Configure()
    {
        Put("{characterId:guid}/sources");
        Group<CharactersGroup>();
        AllowAnonymous();
    }

    public override async Task HandleAsync(CharacterSourcesModel req, CancellationToken ct)
    {
        var character = await _persistence.GetRepository<ICharactersRepository>().GetCharacterAsync(new CharacterId(Route<Guid>("characterId")));
        if (character is null)
        {
            await Send.NotFoundAsync(ct);
            return;
        }

        character.RestrictSources(req.Restricted);
        await _persistence.SaveChangesAsync();
        await Send.NoContentAsync(ct);
    }
}
