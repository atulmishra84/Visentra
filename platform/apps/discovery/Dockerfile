FROM node:20-alpine
WORKDIR /app
RUN addgroup -S agentradar && adduser -S agentradar -G agentradar
COPY package.json ./
RUN npm install --omit=dev
COPY src ./src
ENV NODE_ENV=production
USER agentradar
CMD ["node", "src/index.js"]
