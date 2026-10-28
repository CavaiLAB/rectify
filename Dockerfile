FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-bookworm-slim
ARG APP_REVISION=development
LABEL org.opencontainers.image.source="https://github.com/CavaiLAB/rectify" \
      org.opencontainers.image.revision="${APP_REVISION}"
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3188 DATA_DIR=/app/data
ENV APP_REVISION=${APP_REVISION}
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && mkdir -p /app/data && chown node:node /app/data
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node server ./server
COPY --chown=node:node shared ./shared
COPY --chown=node:node scripts/create-user.ts ./scripts/create-user.ts
USER node
EXPOSE 3188
VOLUME ["/app/data"]
CMD ["npm", "start"]
