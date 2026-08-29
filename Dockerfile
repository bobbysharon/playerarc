# Runs the full PlayerArc platform: API, database and web app in one container.
FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY web/package.json ./web/

# better-sqlite3 ships prebuilt binaries for linux-x64 inside its package, but
# npm still triggers a node-gyp rebuild because the package contains a
# binding.gyp. Skipping install scripts uses the shipped binary and avoids
# needing a C++ toolchain in the image.
RUN npm ci --ignore-scripts

COPY . .
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app ./

# The database and uploads live on a volume so they survive a redeploy.
VOLUME ["/app/server/data", "/app/server/uploads"]

EXPOSE 4000

# Creates the schema on first run, then starts the server.
# To seed the demonstration club as well, run `npm run db:seed` once.
CMD ["sh", "-c", "node server/src/db/migrate.js && node server/src/index.js"]
