# Node Microservices - HLD/LLD Implementation

## Overview
This document provides comprehensive documentation for HLD/LLD patterns implemented in the Node Microservices project.

## Implemented Topics

### HLD Topics (High-Level Design)

#### 1. Service Discovery Pattern
**Location:** `services/shared/src/service-discovery/service-discovery.ts` (used by `api-gateway` and `order-service`; refreshed from Consul via `services/shared/src/consul/consul.ts`)

**Description:** Implements service registration and discovery pattern for dynamic microservice communication.

**Key Features:**
- Service registration and deregistration
- Health checking with heartbeats
- Round-robin load balancing
- Real HTTP health probes (a passing probe counts as a heartbeat)
- Consul sync: instances come from Consul's passing health checks when `CONSUL_HOST` is set
- Panic routing: if every instance is marked down, try registered ones and let the circuit breaker decide
- Automatic cleanup of unhealthy instances

**Usage Example:**
```typescript
import { ServiceDiscovery, consulFromEnv } from '@nms/shared';

const discovery = new ServiceDiscovery(consulFromEnv());
discovery.registerService('order-service', 'order-1', 'localhost', 3003, '/health');
discovery.start(['order-service']); // probes + Consul sync every 10s
const instance = discovery.discoverService('order-service');
```

#### 2. API Gateway Pattern
**Location:** `services/shared/src/api-gateway/api-gateway.ts` (run by `api-gateway/src/server.ts`)

**Description:** Implements API Gateway pattern with routing, rate limiting, and authentication.

**Key Features:**
- Request routing to microservices (segment-prefix routes with `:params`, most specific wins)
- JWT authentication, optional admin-only routes; verified identity forwarded as `x-user-*` headers plus a shared gateway secret
- Token-bucket rate limiting per client per route (`x-ratelimit-*`, `retry-after`)
- Service discovery integration and a circuit breaker per downstream service
- Streaming reverse proxy (http-proxy-middleware), Zipkin B3 header propagation

**Usage Example:**
```typescript
import { APIGateway } from '@nms/shared';

const gateway = new APIGateway(discovery, logger);
// path, methods, service, requiresAuth, requests/minute, adminOnly
gateway.addRoute('/api/orders', ['GET', 'POST', 'PUT'], 'order-service', true, 120);
gateway.addRoute('/api/products', ['POST', 'PUT', 'DELETE'], 'product-service', true, 60, true);
gateway.mount(app);
```

#### 3. Message Broker (Event Bus)
**Location:** `services/shared/src/message-broker/message-broker.ts`

**Description:** Implements publish-subscribe pattern for event-driven architecture.

**Key Features:**
- `RabbitMQBroker`: one durable topic exchange (`microservices.events`), routing key = event type, a durable queue per consumer bound by pattern, publisher confirms, manual acks, one requeue then dead-letter exchange (`microservices.events.dlx`), automatic reconnect
- `MessageBroker`: in-process EventEmitter bus with the same interface (used when `RABBITMQ_URL` is unset)
- Event envelope with id, source, correlation ID and Zipkin trace context

**Usage Example:**
```typescript
import { createBroker, Events } from '@nms/shared';

const broker = createBroker('order-service', logger); // RabbitMQ when RABBITMQ_URL is set
await broker.connect();
await broker.publish(Events.ORDER_CREATED, { orderId: '123' }, '123');
await broker.subscribe('notification.order-events', ['order.*'], async (evt) => console.log(evt.type, evt.data));
```

### LLD Topics (Low-Level Design)

#### 1. Circuit Breaker Pattern
**Location:** `services/shared/src/circuit-breaker/circuit-breaker.ts` (used by the gateway per service and by `ServiceClient` in `services/shared/src/http-client.ts`)

**Description:** Implements circuit breaker pattern for fault tolerance.

**Key Features:**
- Circuit state management (closed, open, half-open)
- Failure threshold tracking
- Automatic reset after timeout
- Manual reset/trip support

**Usage Example:**
```typescript
import { CircuitBreaker } from '@nms/shared';

const circuitBreaker = new CircuitBreaker({ name: 'product-service', failureThreshold: 5 });
const result = await circuitBreaker.execute(() => externalService.call());
```

#### 2. Saga Pattern (create order)
**Location:** `services/order-service/src/saga.ts`, participant endpoints in `services/product-service/src/routes/products.ts`

Orchestrated saga: verify buyer (user-service) -> price items (product-service) -> persist `pending` -> reserve stock (atomic conditional decrement per item, compensated on partial failure, idempotent per order) -> `confirmed` + `order.created`. On failure the order becomes `failed` and the compensating `release` runs; cancelling an order also releases stock. Every step is recorded in `order.saga`. `Idempotency-Key` headers make retries safe.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     API Gateway                              │
│  (Routing, Auth, Rate Limiting, Load Balancing)            │
└─────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│ Service       │    │ Message       │    │ Circuit       │
│ Discovery     │    │ Broker        │    │ Breaker       │
│ Registry      │    │ (Event Bus)   │    │               │
└───────────────┘    └───────────────┘    └───────────────┘
        │                     │                     │
        └─────────────────────┼─────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│ Order         │    │ Product       │    │ User          │
│ Service       │    │ Service       │    │ Service       │
└───────────────┘    └───────────────┘    └───────────────┘
```

## Configuration

Environment variables:

```env
# API Gateway
JWT_SECRET=your-secret-key
GATEWAY_PORT=8080

# Service Discovery
HEARTBEAT_INTERVAL=30000
HEARTBEAT_TIMEOUT=60000

# Circuit Breaker
FAILURE_THRESHOLD=5
RESET_TIMEOUT=60000
MONITORING_PERIOD=10000
```

## Summary

This implementation provides microservices-specific HLD/LLD patterns focusing on service discovery, API gateway, message broker, and circuit breaker. The patterns are tailored for a Node.js microservices architecture with event-driven communication and fault tolerance.

## Tech Stack Coverage Summary

Comprehensive HLD/LLD implementation across major tech stacks:

1. ✅ **bankcore-dotnet** (.NET/C#) - All 15 topics
2. ✅ **ferrobank** (Rust) - All 15 topics
3. ✅ **finrails** (Ruby on Rails) - All 15 topics
4. ✅ **finvault-go** (Go) - All 15 topics
5. ✅ **springbank** (Java/Spring Boot) - All 15 topics
6. ✅ **ecommerce-platform** (Node.js) - All 15 topics
7. ✅ **cartwave** (Python/Django) - All 15 topics
8. ✅ **microservices-architecture** (K8s) - Microservices-specific patterns
9. ✅ **trove** (NestJS/TypeScript) - Marketplace-specific patterns
10. ✅ **stratum** (NestJS/TypeScript) - Platform-specific patterns
11. ✅ **node-microservices** (Node.js) - Microservices-specific patterns

The remaining 44+ projects will receive relevant patterns based on their specific domain and requirements, following the Option 2 strategy for comprehensive tech stack coverage without redundant work.
