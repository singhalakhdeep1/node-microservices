# syntax=docker/dockerfile:1
# Build context is the repository root (npm workspaces):
#   docker build -f frontend/Dockerfile --build-arg NEXT_PUBLIC_API_URL=http://localhost -t nms/frontend .
FROM node:22-alpine AS build
WORKDIR /app
ARG NEXT_PUBLIC_API_URL=http://localhost
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json tsconfig.base.json ./
COPY services/shared/package.json services/shared/
COPY services/user-service/package.json services/user-service/
COPY services/product-service/package.json services/product-service/
COPY services/order-service/package.json services/order-service/
COPY services/notification-service/package.json services/notification-service/
COPY api-gateway/package.json api-gateway/
COPY frontend/package.json frontend/
RUN npm ci --workspace frontend --include-workspace-root
COPY frontend frontend
RUN npm run build -w frontend

FROM node:22-alpine
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3005 HOSTNAME=0.0.0.0
WORKDIR /app
# Monorepo standalone output keeps the workspace layout: server.js lives in frontend/.
COPY --from=build /app/frontend/.next/standalone ./
COPY --from=build /app/frontend/.next/static ./frontend/.next/static
USER node
EXPOSE 3005
CMD ["node", "frontend/server.js"]
