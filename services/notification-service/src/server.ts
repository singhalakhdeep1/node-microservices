/**
 * Notification service: consumes user/order/inventory events from RabbitMQ, sends email, keeps a
 * per-user notification inbox (MongoDB) exposed through the gateway.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { Router } from 'express';
import { asyncHandler, createBroker, createService, HttpError, requireUser } from '@nms/shared';
import { EmailService } from './email';
import { registerConsumers } from './consumers';
import { Notification } from './models/Notification';

const NAME = 'notification-service';
const service = createService({
  name: NAME,
  port: Number(process.env.PORT ?? 3004),
  critical: ['mongodb'],
  health: {
    mongodb: () => (mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'),
    rabbitmq: () => (broker.kind === 'memory' ? 'disabled' : broker.isConnected() ? 'connected' : 'disconnected'),
    smtp: () => (email.delivering ? 'ok' : 'disabled'),
  },
});
const { logger } = service;
const broker = createBroker(NAME, logger);
const email = new EmailService(logger);

function notificationRoutes(): Router {
  const router = Router();
  router.use(requireUser);

  router.get('/', asyncHandler(async (req, res) => {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 50)));
    const filter =
      req.user!.role === 'admin' && req.query.all === 'true'
        ? {}
        : { userId: req.user!.role === 'admin' ? { $in: [req.user!.id, 'admins'] } : req.user!.id };
    const [items, unread] = await Promise.all([
      Notification.find(filter).sort('-createdAt').limit(limit),
      Notification.countDocuments({ ...filter, read: false }),
    ]);
    res.json({ success: true, data: { notifications: items, unread } });
  }));

  router.patch('/:id/read', asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(400, 'Invalid id');
    const owners = req.user!.role === 'admin' ? [req.user!.id, 'admins'] : [req.user!.id];
    const n = await Notification.findOneAndUpdate({ _id: req.params.id, userId: { $in: owners } }, { read: true }, { new: true });
    if (!n) throw new HttpError(404, 'Notification not found');
    res.json({ success: true, data: n });
  }));

  router.post('/read-all', asyncHandler(async (req, res) => {
    const owners = req.user!.role === 'admin' ? [req.user!.id, 'admins'] : [req.user!.id];
    const r = await Notification.updateMany({ userId: { $in: owners }, read: false }, { read: true });
    res.json({ success: true, data: { updated: r.modifiedCount } });
  }));

  return router;
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI ?? 'mongodb://localhost:27017/notifications');
  logger.info('MongoDB connected');
  await registerConsumers(broker, email, logger);
  await broker.connect();
  if (broker.kind === 'memory') logger.warn('RABBITMQ_URL not set: no events from other services will arrive');

  await service.start((app) => app.use('/api/notifications', notificationRoutes()), {
    onStop: async () => {
      await broker.close();
      await mongoose.disconnect();
    },
  });
}

main().catch((err) => {
  logger.error('startup failed', { err: (err as Error).message });
  process.exit(1);
});
