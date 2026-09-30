# Static build of the builder app, served by nginx which also proxies /api/ to the backend.
FROM node:22-slim AS build
WORKDIR /src
COPY src/frontend/ ./
RUN npm ci
# empty = call the API on the same origin the page was served from
ENV VITE_API_BASE=""
RUN npm run build:packages && npm run build -w apps/builder-app

FROM nginx:alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/apps/builder-app/dist /usr/share/nginx/html
