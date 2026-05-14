FROM node:20-alpine
WORKDIR /app
RUN addgroup -g 1001 appgroup && adduser -u 1001 -G appgroup -s /bin/sh -D appuser
COPY package.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --chown=appuser:appgroup . .
USER 1001
EXPOSE 4002
ENV NODE_ENV=production PORT=4002
HEALTHCHECK --interval=15s --timeout=5s CMD wget -qO- http://localhost:4002/health || exit 1
CMD ["node", "webhook.js"]
