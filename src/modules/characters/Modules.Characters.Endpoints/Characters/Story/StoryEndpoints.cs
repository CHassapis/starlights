using FastEndpoints;
using Starlights.Modules.Characters.Data;
using Starlights.Modules.Characters.Domain.Characters;
using Starlights.Platform.Data;

namespace Starlights.Modules.Characters.Endpoints.Characters.Story;

public sealed record CharacterStoryModel
{
    /// <summary>Named text fields: backstory, traits, ideals, bonds, flaws, age, height, …</summary>
    public Dictionary<string, string> Fields { get; init; } = [];
}

/// <summary>
/// A character's backstory, personality, appearance and notes.
/// </summary>
public sealed class GetCharacterStoryEndpoint : EndpointWithoutRequest<CharacterStoryModel>
{
    private readonly IPersistence _persistence;

    public GetCharacterStoryEndpoint(IPersistence persistence)
    {
        _persistence = persistence;
    }

    public override void Configure()
    {
        Get("{characterId:guid}/story");
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

        await Send.OkAsync(new CharacterStoryModel { Fields = new Dictionary<string, string>(character.Story) }, ct);
    }
}

/// <summary>
/// Replaces a character's story fields (at most 40 fields of 50,000 characters each).
/// </summary>
public sealed class UpdateCharacterStoryEndpoint : Endpoint<CharacterStoryModel>
{
    private readonly IPersistence _persistence;

    public UpdateCharacterStoryEndpoint(IPersistence persistence)
    {
        _persistence = persistence;
    }

    public override void Configure()
    {
        Put("{characterId:guid}/story");
        Group<CharactersGroup>();
        AllowAnonymous();
    }

    public override async Task HandleAsync(CharacterStoryModel req, CancellationToken ct)
    {
        if (req.Fields.Count > 40 || req.Fields.Any(f => f.Key.Length > 40 || f.Value.Length > 50_000))
        {
            AddError("At most 40 story fields of 50,000 characters each.");
            await Send.ErrorsAsync(cancellation: ct);
            return;
        }

        var character = await _persistence.GetRepository<ICharactersRepository>().GetCharacterAsync(new CharacterId(Route<Guid>("characterId")));
        if (character is null)
        {
            await Send.NotFoundAsync(ct);
            return;
        }

        character.UpdateStory(req.Fields);
        await _persistence.SaveChangesAsync();
        await Send.NoContentAsync(ct);
    }
}
