# ── Stage 1: install dependencies ────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts

# ── Stage 2: production image ─────────────────────────────
FROM node:20-alpine
WORKDIR /app

# Non-root user
RUN addgroup -g 1001 appgroup && \
    adduser  -u 1001 -G appgroup -s /bin/sh -D appuser

# Copy deps and source
COPY --from=deps /app/node_modules ./node_modules
COPY --chown=appuser:appgroup . .

USER 1001

EXPOSE 4000

ENV NODE_ENV=production \
    PORT=4000

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:4000/health || exit 1

CMD ["node", "server.js"]
