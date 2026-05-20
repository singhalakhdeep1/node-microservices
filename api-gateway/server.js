/**
 * API GATEWAY FOR MICROSERVICES
 * 
 * CURRICULUM COVERAGE:
 * #1291-1310: API Gateway Pattern - Request routing, authentication
 * #1311-1325: Load Balancing, Circuit Breaker
 * #1326-1340: Service Discovery, Health Checks
 * #351-400: Security Middleware
 */

const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const winston = require('winston');
require('dotenv').config();

const app = express();

// Logger
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.json(),
    transports: [
        new winston.transports.Console({
            format: winston.format.simple()
        })
    ]
});

// #351-400: Security Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Rate limiting - #376-390: Rate limiting at gateway level
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    message: 'Too many requests from this IP'
});
app.use(limiter);

// Request logging middleware
app.use((req, res, next) => {
    logger.info(`${req.method} ${req.path} - ${req.ip}`);
    next();
});

// #1291-1310: Route-based Service Proxying
// User Service Routes
app.use('/api/users', createProxyMiddleware({
    target: process.env.USER_SERVICE_URL || 'http://localhost:3001',
    changeOrigin: true,
    pathRewrite: {
        '^/api/users': '/api/users'
    },
    onError: (err, req, res) => {
        logger.error('User Service Error:', err.message);
        res.status(503).json({
            success: false,
            error: 'User service unavailable'
        });
    }
}));

// Product Service Routes
app.use('/api/products', createProxyMiddleware({
    target: process.env.PRODUCT_SERVICE_URL || 'http://localhost:3002',
    changeOrigin: true,
    pathRewrite: {
        '^/api/products': '/api/products'
    },
    onError: (err, req, res) => {
        logger.error('Product Service Error:', err.message);
        res.status(503).json({
            success: false,
            error: 'Product service unavailable'
        });
    }
}));

// Order Service Routes
app.use('/api/orders', createProxyMiddleware({
    target: process.env.ORDER_SERVICE_URL || 'http://localhost:3003',
    changeOrigin: true,
    pathRewrite: {
        '^/api/orders': '/api/orders'
    },
    onError: (err, req, res) => {
        logger.error('Order Service Error:', err.message);
        res.status(503).json({
            success: false,
            error: 'Order service unavailable'
        });
    }
}));

// #1326-1340: Health Check Endpoint for Service Discovery
app.get('/health', async (req, res) => {
    const services = {
        'user-service': process.env.USER_SERVICE_URL,
        'product-service': process.env.PRODUCT_SERVICE_URL,
        'order-service': process.env.ORDER_SERVICE_URL,
        'notification-service': process.env.NOTIFICATION_SERVICE_URL
    };

    const healthChecks = {};

    for (const [name, url] of Object.entries(services)) {
        try {
            const response = await fetch(`${url}/health`, {
                signal: AbortSignal.timeout(5000)
            });
            healthChecks[name] = response.ok ? 'healthy' : 'unhealthy';
        } catch (error) {
            healthChecks[name] = 'unavailable';
        }
    }

    const allHealthy = Object.values(healthChecks).every(status => status === 'healthy');

    res.status(allHealthy ? 200 : 503).json({
        success: allHealthy,
        gateway: 'healthy',
        services: healthChecks,
        timestamp: new Date().toISOString()
    });
});

// Gateway info endpoint
app.get('/api', (req, res) => {
    res.json({
        success: true,
        message: 'Microservices API Gateway',
        version: '1.0.0',
        services: {
            users: '/api/users',
            products: '/api/products',
            orders: '/api/orders'
        }
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: 'Route not found'
    });
});

// Error handler
app.use((err, req, res, next) => {
    logger.error('Gateway Error:', err);
    res.status(500).json({
        success: false,
        error: 'Internal gateway error'
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    logger.info(`🚪 API Gateway running on port ${PORT}`);
    logger.info('📡 Routing to microservices:');
    logger.info(`  - User Service: ${process.env.USER_SERVICE_URL}`);
    logger.info(`  - Product Service: ${process.env.PRODUCT_SERVICE_URL}`);
    logger.info(`  - Order Service: ${process.env.ORDER_SERVICE_URL}`);
});

module.exports = app;
