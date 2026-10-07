# Builds the API and both EF Core migration workers into one image.
# docker-compose picks which one to run via working_dir + entrypoint.
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY global.json nuget.config Directory.Build.props Directory.Build.targets Directory.Packages.props ./
COPY src/ src/
# NuGet packages live in a cache mount shared by every build, not in this layer,
# so a code change no longer leaves another ~800 MB copy in the build cache.
RUN --mount=type=cache,id=starlights-nuget,target=/root/.nuget/packages \
    dotnet publish src/apps/Starlights.Application/Starlights.Application.csproj -c Release -o /out/api \
 && dotnet publish src/modules/elements/Modules.Elements.Data.EntityFramework.MigrationService/Modules.Elements.Data.EntityFramework.MigrationService.csproj -c Release -o /out/migrate-elements \
 && dotnet publish src/modules/characters/Modules.Characters.Data.EntityFramework.MigrationService/Modules.Characters.Data.EntityFramework.MigrationService.csproj -c Release -o /out/migrate-characters

# Node, for the Compendium of Lore's builder (the self-hosting kit's Content page runs it inside the API)
FROM node:22-slim AS node

FROM mcr.microsoft.com/dotnet/aspnet:10.0
COPY --from=build /out/ /app/
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY src/frontend/apps/builder-app/lore-ingest/ /app/lore-ingest/lore-ingest/
COPY src/frontend/apps/builder-app/src/lib/lore/categories.ts src/frontend/apps/builder-app/src/lib/lore/keys.ts src/frontend/apps/builder-app/src/lib/lore/monster-text.ts src/frontend/apps/builder-app/src/lib/lore/spell-text.ts src/frontend/apps/builder-app/src/lib/lore/tags.ts src/frontend/apps/builder-app/src/lib/lore/types.ts /app/lore-ingest/src/lib/lore/
RUN rm -f /app/lore-ingest/lore-ingest/*.test.ts && echo '{"type":"module"}' > /app/lore-ingest/package.json
ENV ASPNETCORE_HTTP_PORTS=8080
USER app
WORKDIR /app/api
ENTRYPOINT ["dotnet", "Starlights.Application.dll"]
