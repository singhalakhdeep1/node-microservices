/**
 * User service: registration, login (JWT), profile, avatar storage in SeaweedFS, admin user
 * management, Redis cache-aside reads, `user.*` events on RabbitMQ.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { Cache, createBroker, createService, requireInternal } from '@nms/shared';
import { internalUserRoutes, userRoutes } from './routes/users';
import { seaweedFromEnv } from './seaweedfs';

const NAME = 'user-service';
const service = createService({
  name: NAME,
  port: Number(process.env.PORT ?? 3001),
  critical: ['mongodb'],
  health: {
    mongodb: () => (mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'),
    redis: () => cache.status(),
    rabbitmq: () => (broker.kind === 'memory' ? 'disabled' : broker.isConnected() ? 'connected' : 'disconnected'),
    seaweedfs: async () => (storage ? ((await storage.systemStatus()) ? 'connected' : 'disconnected') : 'disabled'),
  },
});
const { logger } = service;
const cache = new Cache(NAME, logger);
const broker = createBroker(NAME, logger);
const storage = seaweedFromEnv();

async function main() {
  await mongoose.connect(process.env.MONGODB_URI ?? 'mongodb://localhost:27017/users');
  logger.info('MongoDB connected');
  await Promise.all([cache.connect(), broker.connect()]);

  await service.start(
    (app) => {
      app.use('/api/users', userRoutes({ broker, cache, logger, storage }));
      app.use('/internal/users', requireInternal, internalUserRoutes(cache));
    },
    {
      onStop: async () => {
        await broker.close();
        await cache.close();
        await mongoose.disconnect();
      },
    },
  );
}

main().catch((err) => {
  logger.error('startup failed', { err: (err as Error).message });
  process.exit(1);
});
