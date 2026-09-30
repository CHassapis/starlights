using System.Text;
using FastEndpoints;
using Starlights.Modules.Characters.Data;
using Starlights.Modules.Characters.Domain;
using Starlights.Modules.Characters.Domain.Appearances;
using Starlights.Modules.Characters.Domain.Classes;
using Starlights.Modules.Characters.Domain.Progression;
using Starlights.Platform.Data;

namespace Starlights.Modules.Characters.Endpoints.Characters.GetCharacters;

public sealed record GetCharactersRequest
{
    /// <summary>
    /// Only the characters of this player; all characters when omitted.
    /// </summary>
    [QueryParam]
    public string? Player { get; init; }
}

sealed class GetCharactersEndpoint : Endpoint<GetCharactersRequest, GetCharactersResponse>
{
    private readonly IPersistence _persistence;

    public GetCharactersEndpoint(IPersistence persistence)
    {
        _persistence = persistence;
    }

    public override void Configure()
    {
        Get("");
        Group<CharactersGroup>();
        AllowAnonymous();
    }

    public override async Task HandleAsync(GetCharactersRequest req, CancellationToken ct)
    {
        using var _ = CharactersInstrumentation.StartActivity(nameof(GetCharactersEndpoint));

        var repository = _persistence.GetRepository<ICharactersRepository>();

        var characters = await repository.GetCharactersAsync();
        if (req.Player is not null)
        {
            characters = characters.Where(c => string.Equals(c.PlayerName, req.Player.Trim(), StringComparison.OrdinalIgnoreCase)).ToList();
        }

        var models = new List<CharacterDetailsDataModel>();

        foreach (var character in characters)
        {
            var appearance = character.GetRequiredComponent<AppearanceComponent>();
            var progression = character.GetRequiredComponent<ProgressionComponent>();
            var classComponent = character.GetRequiredComponent<ClassComponent>();

            var build = new StringBuilder();
            foreach (var item in classComponent.Classes)
            {
                build.AppendFormat("{0}", item.Name);

                if (classComponent.IsMulticlass)
                {
                    build.AppendFormat(" ({0}) /", item.Level);
                }
            }

            models.Add(new CharacterDetailsDataModel
            {
                CharacterId = character.Id,
                Name = character.Name,
                PortraitUrl = appearance.PortraitUrl,
                Level = progression.CharacterLevel,
                Build = build.ToString(),
                PlayerName = character.PlayerName
            });
        }

        var response = new GetCharactersResponse { Characters = models };

        await Send.OkAsync(response, ct);
    }
}
