# syntax=docker/dockerfile:1
# Build context is the repository root (npm workspaces):
#   docker build -f services/product-service/Dockerfile -t nms/product-service .
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY services/shared/package.json services/shared/
COPY services/user-service/package.json services/user-service/
COPY services/product-service/package.json services/product-service/
COPY services/order-service/package.json services/order-service/
COPY services/notification-service/package.json services/notification-service/
COPY api-gateway/package.json api-gateway/
COPY frontend/package.json frontend/
RUN npm ci --workspace @nms/shared --workspace product-service --include-workspace-root
COPY services/shared services/shared
COPY services/product-service services/product-service
RUN npm run build -w @nms/shared && npm run build -w product-service  && npm prune --omit=dev --workspace @nms/shared --workspace product-service

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/services/shared/package.json ./services/shared/package.json
COPY --from=build /app/services/shared/dist ./services/shared/dist
COPY --from=build /app/services/product-service/package.json ./services/product-service/package.json
COPY --from=build /app/services/product-service/dist ./services/product-service/dist
USER node
EXPOSE 3002
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s CMD wget -qO- http://127.0.0.1:3002/health || exit 1
CMD ["node", "services/product-service/dist/server.js"]
