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
            this.connection = await amqp.connect(process.env.RABBITMQ_URL);
            this.channel = await this.connection.createChannel();

            await this.channel.assertExchange(this.exchanges.ORDER_EVENTS, 'fanout', { durable: true });
            await this.channel.assertExchange(this.exchanges.NOTIFICATION_EVENTS, 'fanout', { durable: true });

            logger.info('✅ RabbitMQ connected');

            this.connection.on('error', (err) => logger.error('RabbitMQ error:', err));
            this.connection.on('close', () => {
                logger.warn('RabbitMQ closed. Reconnecting...');
                setTimeout(() => this.connect(), 5000);
            });
        } catch (error) {
            logger.error('RabbitMQ connection failed:', error);
            setTimeout(() => this.connect(), 5000);
        }
    }

    async publish(exchange, event, data) {
        if (!this.channel) {
            logger.error('RabbitMQ channel not initialized');
            return false;
        }

        try {
            const message = JSON.stringify({ event, data, timestamp: new Date().toISOString() });
            this.channel.publish(exchange, '', Buffer.from(message), { persistent: true });
            logger.info(`📤 Published: ${event} to ${exchange}`);
            return true;
        } catch (error) {
            logger.error('Publish failed:', error);
            return false;
        }
    }
}

module.exports = new MessageQueue();
