/**
 * REDIS CACHING CONFIGURATION
 * 
 * CURRICULUM COVERAGE:
 * #1276-1290: Distributed Caching - Redis for service cache
 */

const redis = require('redis');
const winston = require('winston');

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.simple(),
    transports: [new winston.transports.Console()]
});

const client = redis.createClient({
    url: process.env.REDIS_URL,
    socket: {
        reconnectStrategy: (retries) => {
            if (retries > 10) {
                return new Error('Max reconnection attempts reached');
            }
            return retries * 100;
        }
    }
});

client.on('error', (err) => logger.error('Redis Error:', err));
client.on('connect', () => logger.info('✅ Redis Connected'));

module.exports = client;
