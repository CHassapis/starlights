using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Starlights.Modules.Elements.Integration;
using Starlights.Modules.Elements.Services;
using Starlights.Modules.Elements.Services.FiveETools;
using Starlights.Platform.Eventing.EventPublisher;
using Starlights.Platform.Hosting;

namespace Starlights.Modules.Elements;

public sealed class ElementsModule : IPlatformModule
{
    public void ConfigureServices(IHostApplicationBuilder builder)
    {
        builder.Services.AddScoped<IElementsModuleQueries, ElementsModuleQueries>();
        builder.Services.AddScoped<IElementsModuleInitializer, ElementsModuleInitializer>();
        builder.Services.AddSingleton(new ElementsInitializerOptions(
            IncludeSampleContent: !string.Equals(builder.Configuration["Elements:SampleContent"], "false", StringComparison.OrdinalIgnoreCase)));

        builder.Services.AddScoped<IAuroraImporter, AuroraImporter>();
        builder.Services.AddSingleton(new AuroraImporterOptions(
            builder.Configuration["Aurora:ContentPath"] ?? "/data/aurora-elements",
            builder.Configuration["Aurora:Exclude"]?.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries),
            builder.Configuration["Aurora:HomebrewPath"] ?? "/data/homebrew"));

        builder.Services.AddSingleton<IItemCatalog, Services.Items.ItemCatalog>();
        builder.Services.AddSingleton<ISpellIndex, Services.Spells.SpellIndex>();

        builder.Services.AddSingleton(new FiveEToolsOptions(builder.Configuration["FiveETools:Path"] ?? "/data/5etools"));
        builder.Services.AddSingleton<FiveEToolsData>();
        builder.Services.AddSingleton<IFiveEToolsLore>(sp => sp.GetRequiredService<FiveEToolsData>());

        builder.Services.AddDomainEventHandlersFrom(typeof(ElementsModule).Assembly);
    }
}
