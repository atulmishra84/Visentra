FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY server.js ./
COPY index.html ./
COPY src ./src
COPY sql ./sql
COPY scripts ./scripts

ENV NODE_ENV=production
EXPOSE 3000

CMD ["sh", "-c", "node scripts/migrate.js && node server.js"]
