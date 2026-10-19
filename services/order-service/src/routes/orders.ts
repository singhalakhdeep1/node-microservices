import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { asyncHandler, Events, HttpError, requireAdmin, requireUser, type Broker } from '@nms/shared';
import { Order, ORDER_STATUSES, TRANSITIONS, type OrderStatus } from '../models/Order';
import type { OrderSaga } from '../saga';

const createSchema = z.object({
  items: z.array(z.object({ productId: z.string().min(1), quantity: z.number().int().positive().max(1000) })).min(1).max(50),
  shippingAddress: z
    .object({
      street: z.string().max(200).optional(),
      city: z.string().max(100).optional(),
      state: z.string().max(100).optional(),
      zipCode: z.string().max(20).optional(),
      country: z.string().max(100).optional(),
    })
    .optional(),
});
const statusSchema = z.object({ status: z.enum(ORDER_STATUSES) });

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) throw new HttpError(400, 'Validation failed', r.error.flatten().fieldErrors);
  return r.data;
}

export function orderRoutes({ saga, broker }: { saga: OrderSaga; broker: Broker }): Router {
  const router = Router();
  router.use(requireUser);

  const load = async (id: string, user: { id: string; role: string }) => {
    if (!mongoose.isValidObjectId(id)) throw new HttpError(400, 'Invalid order id');
    const order = await Order.findById(id);
    if (!order || (order.userId !== user.id && user.role !== 'admin')) throw new HttpError(404, 'Order not found');
    return order;
  };

  const setStatus = async (order: InstanceType<typeof Order>, next: OrderStatus, actor: string) => {
    if (!TRANSITIONS[order.status].includes(next)) throw new HttpError(409, `Cannot move order from ${order.status} to ${next}`);
    const previous = order.status;
    if (next === 'cancelled') {
      const released = await saga.releaseStock(order.id);
      order.saga.push({ step: 'release-stock', status: released ? 'compensated' : 'failed', at: new Date() });
      if (!released) throw new HttpError(503, 'Could not release stock; try again');
    }
    order.status = next;
    order.saga.push({ step: `status:${next}`, status: 'ok', detail: `by ${actor}`, at: new Date() });
    await order.save();
    await broker.publish(next === 'cancelled' ? Events.ORDER_CANCELLED : Events.ORDER_STATUS_CHANGED, {
      orderId: order.id,
      userId: order.userId,
      email: order.customer?.email,
      name: order.customer?.name,
      previousStatus: previous,
      newStatus: next,
      totalAmount: order.totalAmount,
    }, order.id);
    return order;
  };

  router.get('/', asyncHandler(async (req, res) => {
    const page = Math.max(1, Number(req.query.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 20)));
    const filter: Record<string, unknown> = req.user!.role === 'admin' && req.query.all === 'true' ? {} : { userId: req.user!.id };
    if (typeof req.query.status === 'string') filter.status = req.query.status;
    const [orders, total] = await Promise.all([
      Order.find(filter).sort('-createdAt').skip((page - 1) * limit).limit(limit),
      Order.countDocuments(filter),
    ]);
    res.json({ success: true, data: { orders, pagination: { page, limit, total, pages: Math.ceil(total / limit) } } });
  }));

  router.get('/stats', requireAdmin, asyncHandler(async (_req, res) => {
    const rows = await Order.aggregate<{ _id: string; count: number; revenue: number }>([
      { $group: { _id: '$status', count: { $sum: 1 }, revenue: { $sum: '$totalAmount' } } },
    ]);
    res.json({ success: true, data: rows.map((r) => ({ status: r._id, count: r.count, revenue: Math.round(r.revenue * 100) / 100 })) });
  }));

  router.get('/:id', asyncHandler(async (req, res) => {
    res.json({ success: true, data: await load(req.params.id, req.user!) });
  }));

  router.post('/', asyncHandler(async (req, res) => {
    const input = parse(createSchema, req.body);
    const key = req.header('idempotency-key');
    const { order, replayed } = await saga.createOrder({
      userId: req.user!.id,
      items: input.items,
      shippingAddress: input.shippingAddress,
      idempotencyKey: key ? `${req.user!.id}:${key.slice(0, 100)}` : undefined,
    });
    res.status(replayed ? 200 : 201).json({ success: true, data: order, replayed });
  }));

  router.post('/:id/cancel', asyncHandler(async (req, res) => {
    const order = await load(req.params.id, req.user!);
    res.json({ success: true, data: await setStatus(order, 'cancelled', req.user!.email) });
  }));

  router.put('/:id/status', requireAdmin, asyncHandler(async (req, res) => {
    const { status } = parse(statusSchema, req.body);
    const order = await load(req.params.id, req.user!);
    res.json({ success: true, data: await setStatus(order, status, req.user!.email) });
  }));

  return router;
}
