using FastEndpoints;
using Starlights.Modules.Characters.Data;
using Starlights.Modules.Characters.Domain.Characters;
using Starlights.Modules.Characters.Services.Processing;
using Starlights.Platform.Data;

namespace Starlights.Modules.Characters.Endpoints.Characters.BuilderSession;

/// <summary>
/// The builder's Save and Discard. Opening the builder takes a snapshot of the character; what the player then
/// changes shows at once, but is kept for good only when they save (the snapshot is dropped). Discarding puts the
/// character back as it was when the builder was opened. Changed: whether the character differs from the snapshot.
/// </summary>
public sealed record BuilderSessionModel(bool Active, DateTimeOffset? Since, bool Changed);

internal static class BuilderSessions
{
    public static async Task<BuilderSessionModel> StateAsync(ICharacterSnapshotsRepository snapshots, Guid characterId)
    {
        var snapshot = await snapshots.GetAsync(characterId);
        if (snapshot is null)
        {
            return new BuilderSessionModel(false, null, false);
        }
        var now = await snapshots.CaptureAsync(characterId);
        return new BuilderSessionModel(true, snapshot.TakenAt, now != snapshot.Data);
    }
}

public sealed class GetBuilderSessionEndpoint : EndpointWithoutRequest<BuilderSessionModel>
{
    private readonly IPersistence _persistence;

    public GetBuilderSessionEndpoint(IPersistence persistence) => _persistence = persistence;

    public override void Configure()
    {
        Get("{characterId:guid}/builder/session");
        Group<CharactersGroup>();
        AllowAnonymous();
    }

    public override async Task HandleAsync(CancellationToken ct) =>
        await Send.OkAsync(await BuilderSessions.StateAsync(_persistence.GetRepository<ICharacterSnapshotsRepository>(), Route<Guid>("characterId")), ct);
}

/// <summary>Opens the builder: takes the snapshot, unless one is already waiting to be saved or discarded.</summary>
public sealed class StartBuilderSessionEndpoint : EndpointWithoutRequest<BuilderSessionModel>
{
    private readonly IPersistence _persistence;

    public StartBuilderSessionEndpoint(IPersistence persistence) => _persistence = persistence;

    public override void Configure()
    {
        Post("{characterId:guid}/builder/session");
        Group<CharactersGroup>();
        AllowAnonymous();
    }

    public override async Task HandleAsync(CancellationToken ct)
    {
        var id = Route<Guid>("characterId");
        if (await _persistence.GetRepository<ICharactersRepository>().GetCharacterAsync(new CharacterId(id)) is null)
        {
            await Send.NotFoundAsync(ct);
            return;
        }
        var snapshots = _persistence.GetRepository<ICharacterSnapshotsRepository>();
        if (await snapshots.GetAsync(id) is null)
        {
            snapshots.Add(CharacterSnapshot.Take(id, await snapshots.CaptureAsync(id)));
            await _persistence.SaveChangesAsync();
        }
        await Send.OkAsync(await BuilderSessions.StateAsync(snapshots, id), ct);
    }
}

/// <summary>Save: the changes are kept, and the next builder session starts from them.</summary>
public sealed class SaveBuilderSessionEndpoint : EndpointWithoutRequest<BuilderSessionModel>
{
    private readonly IPersistence _persistence;

    public SaveBuilderSessionEndpoint(IPersistence persistence) => _persistence = persistence;

    public override void Configure()
    {
        Post("{characterId:guid}/builder/session/save");
        Group<CharactersGroup>();
        AllowAnonymous();
    }

    public override async Task HandleAsync(CancellationToken ct)
    {
        var id = Route<Guid>("characterId");
        var snapshots = _persistence.GetRepository<ICharacterSnapshotsRepository>();
        if (await snapshots.GetAsync(id) is { } snapshot)
        {
            snapshots.Remove(snapshot);
            await _persistence.SaveChangesAsync();
        }
        await Send.OkAsync(new BuilderSessionModel(false, null, false), ct);
    }
}

/// <summary>Discard: the character goes back to how it was when the builder was opened.</summary>
public sealed class DiscardBuilderSessionEndpoint : EndpointWithoutRequest<BuilderSessionModel>
{
    private readonly IPersistence _persistence;
    private readonly IRegistrationProcessor _processor;

    public DiscardBuilderSessionEndpoint(IPersistence persistence, IRegistrationProcessor processor)
    {
        _persistence = persistence;
        _processor = processor;
    }

    public override void Configure()
    {
        Post("{characterId:guid}/builder/session/discard");
        Group<CharactersGroup>();
        AllowAnonymous();
    }

    public override async Task HandleAsync(CancellationToken ct)
    {
        var id = Route<Guid>("characterId");
        var snapshots = _persistence.GetRepository<ICharacterSnapshotsRepository>();
        var snapshot = await snapshots.GetAsync(id);
        if (snapshot is null)
        {
            AddError("There is nothing to discard: the character has no unsaved changes.");
            await Send.ErrorsAsync(cancellation: ct);
            return;
        }
        await snapshots.RestoreAsync(id, snapshot.Data);
        snapshots.Remove(snapshot);
        await _persistence.SaveChangesAsync();
        // the derived numbers settle as they would after any change
        await _processor.ReproccessRegistrations(new CharacterId(id));
        await Send.OkAsync(new BuilderSessionModel(false, null, false), ct);
    }
}

/// <summary>
/// Leaving the builder: the snapshot is dropped when nothing changed (so later changes from elsewhere, an item the DM
/// gives, are never taken for unsaved builder changes); with changes it stays, to be saved or discarded next time.
/// </summary>
public sealed class CloseBuilderSessionEndpoint : EndpointWithoutRequest<BuilderSessionModel>
{
    private readonly IPersistence _persistence;

    public CloseBuilderSessionEndpoint(IPersistence persistence) => _persistence = persistence;

    public override void Configure()
    {
        Post("{characterId:guid}/builder/session/close");
        Group<CharactersGroup>();
        AllowAnonymous();
    }

    public override async Task HandleAsync(CancellationToken ct)
    {
        var id = Route<Guid>("characterId");
        var snapshots = _persistence.GetRepository<ICharacterSnapshotsRepository>();
        var state = await BuilderSessions.StateAsync(snapshots, id);
        if (state.Active && !state.Changed && await snapshots.GetAsync(id) is { } snapshot)
        {
            snapshots.Remove(snapshot);
            await _persistence.SaveChangesAsync();
            state = new BuilderSessionModel(false, null, false);
        }
        await Send.OkAsync(state, ct);
    }
}
