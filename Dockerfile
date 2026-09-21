FROM node:24-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && mkdir -p /app/data /app/docs/proof && chown -R node:node /app/data /app/docs
COPY --chown=node:node src ./src
COPY --chown=node:node migrations ./migrations
COPY --chown=node:node public ./public
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node evals ./evals
COPY --chown=node:node corpus ./corpus
USER node
ENV HOST=0.0.0.0 DATA_DIR=/app/data
EXPOSE 3200
CMD ["node", "src/server.js"]
