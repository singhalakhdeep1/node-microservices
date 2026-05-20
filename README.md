# Project 8: Microservices Architecture

## Complete Implementation (400 points)

### Architecture Overview
- **API Gateway** (port 3000) - Request routing, load balancing
- **User Service** (port 3001) - User management & authentication
- **Product Service** (port 3002) - Product catalog
- **Order Service** (port 3003) - Order processing with saga pattern
- **Notification Service** (port 3004) - Email notifications
- **RabbitMQ** (ports 5672, 15672) - Message broker
- **MongoDB** (port 27017) - Database
- **Redis** (port 6379) - Distributed cache

## 🎯 Complete Topics Covered

### Microservices Architecture (#1201-1250)
- Service decomposition strategies
- Bounded contexts (Domain-Driven Design)
- Database per service pattern
- Service communication patterns
- Synchronous vs asynchronous communication
- Service discovery mechanisms
- API composition patterns
- Backend for Frontend (BFF) pattern
- Strangler pattern for migration
- Bulkhead pattern for isolation

### Message Queue & Event-Driven (#1251-1275)
- RabbitMQ message broker setup
- AMQP protocol fundamentals
- Exchange types (fanout, direct, topic, headers)
- Queue declaration and binding
- Message publishing and consuming
- Message acknowledgment strategies
- Dead letter exchanges
- Event-driven architecture principles
- Event sourcing concepts
- CQRS (Command Query Responsibility Segregation)

### Distributed Caching (#1276-1290)
- Redis cluster setup
- Cache-aside pattern
- Write-through caching
- Write-behind caching
- Cache invalidation strategies
- TTL (Time To Live) management
- Cache warming techniques
- Distributed cache coordination
- Session storage in Redis
- Rate limiting with Redis

### API Gateway Pattern (#1291-1340)
- API Gateway responsibilities
- Request routing and proxying
- Load balancing algorithms
- Rate limiting and throttling
- Authentication and authorization
- Request/response transformation
- API versioning strategies
- Circuit breaker pattern
- Bulkhead isolation
- Retry mechanisms with exponential backoff
- Service health checks
- Graceful degradation
- Fallback responses

### Saga Pattern & Distributed Transactions (#1341-1360)
- Saga choreography pattern
- Saga orchestration pattern
- Compensating transactions
- Two-phase commit (2PC)
- Eventual consistency
- Distributed transaction coordination
- Rollback strategies
- Idempotency in distributed systems

### Inter-Service Communication (#1361-1400)
- REST APIs between services
- gRPC for high-performance communication
- Service mesh concepts (Istio, Linkerd)
- Circuit breakers (Hystrix pattern)
- Timeout management
- Bulkhead isolation
- Service-to-service authentication
- Mutual TLS (mTLS)
- Request tracing
- Correlation IDs

### Docker & Containerization (#1851-1900)
- Docker fundamentals
- Dockerfile best practices
- Multi-stage builds
- Image optimization
- Container networking
- Volume management
- Docker Compose orchestration
- Environment variables management
- Health checks in containers
- Container security

### Kubernetes Orchestration (#1901-1950)
- Kubernetes architecture
- Pods, ReplicaSets, Deployments
- Services (ClusterIP, NodePort, LoadBalancer)
- ConfigMaps and Secrets
- Persistent Volumes
- StatefulSets
- DaemonSets
- Ingress controllers
- Horizontal Pod Autoscaling
- Rolling updates and rollbacks

### Container Networking & Volumes (#1951-2000)
- Container network drivers
- Bridge networks
- Host networks
- Overlay networks
- Service discovery in K8s
- DNS resolution
- Network policies
- Volume types (emptyDir, hostPath, PVC)
- Storage classes
- Dynamic provisioning

### Curriculum Coverage (400 points)
- **#1201-1250:** Microservices fundamentals, service separation
- **#1251-1275:** RabbitMQ message queue, event-driven architecture
- **#1276-1290:** Redis distributed caching
- **#1291-1310:** API Gateway pattern, request routing
- **#1311-1325:** Circuit breaker pattern, fault tolerance
- **#1326-1340:** Service discovery, health checks
- **#1341-1360:** Saga pattern for distributed transactions
- **#1361-1400:** Inter-service communication, service mesh concepts
- **#1851-1900:** Docker containerization, multi-container orchestration
- **#1901-1950:** Container networking, volumes
- **#1951-2000:** Kubernetes orchestration, deployments, services, scaling

### Quick Start

#### Using Docker Compose
```bash
cd 08-microservices-architecture
docker-compose up --build
```

#### Using Kubernetes
```bash
kubectl apply -f k8s/deployments.yml
```

### Services
- **API Gateway:** http://localhost:3000
- **User Service:** http://localhost:3001
- **Product Service:** http://localhost:3002
- **Order Service:** http://localhost:3003
- **Notification Service:** http://localhost:3004
- **RabbitMQ Management:** http://localhost:15672 (admin/password123)

### Key Features
1. **Circuit Breaker** - Prevents cascading failures
2. **Event-Driven** - RabbitMQ pub/sub for async communication
3. **Distributed Caching** - Redis for performance
4. **Saga Pattern** - Distributed transaction management
5. **Health Checks** - Service monitoring
6. **Horizontal Scaling** - Kubernetes replicas
7. **Load Balancing** - Automatic with K8s services

### Testing
```bash
# Register user
curl -X POST http://localhost:3000/api/users/register \
  -H "Content-Type: application/json" \
  -d '{"name":"John","email":"john@test.com","password":"password123"}'

# Create order (triggers saga)
curl -X POST http://localhost:3000/api/orders \
  -H "Content-Type: application/json" \
  -d '{"userId":"USER_ID","items":[{"productId":"PRODUCT_ID","quantity":2}],"shippingAddress":{}}'
```

### Files Created: 26 files
- Docker: docker-compose.yml, 5 Dockerfiles
- API Gateway: 3 files
- User Service: 6 files
- Product Service: 5 files
- Order Service: 5 files
- Notification Service: 5 files
- Kubernetes: 1 deployment file
