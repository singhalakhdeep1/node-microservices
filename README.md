# Node Microservices

An e-commerce backend split into TypeScript microservices behind an API gateway. A Next.js storefront and admin console sit on top. Services talk over HTTP (through circuit breakers) and RabbitMQ events. Service discovery uses Consul, tracing uses Zipkin, logs ship to Fluentd, avatars are stored in SeaweedFS, and Traefik is the edge router.

```
                    Traefik :80  (edge: /api -> gateway, / -> frontend)
                         │
     frontend :3005 ── api-gateway :3000  JWT auth · token-bucket rate limits · circuit breakers
                         │                 service discovery (Consul / static) · proxy · B3 tracing
     ┌───────────────┬───┴──────────┬────────────────────┐
user-service    product-service  order-service      notification-service
 :3001           :3002            :3003              :3004
 auth, profile,  catalog, cache,  create-order saga  RabbitMQ consumers,
 avatars ─► SeaweedFS  stock reserve/release  idempotency, status flow  email + inbox
     │               │                │                    ▲
     └── MongoDB (database per service) · Redis cache ─────┘
                 RabbitMQ topic exchange `microservices.events` (+ DLX)
     Consul (registry + health)   Zipkin (traces)   Fluentd (logs)   Prometheus (/metrics)
```

## Services

| Service | Port | Responsibilities |
|---|---|---|
| `api-gateway` | 3000 | Route table and proxy, JWT verification (verified identity forwarded with a shared secret), per-route token buckets plus a global IP limit, a circuit breaker per service, discovery via Consul or static URLs, aggregated `/health`, admin views `/api/gateway/status` and `/api/gateway/edge` (Traefik) |
| `user-service` | 3001 | Register, login, profile, avatars (SeaweedFS), admin user list and roles, Redis cache-aside, `user.*` events, `/internal/users/:id` |
| `product-service` | 3002 | Catalog CRUD (admin), text search, filters, sort, pagination, cached lists and categories, `/internal/products/{lookup,reserve,release}` for the saga, `product.*` and `product.stock_low` events |
| `order-service` | 3003 | Create-order saga, `Idempotency-Key`, cancellation with stock release, admin status flow (pending → confirmed → shipped → delivered), stats, `order.*` events |
| `notification-service` | 3004 | Consumes `user.registered`, `order.*` and `product.stock_low`. Sends email (SMTP; without `EMAIL_HOST` the mail is rendered but not delivered). Per-user inbox (`/api/notifications`), deduplicated per event |
| `frontend` | 3005 | Next.js 14 (TSX): catalog, cart, checkout, orders with saga log, profile (avatar, inbox), admin (products, orders, users, system health, breakers and registry) |

Shared code lives in `services/shared` (`@nms/shared`): the service bootstrap, the HLD patterns (API gateway, service discovery, message broker, circuit breaker; see [NODE_MICROSERVICES_HLD_LLD.md](NODE_MICROSERVICES_HLD_LLD.md)), plus the Consul, Zipkin and Fluentd clients, Redis cache, metrics and auth. Integration details are in [NODE_MICROSERVICES_IMPLEMENTATION.md](NODE_MICROSERVICES_IMPLEMENTATION.md).

### Create-order saga

`POST /api/orders` runs these steps:
1. Verify the buyer (user-service).
2. Price the items (product-service).
3. Save the order as `pending`.
4. Reserve stock. Each item gets an atomic `stock >= qty` decrement. If any item fails, the earlier ones are compensated and the call returns 409. Reservations are idempotent per order.
5. Mark the order `confirmed` and publish `order.created`.

If reservation fails, the order is saved as `failed` with the reason, and a compensating release runs if the product-service timed out. Cancelling an order (owner, or admin via status) also releases its stock. Each step is recorded in `order.saga`.

## API (through the gateway)

| Method | Path | Auth |
|---|---|---|
| POST | `/api/users/register`, `/api/users/login` | public (10 and 20 per minute) |
| GET/PATCH | `/api/users/me` | user |
| POST | `/api/users/me/avatar` (multipart `avatar`) | user |
| GET | `/api/users/:id/avatar` | public |
| GET | `/api/users/:id` | self or admin |
| GET | `/api/users` | admin |
| PATCH | `/api/users/:id/role` | admin |
| GET | `/api/products?search=&category=&minPrice=&maxPrice=&inStock=&sort=price_asc\|price_desc\|name&page=&limit=` | public |
| GET | `/api/products/categories`, `/api/products/:id` | public |
| POST/PUT/DELETE | `/api/products[/:id]` | admin |
| GET | `/api/orders` (`?all=true` for admin, `?status=`) | user |
| GET | `/api/orders/:id` | user |
| POST | `/api/orders` (header `Idempotency-Key`) | user |
| POST | `/api/orders/:id/cancel` | owner or admin |
| PUT | `/api/orders/:id/status` | admin |
| GET | `/api/orders/stats` | admin |
| GET | `/api/notifications` | user |
| PATCH | `/api/notifications/:id/read` | user |
| POST | `/api/notifications/read-all` | user |
| GET | `/health`, `/api`, `/metrics` | public |
| GET | `/api/gateway/status`, `/api/gateway/edge` | admin |

