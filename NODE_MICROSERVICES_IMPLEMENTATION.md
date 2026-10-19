# Node Microservices - Implementation

## Overview
This document describes the microservices infrastructure integrations in Node Microservices, where each one lives, and how it is switched on. Every integration is optional at runtime: when its environment variable is unset the service runs without it. `docker-compose.yml` and `k8s/` turn all of them on.

## Technologies

### 1. Consul (service discovery)
- **Code:** `services/shared/src/consul/consul.ts` (HTTP agent API client), used by `services/shared/src/service.ts` and `services/shared/src/service-discovery/service-discovery.ts`.
- Every service registers itself on start (`<name>-<host>-<port>`) with an HTTP health check on `/health` (10s interval, deregistered after 1 minute critical) and deregisters on SIGTERM/SIGINT.
- The API gateway and order-service read passing instances from Consul (`/v1/health/service/<name>?passing=true`) into their registry and round-robin over them.
- Also implemented: key/value get/put/delete, sessions, and distributed locks (`acquireLock`/`releaseLock`).
- **Enable:** `CONSUL_HOST`, `CONSUL_PORT` (8500), optional `CONSUL_TOKEN`, and `SERVICE_ADDRESS` (the address other services reach this one on).

### 2. Zipkin (distributed tracing)
- **Code:** `services/shared/src/tracing/zipkin.ts`.
- Express middleware continues incoming B3 headers or starts a trace, records a SERVER span, and returns `x-trace-id`.
- `ServiceClient` (service-to-service HTTP) records CLIENT spans and forwards B3 headers. The gateway forwards B3 to the proxied service.
- RabbitMQ events carry the trace context. Publishing and consuming record PRODUCER/CONSUMER spans.
- Spans are batched every 2s to `POST <ZIPKIN_URL>/api/v2/spans` (Zipkin v2 JSON). Log lines include `traceId`.
- **Enable:** `ZIPKIN_URL`, optional `ZIPKIN_SAMPLE_RATE` (0-1) and `ZIPKIN_SERVICE_NAME`.

### 3. Fluentd (log shipping)
- **Code:** `services/shared/src/fluentd/fluentd.ts` (fluent-logger forward protocol), wired as a winston transport in `services/shared/src/logger.ts`.
- Every log line goes to Fluentd, and so do structured `http` events (method, path, status, duration) and `error` events with stack traces.
- Collector config: `infra/fluentd/fluent.conf`. It writes to stdout and daily files; swap the match for Elasticsearch or S3 in production.
- **Enable:** `FLUENTD_HOST`, `FLUENTD_PORT` (24224), `FLUENTD_TAG` (prefix, e.g. `nms`).

### 4. Traefik (edge router)
- **Config:** `infra/traefik/dynamic.yml` (file provider). Traefik serves port 80: `/api` and `/health` go to the API gateway (with a health check), and everything else goes to the frontend. It adds secure headers and compression middlewares and exposes Prometheus metrics on :8082. In k8s it is the ingress controller (`k8s/ingress.yml`).
- **Code:** `api-gateway/src/traefik.ts`, a Traefik API client (version, entrypoints, HTTP/TCP routers, services, middlewares). The gateway exposes the snapshot at `GET /api/gateway/edge` (admin only).
- **Enable:** `TRAEFIK_API_URL` on the gateway (e.g. `http://traefik:8080`).

### 5. SeaweedFS (file storage)
- **Code:** `services/user-service/src/seaweedfs.ts` (master/volume HTTP API: assign, upload, lookup, download, delete, cluster status).
- Used for user avatars:
  - `POST /api/users/me/avatar` (multipart field `avatar`; PNG/JPEG/GIF/WebP up to 2 MB) stores the file in the `avatars` collection and deletes the previous one.
  - `GET /api/users/:id/avatar` streams it back (public, cacheable).
- **Enable:** `SEAWEEDFS_SERVER`, `SEAWEEDFS_PORT` (9333), `SEAWEEDFS_SCHEME`.

### Also wired
- **Prometheus:** every service serves `/metrics` (prom-client). It exports HTTP rate and latency, circuit-breaker state, domain events and cache hit/miss. Scrape config: `infra/prometheus/prometheus.yml`.
- **Redis:** cache-aside for users, products, product lists and categories, with invalidation on writes (`services/shared/src/cache.ts`).

## Packages
All are declared in `services/shared/package.json` or the owning service's package.json: `amqplib`, `redis`, `fluent-logger`, `http-proxy-middleware`, `prom-client`, `jsonwebtoken`, `mongoose`, `multer`, `nodemailer`, `zod`. Consul, Zipkin, Traefik and SeaweedFS are reached over their HTTP APIs with `fetch`, so they need no client package.

## Verification status
Verified locally, against real processes:
- Consul 1.20 dev agent
- SeaweedFS 3.x
- MongoDB 6
- Redis

Zipkin and Fluentd were checked against local sinks that received the spans and forward-protocol records; neither real server was run. RabbitMQ and the Docker images were not run on the development machine (see README "Verification").
