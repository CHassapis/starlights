using FastEndpoints;
using Starlights.Modules.Characters.Data;
using Starlights.Modules.Characters.Services.Processing;
using Starlights.Platform.Data;

namespace Starlights.Modules.Characters.Endpoints.Characters.Players;

public sealed record ReprocessCharactersResponse(int Characters, List<string> Failed);

/// <summary>
/// Runs every character through the builder rules again, so content added or changed since (a new choice such as
/// Deity, an updated book) reaches characters that already exist. Admin only (checked with the admin paths).
/// </summary>
public sealed class ReprocessCharactersEndpoint : EndpointWithoutRequest<ReprocessCharactersResponse>
{
    private readonly IPersistence _persistence;
    private readonly IRegistrationProcessor _processor;

    public ReprocessCharactersEndpoint(IPersistence persistence, IRegistrationProcessor processor)
    {
        _persistence = persistence;
        _processor = processor;
    }

    public override void Configure()
    {
        Post("admin/reprocess-characters");
        AllowAnonymous();
    }

    public override async Task HandleAsync(CancellationToken ct)
    {
        var characters = await _persistence.GetRepository<ICharactersRepository>().GetCharactersAsync();
        var failed = new List<string>();
        var count = 0;
        foreach (var character in characters.ToList())
        {
            var result = await _processor.ReproccessRegistrations(character.Id);
            if (!result.HasError)
            {
                count++;
            }
            else
            {
                failed.Add(character.Name);
            }
        }

        await Send.OkAsync(new ReprocessCharactersResponse(count, failed), ct);
    }
}
