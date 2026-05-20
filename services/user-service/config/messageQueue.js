/**
 * RABBITMQ MESSAGE QUEUE CONFIGURATION
 * 
 * CURRICULUM COVERAGE:
 * #1251-1275: Message Queue Communication - RabbitMQ for async messaging
 * #1311-1325: Event-Driven Architecture - Publishing domain events
 */

const amqp = require('amqplib');
const winston = require('winston');

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.simple(),
    transports: [new winston.transports.Console()]
});

class MessageQueue {
    constructor() {
        this.connection = null;
        this.channel = null;
        this.exchanges = {
            USER_EVENTS: 'user.events',
            ORDER_EVENTS: 'order.events',
            NOTIFICATION_EVENTS: 'notification.events'
        };
    }

    async connect() {
        try {
            // #1251-1260: Connect to RabbitMQ
            this.connection = await amqp.connect(process.env.RABBITMQ_URL);
            this.channel = await this.connection.createChannel();

            // #1261-1270: Declare exchanges (fanout for broadcasting)
            await this.channel.assertExchange(this.exchanges.USER_EVENTS, 'fanout', {
                durable: true
            });

            logger.info('✅ RabbitMQ connected and exchanges declared');

            // Handle connection errors
            this.connection.on('error', (err) => {
                logger.error('RabbitMQ connection error:', err);
            });

            this.connection.on('close', () => {
                logger.warn('RabbitMQ connection closed. Reconnecting...');
                setTimeout(() => this.connect(), 5000);
            });
        } catch (error) {
            logger.error('Failed to connect to RabbitMQ:', error);
            setTimeout(() => this.connect(), 5000);
        }
    }

    /**
     * Publish event to message queue
     * #1271-1275: Event Publishing Pattern
     */
    async publish(exchange, event, data) {
        if (!this.channel) {
            logger.error('RabbitMQ channel not initialized');
            return false;
        }

        try {
            const message = JSON.stringify({
                event,
                data,
                timestamp: new Date().toISOString()
            });

            this.channel.publish(
                exchange,
                '', // Routing key (empty for fanout)
                Buffer.from(message),
                { persistent: true }
            );

            logger.info(`📤 Published event: ${event} to ${exchange}`);
            return true;
        } catch (error) {
            logger.error('Failed to publish message:', error);
            return false;
        }
    }

    /**
     * Subscribe to events from queue
     */
    async subscribe(exchange, queueName, callback) {
        if (!this.channel) {
            logger.error('RabbitMQ channel not initialized');
            return;
        }

        try {
            // Assert queue
            await this.channel.assertQueue(queueName, { durable: true });

            // Bind queue to exchange
            await this.channel.bindQueue(queueName, exchange, '');

            // Consume messages
            this.channel.consume(queueName, (msg) => {
                if (msg) {
                    const content = JSON.parse(msg.content.toString());
                    logger.info(`📥 Received event: ${content.event}`);

                    callback(content);

                    // Acknowledge message
                    this.channel.ack(msg);
                }
            });

            logger.info(`✅ Subscribed to ${exchange} on queue ${queueName}`);
        } catch (error) {
            logger.error('Failed to subscribe:', error);
        }
    }
}

module.exports = new MessageQueue();
