using FastEndpoints;
using Starlights.Modules.Characters.Services.Players;

namespace Starlights.Modules.Characters.Endpoints.Characters.Players;

public sealed record AdminUnlockRequest
{
    public string Password { get; init; } = string.Empty;
}

public sealed record AdminUnlockResponse(string Token);

/// <summary>
/// The master admin password (Admin:MasterPassword): returns a token that opens every locked player and
/// campaign and allows content changes (homebrew, imports) from the site.
/// </summary>
public sealed class AdminUnlockEndpoint : Endpoint<AdminUnlockRequest, AdminUnlockResponse>
{
    private readonly PlayerAccess _access;

    public AdminUnlockEndpoint(PlayerAccess access)
    {
        _access = access;
    }

    public override void Configure()
    {
        Post("admin/unlock");
        AllowAnonymous();
    }

    public override async Task HandleAsync(AdminUnlockRequest req, CancellationToken ct)
    {
        var token = _access.UnlockAdmin(req.Password);
        if (token is null)
        {
            await Task.Delay(1000, ct);
            await Send.UnauthorizedAsync(ct);
            return;
        }

        await Send.OkAsync(new AdminUnlockResponse(token), ct);
    }
}
