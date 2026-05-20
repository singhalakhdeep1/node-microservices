/**
 * NOTIFICATION SERVICE MICROSERVICE
 * 
 * CURRICULUM COVERAGE:
 * #1261-1275: Notification service - Email, SMS, Push notifications
 * #1351-1360: Event-driven architecture - Consuming events from message queue
 */

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const winston = require('winston');
const messageQueue = require('./config/messageQueue');
const emailService = require('./services/emailService');
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

app.get('/health', (req, res) => {
    res.json({
        service: 'notification-service',
        status: 'healthy',
        timestamp: new Date().toISOString()
    });
});

app.use((err, req, res, next) => {
    logger.error('Notification Service Error:', err);
    res.status(500).json({ success: false, error: err.message });
});

// Initialize message queue and subscribe to events
messageQueue.connect().then(() => {
    logger.info('✅ Notification Service: RabbitMQ Connected');

    // #1351-1360: Subscribe to USER_EVENTS
    messageQueue.subscribe(
        messageQueue.exchanges.USER_EVENTS,
        'notification-user-queue',
        async (message) => {
            const { event, data } = message;

            if (event === 'USER_CREATED') {
                await emailService.sendWelcomeEmail(data.email, data.name);
                logger.info(`📧 Welcome email sent to ${data.email}`);
            }
        }
    );

    // Subscribe to ORDER_EVENTS
    messageQueue.subscribe(
        messageQueue.exchanges.ORDER_EVENTS,
        'notification-order-queue',
        async (message) => {
            const { event, data } = message;

            if (event === 'ORDER_CREATED') {
                // In real scenario, fetch user email from user service
                logger.info(`📧 Order confirmation email would be sent for order ${data.orderId}`);
            } else if (event === 'ORDER_STATUS_CHANGED') {
                logger.info(`📧 Order status update email for order ${data.orderId} - Status: ${data.newStatus}`);
            }
        }
    );

    // Subscribe to NOTIFICATION_EVENTS
    messageQueue.subscribe(
        messageQueue.exchanges.NOTIFICATION_EVENTS,
        'notification-direct-queue',
        async (message) => {
            const { event, data } = message;

            if (event === 'SEND_ORDER_CONFIRMATION') {
                await emailService.sendOrderConfirmation(
                    data.userEmail,
                    data.orderDetails
                );
                logger.info(`📧 Order confirmation sent for order ${data.orderId}`);
            }
        }
    );
});

const PORT = process.env.PORT || 3004;
app.listen(PORT, () => {
    logger.info(`📬 Notification Service running on port ${PORT}`);
});

module.exports = app;
