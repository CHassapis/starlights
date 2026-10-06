# Static build of the builder app, served by nginx which also proxies /api/ to the backend.
FROM node:22-slim AS build
WORKDIR /src
# Package manifests first, so `npm ci` (~860 MB) is reused until a dependency changes.
# Copying all the source first made every edit leave another copy in the build cache.
COPY src/frontend/package.json src/frontend/package-lock.json ./
COPY src/frontend/packages/api-client/package.json packages/api-client/
COPY src/frontend/packages/ui/package.json packages/ui/
COPY src/frontend/packages/ui-framework/package.json packages/ui-framework/
COPY src/frontend/apps/landing-page/package.json apps/landing-page/
COPY src/frontend/apps/builder-app/package.json apps/builder-app/
COPY src/frontend/apps/content-manager/package.json apps/content-manager/
COPY src/frontend/apps/showcase/package.json apps/showcase/
RUN npm ci
COPY src/frontend/ ./
# empty = call the API on the same origin the page was served from
ENV VITE_API_BASE=""
RUN npm run build:packages && npm run build -w apps/builder-app

FROM nginx:alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/apps/builder-app/dist /usr/share/nginx/html
