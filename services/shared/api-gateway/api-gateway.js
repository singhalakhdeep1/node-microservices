/**
 * API Gateway for Node Microservices
 * Implements API Gateway pattern with routing and rate limiting
 */
const express = require('express');
const jwt = require('jsonwebtoken');

class APIGateway {
  constructor(serviceDiscovery) {
    this.serviceDiscovery = serviceDiscovery;
    this.routes = new Map();
    this.rateLimiters = new Map();
    this.jwtSecret = process.env.JWT_SECRET || 'your-secret-key';
    this.app = express();
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
  }

  addRoute(path, methods, targetService, requiresAuth = true, rateLimit = 100) {
    this.routes.set(path, {
      path,
      methods,
      targetService,
      requiresAuth,
      rateLimit
    });
    console.log(`Added route: ${path} -> ${targetService}`);
  }

  async handleRequest(req, res) {
    const path = req.path;
    const method = req.method;

    // Find matching route
    const route = this.findRoute(path, method);
    if (!route) {
      return res.status(404).json({ error: 'Route not found' });
    }

    // Check rate limit
    const clientId = this.getClientId(req);
    if (!this.checkRateLimit(clientId, route.rateLimit)) {
      return res.status(429).json({ error: 'Rate limit exceeded' });
    }

    // Check authentication
    if (route.requiresAuth) {
      const authResult = this.authenticate(req);
      if (!authResult) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }

    // Route to target service
    return await this.routeToService(req, res, route);
  }

  findRoute(path, method) {
    for (const [routePath, route] of this.routes) {
      if (path.startsWith(routePath) && route.methods.includes(method)) {
        return route;
      }
    }
    return null;
  }

  getClientId(req) {
    return req.ip || 'unknown';
  }

  checkRateLimit(clientId, limit) {
    const now = Date.now() / 1000;

    if (!this.rateLimiters.has(clientId)) {
      this.rateLimiters.set(clientId, { tokens: limit, lastRefill: now });
    }

    const rateLimiter = this.rateLimiters.get(clientId);
    const timeSinceRefill = now - rateLimiter.lastRefill;

    // Refill tokens (1 token per second)
    const tokensToAdd = Math.floor(timeSinceRefill);
    rateLimiter.tokens = Math.min(rateLimiter.tokens + tokensToAdd, limit);
    rateLimiter.lastRefill = now;

    if (rateLimiter.tokens > 0) {
      rateLimiter.tokens -= 1;
      return true;
    }

    return false;
  }

  authenticate(req) {
    const authHeader = req.headers.authorization || '';

    if (!authHeader.startsWith('Bearer ')) {
      return false;
    }

    const token = authHeader.substring(7);

    try {
      jwt.verify(token, this.jwtSecret);
      return true;
    } catch (error) {
      return false;
    }
  }

  async routeToService(req, res, route) {
    const serviceInstance = this.serviceDiscovery.discoverService(route.targetService);

    if (!serviceInstance) {
      return res.status(503).json({ error: 'Service unavailable' });
    }

    // In a real implementation, this would forward the request to the service
    return res.json({
      message: 'Request routed to service',
      service: route.targetService,
      instance: serviceInstance.instanceId
    });
  }

  start(port = 8080) {
    this.app.all('*', (req, res) => this.handleRequest(req, res));
    this.app.listen(port, () => {
      console.log(`API Gateway started on port ${port}`);
    });
  }
}

module.exports = APIGateway;
