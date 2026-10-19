/**
 * Order service: create-order saga across user-service and product-service (circuit breakers,
 * retries, compensation), idempotency keys, fulfilment status flow, `order.*` events.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { consulFromEnv, createBroker, createService, ServiceClient, ServiceDiscovery } from '@nms/shared';
import { orderRoutes } from './routes/orders';
import { OrderSaga } from './saga';

const NAME = 'order-service';
const service = createService({
  name: NAME,
  port: Number(process.env.PORT ?? 3003),
  critical: ['mongodb'],
  health: {
    mongodb: () => (mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'),
    rabbitmq: () => (broker.kind === 'memory' ? 'disabled' : broker.isConnected() ? 'connected' : 'disconnected'),
    'user-service': () => (users.breaker.getState() === 'open' ? 'circuit-open' : 'ok'),
    'product-service': () => (products.breaker.getState() === 'open' ? 'circuit-open' : 'ok'),
  },
});
const { logger } = service;
const broker = createBroker(NAME, logger);

// Downstream services are resolved through service discovery (Consul when configured, else static URLs).
const discovery = new ServiceDiscovery(consulFromEnv());
discovery.registerUrl('user-service', process.env.USER_SERVICE_URL ?? 'http://localhost:3001');
discovery.registerUrl('product-service', process.env.PRODUCT_SERVICE_URL ?? 'http://localhost:3002');
discovery.start(['user-service', 'product-service'], Number(process.env.DISCOVERY_INTERVAL_MS ?? 10_000));

const resolver = (name: string) => () => {
  const inst = discovery.discoverService(name);
  if (!inst) throw new Error(`no healthy ${name} instance`);
  return discovery.baseUrl(inst);
};
const users = new ServiceClient('user-service', resolver('user-service'), NAME, logger);
const products = new ServiceClient('product-service', resolver('product-service'), NAME, logger);
const saga = new OrderSaga(users, products, broker, logger);

async function main() {
  await mongoose.connect(process.env.MONGODB_URI ?? 'mongodb://localhost:27017/orders');
  logger.info('MongoDB connected');
  await broker.connect();

  await service.start(
    (app) => {
      app.use('/api/orders', orderRoutes({ saga, broker }));
    },
    {
      onStop: async () => {
        discovery.stop();
        await broker.close();
        await mongoose.disconnect();
      },
    },
  );
}

main().catch((err) => {
  logger.error('startup failed', { err: (err as Error).message });
  process.exit(1);
});
