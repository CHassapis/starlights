using System.Text.Json;
using FastEndpoints;
using Microsoft.AspNetCore.Http;
using Starlights.Modules.Characters.Data;
using Starlights.Modules.Characters.Domain.Campaigns;
using Starlights.Modules.Characters.Services.Campaigns;
using Starlights.Modules.Characters.Services.Players;
using Starlights.Platform.Data;

namespace Starlights.Modules.Characters.Endpoints.Campaigns;

/// <summary>A note: "private" (only its author), "party" (everyone in the campaign) or "dm" (the DM's notebook).</summary>
public sealed record SaveNoteRequest(string? Title, string? Body, string? Scope);

/// <summary>
/// Notes in a campaign: anyone who can open the campaign keeps their own (as the player named in X-Player-Name, who
/// must be unlocked or proved by token) or writes to the party; the DM keeps a notebook. The DM cannot read
/// players' private notes.
/// </summary>
internal static class CampaignNotes
{
    public static readonly string[] Scopes = ["private", "party", "dm"];

    /// <summary>Who writes as what: the DM's notebook needs the DM; other notes a verified player. Null: not allowed.</summary>
    public static async Task<string?> Author(HttpContext context, PlayerAccess access, Campaign campaign, string scope)
    {
        if (scope == "dm")
        {
            return CampaignAccess.IsDm(context, access, campaign.Id) ? "DM" : null;
        }
        if (!CampaignAccess.CanOpen(context, access, campaign) && !CampaignAccess.IsDm(context, access, campaign.Id))
        {
            return null;
        }
        return await CampaignAccess.VerifiedPlayer(context, access);
    }

    public static string? Problem(SaveNoteRequest req) =>
        !Scopes.Contains(req.Scope) ? "A note is private, for the party, or the DM's."
        : (req.Title?.Trim().Length ?? 0) > 200 ? "A note's title has at most 200 characters."
        : (req.Body?.Length ?? 0) > 50_000 ? "A note has at most 50,000 characters."
        : string.IsNullOrWhiteSpace(req.Body) && string.IsNullOrWhiteSpace(req.Title) ? "The note is empty."
        : null;

    public static string Data(string scope, string author) => JsonSerializer.Serialize(new { scope, author });
}

public sealed class CreateCampaignNoteEndpoint : Endpoint<SaveNoteRequest, CampaignEntryModel>
{
    private readonly IPersistence _persistence;
    private readonly PlayerAccess _access;

    public CreateCampaignNoteEndpoint(IPersistence persistence, PlayerAccess access)
    {
        _persistence = persistence;
        _access = access;
    }

    public override void Configure()
    {
        Post("{campaignId:guid}/notes");
        Group<CampaignsGroup>();
        AllowAnonymous();
    }

    public override async Task HandleAsync(SaveNoteRequest req, CancellationToken ct)
    {
        var campaigns = _persistence.GetRepository<ICampaignsRepository>();
        var campaign = await campaigns.GetCampaignAsync(Route<Guid>("campaignId"));
        if (campaign is null)
        {
            await Send.NotFoundAsync(ct);
            return;
        }
        if (CampaignNotes.Problem(req) is { } problem)
        {
            AddError(problem);
            await Send.ErrorsAsync(cancellation: ct);
            return;
        }
        if (await CampaignNotes.Author(HttpContext, _access, campaign, req.Scope!) is not { } author)
        {
            await Send.ForbiddenAsync(ct);
            return;
        }
        var note = CampaignEntry.Create(campaign.Id, CampaignEntry.Note);
        note.Update(string.IsNullOrWhiteSpace(req.Title) ? "Note" : req.Title, null, DateTime.UtcNow.ToString("yyyy-MM-dd"), req.Scope == "party", req.Body ?? string.Empty, string.Empty, null, CampaignNotes.Data(req.Scope!, author), 0);
        campaigns.Add(note);
        await _persistence.SaveChangesAsync();
        await Send.OkAsync(CampaignView.Entry(note, dm: false), ct);
    }
}

public sealed class UpdateCampaignNoteEndpoint : Endpoint<SaveNoteRequest, CampaignEntryModel>
{
    private readonly IPersistence _persistence;
    private readonly PlayerAccess _access;

    public UpdateCampaignNoteEndpoint(IPersistence persistence, PlayerAccess access)
    {
        _persistence = persistence;
        _access = access;
    }

    public override void Configure()
    {
        Put("{campaignId:guid}/notes/{entryId:guid}");
        Group<CampaignsGroup>();
        AllowAnonymous();
    }

    public override async Task HandleAsync(SaveNoteRequest req, CancellationToken ct)
    {
        var campaigns = _persistence.GetRepository<ICampaignsRepository>();
        var campaign = await campaigns.GetCampaignAsync(Route<Guid>("campaignId"));
        var note = campaign is null ? null : await campaigns.GetEntryAsync(campaign.Id, Route<Guid>("entryId"));
        if (campaign is null || note is null || note.Kind != CampaignEntry.Note)
        {
            await Send.NotFoundAsync(ct);
            return;
        }
        if (CampaignNotes.Problem(req) is { } problem)
        {
            AddError(problem);
            await Send.ErrorsAsync(cancellation: ct);
            return;
        }
        // only its author changes a note (the DM's notebook: the DM); a player's note stays a player's
        var (scope, author) = CampaignView.NoteOf(note);
        var me = await CampaignNotes.Author(HttpContext, _access, campaign, scope);
        if (me is null || !string.Equals(me, author, StringComparison.OrdinalIgnoreCase) || (scope == "dm") != (req.Scope == "dm"))
        {
            await Send.ForbiddenAsync(ct);
            return;
        }
        note.Update(string.IsNullOrWhiteSpace(req.Title) ? "Note" : req.Title, null, note.OccurredOn, req.Scope == "party", req.Body ?? string.Empty, string.Empty, null, CampaignNotes.Data(req.Scope!, author), note.Sort);
        await _persistence.SaveChangesAsync();
        await Send.OkAsync(CampaignView.Entry(note, dm: false), ct);
    }
}

public sealed class DeleteCampaignNoteEndpoint : EndpointWithoutRequest
{
    private readonly IPersistence _persistence;
    private readonly PlayerAccess _access;

    public DeleteCampaignNoteEndpoint(IPersistence persistence, PlayerAccess access)
    {
        _persistence = persistence;
        _access = access;
    }

    public override void Configure()
    {
        Delete("{campaignId:guid}/notes/{entryId:guid}");
        Group<CampaignsGroup>();
        AllowAnonymous();
    }

    public override async Task HandleAsync(CancellationToken ct)
    {
        var campaigns = _persistence.GetRepository<ICampaignsRepository>();
        var campaign = await campaigns.GetCampaignAsync(Route<Guid>("campaignId"));
        var note = campaign is null ? null : await campaigns.GetEntryAsync(campaign.Id, Route<Guid>("entryId"));
        if (campaign is null || note is null || note.Kind != CampaignEntry.Note)
        {
            await Send.NotFoundAsync(ct);
            return;
        }
        // its author, or the DM for anything but a player's private note
        var (scope, author) = CampaignView.NoteOf(note);
        var me = await CampaignNotes.Author(HttpContext, _access, campaign, scope);
        var mine = me is not null && string.Equals(me, author, StringComparison.OrdinalIgnoreCase);
        if (!mine && !(scope != "private" && CampaignAccess.IsDm(HttpContext, _access, campaign.Id)))
        {
            await Send.ForbiddenAsync(ct);
            return;
        }
        campaigns.Remove(note);
        await _persistence.SaveChangesAsync();
        await Send.NoContentAsync(ct);
    }
}
