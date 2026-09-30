using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Starlights.Modules.Characters.Services.Players;
using Scalar.AspNetCore;
using Starlights.Modules.Characters.Data.EntityFramework;
using Starlights.Modules.Characters.Data.EntityFramework.EventProcessing;
using Starlights.Modules.Characters.Endpoints.Characters.CreateCharacter;
using Starlights.Modules.Characters.Services.Processing;
using Starlights.Modules.Elements;
using Starlights.Modules.Elements.Data.EntityFramework;
using Starlights.Modules.Elements.Data.EntityFramework.EventProcessing;
using Starlights.Modules.Elements.Endpoints.Installation;
using Starlights.Platform.Components.FastEndpoints;
using Starlights.Platform.Components.Serilog;
using Starlights.Platform.Eventing.EventPublisher;
using Starlights.Platform.Hosting;

namespace Starlights.Application;

public sealed partial class Program
{
    [GeneratedRegex("^/api/characters/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})(/|$)")]
    private static partial Regex LockedCharacterRoute();

    public static void Main(string[] args)
    {
        var builder = WebApplication.CreateBuilder(args);
        builder.AddServiceDefaults();

        builder.Services.AddAuthorization();
        builder.Services.AddOpenApi();

        builder.Services.AddCors(options =>
        {
            options.AddDefaultPolicy(builder =>
            {
                builder
                    .SetIsOriginAllowed(_ =>
                    {
                        // Allow all origins for development purposes
                        return true;
                    })
                    .AllowAnyHeader()
                    .AllowCredentials()
                    .AllowAnyMethod();
            });
        });

        // add the platform services and its modules
        builder.AddStarlightsPlatform(options =>
        {
            // characters module
            options.AdditionalAssemblies.Add(typeof(CharactersContext).Assembly);
            options.AdditionalAssemblies.Add(typeof(CreateCharacterEndpoint).Assembly);
            options.AdditionalAssemblies.Add(typeof(RegistrationProcessor).Assembly);
            options.AddEventProcessingComponent();

            // elements module
            options.AdditionalAssemblies.Add(typeof(ElementsModule).Assembly);
            options.AdditionalAssemblies.Add(typeof(ElementsContext).Assembly);
            options.AdditionalAssemblies.Add(typeof(InitializationEndpoint).Assembly);
            options.AddElementsEventProcessingComponent();

            // platform components
            options.AddFastEndpointsComponent();
            options.AddSerilogComponent();
            options.AdditionalAssemblies.Add(typeof(EventPublisherComponent).Assembly);
        });

        var app = builder.Build();

        app.MapDefaultEndpoints();

        if (app.Environment.IsDevelopment())
        {
            app.MapOpenApi();
            app.MapScalarApiReference(options =>
            {
                options.Servers = [];

                options.WithTitle("Starlights API")
                    .HideClientButton()
                    .WithClassicLayout()
                    .WithTheme(ScalarTheme.Alternate)
                    .EnableDarkMode()
                    .HideModels()
                    .WithDefaultHttpClient(ScalarTarget.JavaScript, ScalarClient.Fetch);
            });
        }

        // content administration (initialize, the Aurora import, creating/editing/deleting elements) needs the
        // admin key; players only ever read elements. There are no accounts, so without this any player could
        // wipe the content. With no key configured these requests are refused.
        var adminKey = Encoding.UTF8.GetBytes(app.Configuration["Admin:Key"] ?? string.Empty);
        app.Use(async (context, next) =>
        {
            var path = context.Request.Path;
            var needsAdmin = path.StartsWithSegments("/api/elements") &&
                (!HttpMethods.IsGet(context.Request.Method) || path.StartsWithSegments("/api/elements/initialize")) &&
                !path.StartsWithSegments("/api/elements/aurora-lookup"); // read-only, POST only for the id list

            var given = Encoding.UTF8.GetBytes(context.Request.Headers["X-Admin-Key"].ToString());
            if (needsAdmin && (adminKey.Length == 0 || !CryptographicOperations.FixedTimeEquals(given, adminKey)))
            {
                context.Response.StatusCode = StatusCodes.Status403Forbidden;
                await context.Response.WriteAsync("This needs the admin key (X-Admin-Key header).");
                return;
            }

            await next();
        });

        // everything under /api/characters/{id} of a password-locked player needs that player's unlock token
        // (lists and creation check it in their endpoints)
        app.Use(async (context, next) =>
        {
            var match = LockedCharacterRoute().Match(context.Request.Path.Value ?? string.Empty);
            if (match.Success)
            {
                var access = context.RequestServices.GetRequiredService<PlayerAccess>();
                var player = await access.GetCharacterPlayerAsync(Guid.Parse(match.Groups[1].Value));
                if (!string.IsNullOrEmpty(player) && await access.IsLockedAsync(player) &&
                    !access.HasToken(context.Request.Headers[PlayerAccess.TokenHeader], player))
                {
                    context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                    await context.Response.WriteAsJsonAsync(new { locked = player });
                    return;
                }
            }

            await next();
        });

        // configure the platform and its modules
        app.UseStarlightsPlatform();
        app.UseCors();

        app.UseHttpsRedirection();
        app.UseAuthorization();

        app.Run();
    }
}
