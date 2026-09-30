using Microsoft.Extensions.Configuration;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using FastEndpoints;
using Starlights.Modules.Characters.Data;
using Starlights.Modules.Characters.Domain.Appearances;
using Starlights.Modules.Characters.Domain.Characters;
using Starlights.Platform.Data;

namespace Starlights.Modules.Characters.Endpoints.Characters.Portraits;

/// <summary>
/// Uploaded portraits live in a folder (Portraits:Path, default /data/portraits) under random names and are
/// served from /api/portraits/{file}.
/// </summary>
internal static partial class PortraitFiles
{
    public const string UrlPrefix = "/api/portraits/";
    public const int MaxBytes = 3 * 1024 * 1024;

    public static string Folder(IConfiguration config) => config["Portraits:Path"] ?? "/data/portraits";

    [GeneratedRegex("^[0-9a-f]{32}\\.(jpg|png|webp)$")]
    public static partial Regex FileName();

    /// <summary>
    /// The image type from the file's first bytes (not what the client claims), or null for anything else.
    /// </summary>
    public static string? Extension(ReadOnlySpan<byte> data) => data switch
    {
        [0xFF, 0xD8, 0xFF, ..] => "jpg",
        [0x89, 0x50, 0x4E, 0x47, ..] => "png",
        [0x52, 0x49, 0x46, 0x46, _, _, _, _, 0x57, 0x45, 0x42, 0x50, ..] => "webp",
        _ => null,
    };

    public static void DeleteUploaded(IConfiguration config, string? portraitUrl)
    {
        if (portraitUrl?.StartsWith(UrlPrefix, StringComparison.Ordinal) != true)
        {
            return;
        }

        var name = portraitUrl[UrlPrefix.Length..];
        if (FileName().IsMatch(name))
        {
            File.Delete(Path.Combine(Folder(config), name));
        }
    }
}

public sealed record UploadPortraitRequest
{
    /// <summary>The image as a data URL (data:image/jpeg;base64,…) or plain base64.</summary>
    public string Data { get; init; } = string.Empty;
}

public sealed record UploadPortraitResponse(string PortraitUrl);

/// <summary>
/// Sets a character's portrait from an uploaded image (JPEG, PNG or WebP, at most 3 MB; the app shrinks it first).
/// </summary>
public sealed class UploadPortraitEndpoint : Endpoint<UploadPortraitRequest, UploadPortraitResponse>
{
    private readonly IPersistence _persistence;

    public UploadPortraitEndpoint(IPersistence persistence)
    {
        _persistence = persistence;
    }

    public override void Configure()
    {
        Post("{characterId:guid}/portrait");
        Group<CharactersGroup>();
        AllowAnonymous();
    }

    public override async Task HandleAsync(UploadPortraitRequest req, CancellationToken ct)
    {
        var character = await _persistence.GetRepository<ICharactersRepository>().GetCharacterAsync(new CharacterId(Route<Guid>("characterId")));
        if (character is null)
        {
            await Send.NotFoundAsync(ct);
            return;
        }

        var base64 = req.Data.Contains(',') ? req.Data[(req.Data.IndexOf(',') + 1)..] : req.Data;
        var bytes = new byte[base64.Length * 3 / 4 + 3];
        if (!Convert.TryFromBase64String(base64.Trim(), bytes, out var length) || length == 0 || length > PortraitFiles.MaxBytes)
        {
            AddError(r => r.Data, "The portrait must be an image of at most 3 MB.");
            await Send.ErrorsAsync(cancellation: ct);
            return;
        }

        var extension = PortraitFiles.Extension(bytes.AsSpan(0, length));
        if (extension is null)
        {
            AddError(r => r.Data, "The portrait must be a JPEG, PNG or WebP image.");
            await Send.ErrorsAsync(cancellation: ct);
            return;
        }

        var folder = PortraitFiles.Folder(Config);
        Directory.CreateDirectory(folder);
        var name = $"{Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(16))}.{extension}";
        await File.WriteAllBytesAsync(Path.Combine(folder, name), bytes.AsMemory(0, length), ct);

        var appearance = character.GetRequiredComponent<AppearanceComponent>();
        var previous = appearance.PortraitUrl;
        var url = PortraitFiles.UrlPrefix + name;
        character.UpdateComponent<AppearanceComponent>((a, _) => a.PortraitUrl = url);
        await _persistence.SaveChangesAsync();

        PortraitFiles.DeleteUploaded(Config, previous);
        await Send.OkAsync(new UploadPortraitResponse(url), ct);
    }
}

/// <summary>
/// Removes a character's portrait.
/// </summary>
public sealed class DeletePortraitEndpoint : EndpointWithoutRequest
{
    private readonly IPersistence _persistence;

    public DeletePortraitEndpoint(IPersistence persistence)
    {
        _persistence = persistence;
    }

    public override void Configure()
    {
        Delete("{characterId:guid}/portrait");
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

        var previous = character.GetRequiredComponent<AppearanceComponent>().PortraitUrl;
        character.UpdateComponent<AppearanceComponent>((a, _) => a.PortraitUrl = null);
        await _persistence.SaveChangesAsync();

        PortraitFiles.DeleteUploaded(Config, previous);
        await Send.NoContentAsync(ct);
    }
}

/// <summary>
/// Serves an uploaded portrait. Names are random, so a file never changes and can be cached for good.
/// </summary>
public sealed class GetPortraitEndpoint : EndpointWithoutRequest
{
    public override void Configure()
    {
        Get("portraits/{file}");
        AllowAnonymous();
    }

    public override async Task HandleAsync(CancellationToken ct)
    {
        var name = Route<string>("file") ?? string.Empty;
        var path = Path.Combine(PortraitFiles.Folder(Config), name);
        if (!PortraitFiles.FileName().IsMatch(name) || !File.Exists(path))
        {
            await Send.NotFoundAsync(ct);
            return;
        }

        var contentType = Path.GetExtension(name) switch { ".png" => "image/png", ".webp" => "image/webp", _ => "image/jpeg" };
        HttpContext.Response.Headers.CacheControl = "public, max-age=31536000, immutable";
        await Send.FileAsync(new FileInfo(path), contentType, cancellation: ct);
    }
}
