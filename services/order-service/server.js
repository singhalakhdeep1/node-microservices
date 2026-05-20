/**
 * ORDER SERVICE MICROSERVICE
 * 
 * CURRICULUM COVERAGE:
 * #1241-1260: Order management with inter-service communication
 * #1311-1325: Circuit Breaker pattern for service calls
 * #1341-1360: Saga pattern for distributed transactions
 */

const express = require('express');
const mongoose = require('mongoose');
const helmet = require('helmet');
const cors = require('cors');
const winston = require('winston');
const messageQueue = require('./config/messageQueue');
require('dotenv').config();

const app = express();

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.json(),
    transports: [new winston.transports.Console({ format: winston.format.simple() })]
});

app.use(helmet());
app.use(cors());
app.use(express.json());

app.use('/api/orders', require('./routes/orders'));

app.get('/health', (req, res) => {
    res.json({
        service: 'order-service',
        status: 'healthy',
        mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
        timestamp: new Date().toISOString()
    });
});

app.use((err, req, res, next) => {
    logger.error('Order Service Error:', err);
    res.status(500).json({ success: false, error: err.message });
});

mongoose.connect(process.env.MONGODB_URI)
    .then(() => {
        logger.info('✅ Order Service: MongoDB Connected');

        messageQueue.connect()
            .then(() => logger.info('✅ Order Service: RabbitMQ Connected'))
            .catch(err => logger.error('RabbitMQ Error:', err));
    })
    .catch(err => {
        logger.error('MongoDB Error:', err);
        process.exit(1);
    });

const PORT = process.env.PORT || 3003;
app.listen(PORT, () => {
    logger.info(`📋 Order Service running on port ${PORT}`);
});

module.exports = app;
