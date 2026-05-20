/**
 * PRODUCT SERVICE MICROSERVICE
 * 
 * CURRICULUM COVERAGE:
 * #1221-1240: Product catalog management microservice
 * #1276-1290: Redis caching for product data
 */

const express = require('express');
const mongoose = require('mongoose');
const helmet = require('helmet');
const cors = require('cors');
const winston = require('winston');
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

app.use('/api/products', require('./routes/products'));

app.get('/health', (req, res) => {
    res.json({
        service: 'product-service',
        status: 'healthy',
        mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
        timestamp: new Date().toISOString()
    });
});

app.use((err, req, res, next) => {
    logger.error('Product Service Error:', err);
    res.status(500).json({ success: false, error: err.message });
});

mongoose.connect(process.env.MONGODB_URI)
    .then(() => logger.info('✅ Product Service: MongoDB Connected'))
    .catch(err => {
        logger.error('MongoDB Error:', err);
        process.exit(1);
    });

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
    logger.info(`📦 Product Service running on port ${PORT}`);
});

module.exports = app;