Errors are `{ "success": false, "error": "...", "details"?: {...} }`. Accounts whose email is in `ADMIN_EMAILS` get the admin role when they register.

## Run with Docker Compose

```bash
cp .env.example .env          # set JWT_SECRET, INTERNAL_API_TOKEN, GATEWAY_SHARED_SECRET, ADMIN_EMAILS
docker compose up --build
```

| URL | What |
|---|---|
| http://localhost | Storefront (through Traefik) |
| http://localhost:3000 | Gateway (direct) |
| http://localhost:8080 | Traefik dashboard |
| http://localhost:8500 | Consul |
| http://localhost:9411 | Zipkin |
| http://localhost:15672 | RabbitMQ (admin / password123) |
| http://localhost:9090 | Prometheus |

## Run locally (without Docker)

You need Node 20 or newer and MongoDB. Redis, RabbitMQ, Consul, Zipkin, Fluentd and SeaweedFS are optional; each is enabled by its environment variable (see `.env.example`).

```bash
npm install
npm run build                                  # shared + 4 services + gateway
export JWT_SECRET=dev INTERNAL_API_TOKEN=dev GATEWAY_SHARED_SECRET=dev ADMIN_EMAILS=admin@example.com
PORT=3001 MONGODB_URI=mongodb://localhost:27017/users    npm start -w user-service &
PORT=3002 MONGODB_URI=mongodb://localhost:27017/products npm start -w product-service &
PORT=3003 MONGODB_URI=mongodb://localhost:27017/orders   npm start -w order-service &
PORT=3004 MONGODB_URI=mongodb://localhost:27017/notifications npm start -w notification-service &
PORT=3000 npm start -w api-gateway &
npm run dev:frontend                           # http://localhost:3005
```

Use `npm run dev:<service>` (tsx watch) while developing. Without `RABBITMQ_URL`, each process uses an in-memory bus, so events (and therefore notifications) do not cross services.

## Kubernetes

```bash
kubectl apply -k k8s/     # namespace, config/secret, infra, deployments, HPA, Traefik ingress, network policy
```

Images are expected at `ghcr.io/singhalakhdeep1/node-microservices/<service>`; CI pushes them on every push to `main`. Edit `k8s/config.yml` (Secret) before deploying.

## CI

`.github/workflows/ci.yml` does the following:
1. Installs the workspaces.
2. Builds the backend.
3. Builds the frontend.
4. Typechecks everything.
5. Validates the compose file.
6. Builds all six Docker images, and pushes them to GHCR on `main`.

## Project layout

```
api-gateway/            gateway service (src/server.ts, src/traefik.ts)
services/shared/        @nms/shared: patterns + integrations
services/*-service/     user, product, order, notification
frontend/               Next.js storefront + admin
infra/                  traefik, fluentd, prometheus configs
k8s/                    manifests (kustomize)
```

## Verification

These were verified on the development machine against real MongoDB 6, Redis, SeaweedFS and a Consul 1.20 dev agent:
- 73 HTTP checks through the gateway, covering:
  - auth and forged-header rejection
  - cache hits and invalidation
  - avatars in SeaweedFS
  - the saga: success, 409 with no stock leak, idempotency replay, cancel and compensation
  - the status flow
  - Consul registration and discovery
  - rate limiting
  - metrics
  - the circuit breaker opening when product-service is stopped and recovering when it is restarted
- 20 browser checks of the frontend (Edge).

Zipkin and Fluentd were checked with local sinks: spans from all 5 services arrived, one trace covered gateway → order → user + product, and forward-protocol records arrived. Neither real server was run.

**Not run on that machine:**
- RabbitMQ: event delivery between services, and therefore real notifications.
- The Docker images and `docker compose up` (no Docker daemon).
- Traefik and the k8s manifests (YAML is validated only).
- SMTP delivery.

## License

Proprietary - All rights reserved.
