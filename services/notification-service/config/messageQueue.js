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

            await this.channel.assertExchange(this.exchanges.USER_EVENTS, 'fanout', { durable: true });
            await this.channel.assertExchange(this.exchanges.ORDER_EVENTS, 'fanout', { durable: true });
            await this.channel.assertExchange(this.exchanges.NOTIFICATION_EVENTS, 'fanout', { durable: true });

            logger.info('✅ RabbitMQ connected');
        } catch (error) {
            logger.error('RabbitMQ connection failed:', error);
            setTimeout(() => this.connect(), 5000);
        }
    }

    async subscribe(exchange, queueName, callback) {
        if (!this.channel) {
            logger.error('RabbitMQ channel not initialized');
            return;
        }

        try {
            await this.channel.assertQueue(queueName, { durable: true });
            await this.channel.bindQueue(queueName, exchange, '');

            this.channel.consume(queueName, (msg) => {
                if (msg) {
                    const content = JSON.parse(msg.content.toString());
                    logger.info(`📥 Received: ${content.event}`);
                    callback(content);
                    this.channel.ack(msg);
                }
            });

            logger.info(`✅ Subscribed to ${exchange} on ${queueName}`);
        } catch (error) {
            logger.error('Subscribe failed:', error);
        }
    }
}

module.exports = new MessageQueue();
