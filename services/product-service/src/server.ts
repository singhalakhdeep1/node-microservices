/**
 * Product service: catalog CRUD with search/filter/pagination, Redis cache-aside with
 * invalidation, stock reservation/release endpoints for the order saga, `product.*` events.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { Cache, createBroker, createService, requireInternal } from '@nms/shared';
import { internalProductRoutes, productRoutes } from './routes/products';

const NAME = 'product-service';
const service = createService({
  name: NAME,
  port: Number(process.env.PORT ?? 3002),
  critical: ['mongodb'],
  health: {
    mongodb: () => (mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'),
    redis: () => cache.status(),
    rabbitmq: () => (broker.kind === 'memory' ? 'disabled' : broker.isConnected() ? 'connected' : 'disconnected'),
  },
});
const { logger } = service;
const cache = new Cache(NAME, logger);
const broker = createBroker(NAME, logger);

async function main() {
  await mongoose.connect(process.env.MONGODB_URI ?? 'mongodb://localhost:27017/products');
  logger.info('MongoDB connected');
  await Promise.all([cache.connect(), broker.connect()]);

  await service.start(
    (app) => {
      app.use('/api/products', productRoutes({ broker, cache, logger }));
      app.use('/internal/products', requireInternal, internalProductRoutes({ broker, cache, logger }));
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
