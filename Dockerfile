# Harbor — multi-stage production image (Node 22+ for node:sqlite)
FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY web/package.json ./web/

RUN npm ci --cache ./.npm-cache

COPY tsconfig.base.json ./
COPY server ./server
COPY web ./web

RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV HARBOR_HOSTED=1
ENV HARBOR_BITCOIN=mock
ENV HARBOR_SERVE_WEB=1
ENV HARBOR_DB_PATH=/tmp/harbor/harbor.db
ENV PORT=3001
ENV HOST=0.0.0.0

COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY web/package.json ./web/
RUN npm ci --omit=dev --cache ./.npm-cache && npm cache clean --force

COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/web/dist ./web/dist

EXPOSE 3001
CMD ["node", "server/dist/index.js"]
