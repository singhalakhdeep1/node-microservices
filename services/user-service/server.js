/**
 * USER SERVICE MICROSERVICE
 * 
 * CURRICULUM COVERAGE:
 * #1201-1220: Microservices - User service with authentication
 * #1251-1275: RabbitMQ - Publishing events to message queue
 * #1276-1290: Redis - Service-level caching
 */

const express = require('express');
const mongoose = require('mongoose');
const helmet = require('helmet');
const cors = require('cors');
const winston = require('winston');
const messageQueue = require('./config/messageQueue');
const redis = require('./config/redis');
require('dotenv').config();

const app = express();

// Logger
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.json(),
    transports: [
        new winston.transports.Console({ format: winston.format.simple() })
    ]
});

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/users', require('./routes/users'));

// Health check
app.get('/health', (req, res) => {
    const health = {
        service: 'user-service',
        status: 'healthy',
        mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
        timestamp: new Date().toISOString()
    };
    res.json(health);
});

// Error handler
app.use((err, req, res, next) => {
    logger.error('User Service Error:', err);
    res.status(500).json({
        success: false,
        error: err.message
    });
});

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI)
    .then(() => {
        logger.info('✅ User Service: MongoDB Connected');

        // Initialize RabbitMQ connection
        messageQueue.connect()
            .then(() => logger.info('✅ User Service: RabbitMQ Connected'))
            .catch(err => logger.error('RabbitMQ Connection Error:', err));

        // Initialize Redis
        redis.connect()
            .then(() => logger.info('✅ User Service: Redis Connected'))
            .catch(err => logger.error('Redis Connection Error:', err));
    })
    .catch(err => {
        logger.error('MongoDB Connection Error:', err);
        process.exit(1);
    });

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    logger.info(`👤 User Service running on port ${PORT}`);
});

module.exports = app;
