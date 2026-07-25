# ── FMS API image ───────────────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

# Install production deps first (better layer caching).
COPY package*.json ./
RUN npm ci --omit=dev

# App source.
COPY src ./src
COPY .env.example ./.env.example

ENV NODE_ENV=production
EXPOSE 5000

# Seed is idempotent — it creates the admin + 8 parameters only if missing, then
# the server starts. (seed || true) guarantees the server still boots if seeding
# is skipped/fails.
CMD ["sh", "-c", "node src/seed.js || true; node src/server.js"]
