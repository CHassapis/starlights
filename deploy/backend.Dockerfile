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

FROM mcr.microsoft.com/dotnet/aspnet:10.0
COPY --from=build /out/ /app/
ENV ASPNETCORE_HTTP_PORTS=8080
USER app
WORKDIR /app/api
ENTRYPOINT ["dotnet", "Starlights.Application.dll"]
