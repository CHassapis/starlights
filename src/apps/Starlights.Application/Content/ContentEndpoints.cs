using FastEndpoints;
using Starlights.Modules.Elements.Services.Content;

namespace Starlights.Application.Content;

public sealed record ContentSourcesResponse(bool SelfManaged, ContentSettings Settings, string DefaultAurora, string DefaultFiveETools, ContentJobStatus Job, ContentStatus Status);

public sealed record SaveContentSourcesRequest(string? AuroraLink, string? FiveEToolsLink, bool Update = true, bool Force = false);

/// <summary>The content links, and what the content job is doing (admin only: everything under /api/admin).</summary>
public sealed class GetContentSourcesEndpoint : EndpointWithoutRequest<ContentSourcesResponse>
{
    private readonly ContentSync _sync;

    public GetContentSourcesEndpoint(ContentSync sync)
    {
        _sync = sync;
    }

    public override void Configure()
    {
        Get("admin/content-sources");
        AllowAnonymous();
    }

    public override async Task HandleAsync(CancellationToken ct) =>
        await Send.OkAsync(new ContentSourcesResponse(_sync.SelfManaged, _sync.Settings(), ContentSync.DefaultAurora, ContentSync.DefaultFiveETools, _sync.Status(), _sync.LocalStatus()), ct);
}

/// <summary>Saves the two GitHub links and (by default) starts bringing the content in.</summary>
public sealed class SaveContentSourcesEndpoint : Endpoint<SaveContentSourcesRequest, ContentSourcesResponse>
{
    private readonly ContentSync _sync;

    public SaveContentSourcesEndpoint(ContentSync sync)
    {
        _sync = sync;
    }

    public override void Configure()
    {
        Put("admin/content-sources");
        AllowAnonymous();
    }

    public override async Task HandleAsync(SaveContentSourcesRequest req, CancellationToken ct)
    {
        if (!_sync.SelfManaged)
        {
            AddError("This server updates its content with its own scripts (the homelab's nightly job), so the links can't be changed here.");
            await Send.ErrorsAsync(cancellation: ct);
            return;
        }
        var aurora = GitHubRepo.Parse(req.AuroraLink);
        var fiveETools = GitHubRepo.Parse(req.FiveEToolsLink);
        if (aurora is null || fiveETools is null)
        {
            AddError("Both links must be GitHub repository links, like https://github.com/AuroraLegacy/elements (a branch as /tree/name is fine).");
            await Send.ErrorsAsync(cancellation: ct);
            return;
        }
        if (_sync.Status().Running)
        {
            AddError("The content is being updated right now. Wait for it to finish.");
            await Send.ErrorsAsync(StatusCodes.Status409Conflict, ct);
            return;
        }
        _sync.SaveLinks(aurora, fiveETools);
        if (req.Update)
        {
            _sync.Start(req.Force);
        }
        await Send.OkAsync(new ContentSourcesResponse(_sync.SelfManaged, _sync.Settings(), ContentSync.DefaultAurora, ContentSync.DefaultFiveETools, _sync.Status(), _sync.LocalStatus()), ct);
    }
}

/// <summary>Brings the content in again from the saved links (what the nightly cron line and setup.sh call).</summary>
public sealed class UpdateContentEndpoint : Endpoint<SaveContentSourcesRequest, ContentJobStatus>
{
    private readonly ContentSync _sync;

    public UpdateContentEndpoint(ContentSync sync)
    {
        _sync = sync;
    }

    public override void Configure()
    {
        Post("admin/content-sources/update");
        AllowAnonymous();
    }

    public override async Task HandleAsync(SaveContentSourcesRequest req, CancellationToken ct)
    {
        if (!_sync.SelfManaged)
        {
            AddError("This server updates its content with its own scripts.");
            await Send.ErrorsAsync(cancellation: ct);
            return;
        }
        if (!_sync.Start(req.Force))
        {
            AddError("The content is being updated right now.");
            await Send.ErrorsAsync(StatusCodes.Status409Conflict, ct);
            return;
        }
        await Send.OkAsync(_sync.Status(), ct);
    }
}

/// <summary>
/// Whether GitHub has newer content than this server, and what changed (asked for with the page's button, never on
/// its own; a recent answer is shown again, see <see cref="ContentSync.CheckAsync"/>). It only reads.
/// </summary>
public sealed class CheckContentEndpoint : EndpointWithoutRequest<ContentCheckResponse>
{
    private readonly ContentSync _sync;

    public CheckContentEndpoint(ContentSync sync)
    {
        _sync = sync;
    }

    public override void Configure()
    {
        Get("admin/content-sources/check");
        AllowAnonymous();
    }

    public override async Task HandleAsync(CancellationToken ct) =>
        await Send.OkAsync(await _sync.CheckAsync(Query<bool>("force", isRequired: false), ct), ct);
}
