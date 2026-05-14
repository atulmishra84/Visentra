# ── Stage 1: build config ────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /build

# Accept the platform HTML filename as a build arg
ARG PLATFORM_HTML=agentRadarLaunch.html

# Copy the single-file platform
COPY ${PLATFORM_HTML} ./index.html

# ── Stage 2: Nginx production image ──────────────────────
FROM nginx:1.25-alpine

# Remove default config and content
RUN rm -rf /usr/share/nginx/html/* /etc/nginx/conf.d/*

# Copy the platform HTML as index.html
COPY --from=builder /build/index.html /usr/share/nginx/html/index.html

# Nginx config: SPA-friendly, security headers, health endpoint
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Run as non-root
RUN addgroup -g 1001 appgroup && \
    adduser  -u 1001 -G appgroup -s /bin/sh -D appuser && \
    chown -R appuser:appgroup /usr/share/nginx/html /var/cache/nginx /var/log/nginx && \
    touch /var/run/nginx.pid && chown appuser:appgroup /var/run/nginx.pid

USER 1001

EXPOSE 80

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:80/health || exit 1

CMD ["nginx", "-g", "daemon off;"]
