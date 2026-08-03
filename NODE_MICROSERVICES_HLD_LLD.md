# Node Microservices - HLD/LLD Implementation

## Overview
This document provides comprehensive documentation for HLD/LLD patterns implemented in the Node Microservices project.

## Implemented Topics

### HLD Topics (High-Level Design)

#### 1. Service Discovery Pattern
**Location:** `services/shared/service-discovery/service-discovery.js`

**Description:** Implements service registration and discovery pattern for dynamic microservice communication.

**Key Features:**
- Service registration and deregistration
- Health checking with heartbeats
- Round-robin load balancing
- Automatic cleanup of unhealthy instances

**Usage Example:**
```javascript
const ServiceDiscovery = require('./shared/service-discovery/service-discovery');

const discovery = new ServiceDiscovery();

discovery.registerService('order-service', 'order-1', 'localhost', 8001, '/health');
const instance = discovery.discoverService('order-service');
```

#### 2. API Gateway Pattern
**Location:** `services/shared/api-gateway/api-gateway.js`

**Description:** Implements API Gateway pattern with routing, rate limiting, and authentication.

**Key Features:**
- Request routing to microservices
- JWT authentication
- Rate limiting per client
- Service discovery integration

**Usage Example:**
```javascript
const APIGateway = require('./shared/api-gateway/api-gateway');

const gateway = new APIGateway(discovery);
gateway.addRoute('/api/orders', ['GET', 'POST'], 'order-service', true, 100);
gateway.start(8080);
```

#### 3. Message Broker (Event Bus)
**Location:** `services/shared/message-broker/message-broker.js`

**Description:** Implements publish-subscribe pattern for event-driven architecture.

**Key Features:**
- Event publishing and subscription
- Event-driven communication
- Correlation ID tracking

**Usage Example:**
```javascript
const MessageBroker = require('./shared/message-broker/message-broker');

const broker = new MessageBroker();
broker.publish('OrderCreated', { orderId: '123' });
broker.subscribe('OrderCreated', (payload) => console.log(payload));
```

### LLD Topics (Low-Level Design)

#### 1. Circuit Breaker Pattern
**Location:** `services/shared/circuit-breaker/circuit-breaker.js`

**Description:** Implements circuit breaker pattern for fault tolerance.

**Key Features:**
- Circuit state management (closed, open, half-open)
- Failure threshold tracking
- Automatic reset after timeout
- Manual reset/trip support

**Usage Example:**
```javascript
const CircuitBreaker = require('./shared/circuit-breaker/circuit-breaker');

const circuitBreaker = new CircuitBreaker({ failureThreshold: 5 });
const result = await circuitBreaker.execute(async () => {
  return await externalService.call();
});
```

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
