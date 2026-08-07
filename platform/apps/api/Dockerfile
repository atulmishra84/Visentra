FROM node:20-alpine
WORKDIR /app
RUN addgroup -S agentradar && adduser -S agentradar -G agentradar \
  && apk add --no-cache wget
COPY package.json ./
RUN npm install --omit=dev
COPY src ./src
COPY schemas ./schemas
ENV NODE_ENV=production
USER agentradar
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD wget -qO- http://127.0.0.1:8080/ready || exit 1
CMD ["npm", "start"]
