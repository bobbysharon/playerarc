# Runs the full PlayerArc platform: API, database and web app in one container.
FROM node:20-bookworm-slim AS build

WORKDIR /app
COPY package*.json ./
COPY server/package*.json ./server/
COPY web/package*.json ./web/
RUN npm install

COPY . .
RUN npm run build

FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app ./

# The database and uploads live on a volume so they survive a redeploy.
VOLUME ["/app/server/data", "/app/server/uploads"]

EXPOSE 4000

# Creates the schema and seeds on first run, then starts the server.
CMD ["sh", "-c", "node server/src/db/migrate.js && node server/src/index.js"]
