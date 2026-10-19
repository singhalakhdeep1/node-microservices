import { Router } from 'express';
import { createHash } from 'node:crypto';
import mongoose from 'mongoose';
import { z } from 'zod';
import { asyncHandler, Events, HttpError, requireAdmin, type Broker, type Cache, type Logger } from '@nms/shared';
import { Product, Reservation, type ReservationItem } from '../models/Product';

const productInput = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(5000),
  price: z.number().nonnegative(),
  stock: z.number().int().nonnegative(),
  category: z.string().trim().min(1).max(60),
  imageUrl: z.string().url().optional(),
  sku: z.string().trim().max(64).optional(),
});
const productUpdate = productInput.partial();
const reserveInput = z.object({
  orderId: z.string().min(1),
  items: z.array(z.object({ productId: z.string().min(1), quantity: z.number().int().positive() })).min(1),
});
const releaseInput = z.object({ orderId: z.string().min(1) });

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) throw new HttpError(400, 'Validation failed', r.error.flatten().fieldErrors);
  return r.data;
}

const TTL = Number(process.env.PRODUCT_CACHE_TTL ?? 300);
const LOW_STOCK = Number(process.env.LOW_STOCK_THRESHOLD ?? 5);
const productKey = (id: string) => `product:${id}`;
const LIST_PREFIX = 'products:list:';

function validId(id: string): void {
  if (!mongoose.isValidObjectId(id)) throw new HttpError(400, 'Invalid product id');
}

export function productRoutes({ broker, cache }: { broker: Broker; cache: Cache; logger: Logger }): Router {
  const router = Router();
  const invalidate = async (id?: string) => {
    await cache.delPrefix(LIST_PREFIX);
    if (id) await cache.del(productKey(id));
  };

  router.get('/', asyncHandler(async (req, res) => {
    const q = req.query as Record<string, string | undefined>;
    const page = Math.max(1, Number(q.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(q.limit ?? 12)));
    const key = LIST_PREFIX + createHash('sha1').update(JSON.stringify({ ...q, page, limit })).digest('hex');
    const { value, cached } = await cache.wrap(key, TTL, async () => {
      const filter: Record<string, unknown> = {};
      if (q.search) filter.$text = { $search: q.search };
      if (q.category) filter.category = q.category.toLowerCase();
      if (q.minPrice || q.maxPrice) filter.price = { ...(q.minPrice ? { $gte: Number(q.minPrice) } : {}), ...(q.maxPrice ? { $lte: Number(q.maxPrice) } : {}) };
      if (q.inStock === 'true') filter.stock = { $gt: 0 };
      const sort: Record<string, 1 | -1> =
        q.sort === 'price_asc' ? { price: 1 } : q.sort === 'price_desc' ? { price: -1 } : q.sort === 'name' ? { name: 1 } : { createdAt: -1 };
      const [products, total] = await Promise.all([
        Product.find(filter).sort(sort).skip((page - 1) * limit).limit(limit),
        Product.countDocuments(filter),
      ]);
      return { products: products.map((p) => p.toJSON()), pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
    });
    res.json({ success: true, data: value, cached });
  }));

  router.get('/categories', asyncHandler(async (_req, res) => {
    const { value } = await cache.wrap('products:categories', TTL, () => Product.distinct('category'));
    res.json({ success: true, data: value });
  }));

  router.get('/:id', asyncHandler(async (req, res) => {
    validId(req.params.id);
    const { value, cached } = await cache.wrap(productKey(req.params.id), TTL, async () => (await Product.findById(req.params.id))?.toJSON() ?? null);
    if (!value) throw new HttpError(404, 'Product not found');
    res.json({ success: true, data: value, cached });
  }));

  router.post('/', requireAdmin, asyncHandler(async (req, res) => {
    const product = await Product.create(parse(productInput, req.body));
    await invalidate();
    await cache.del('products:categories');
    await broker.publish(Events.PRODUCT_CREATED, { productId: product.id, name: product.name, price: product.price, stock: product.stock });
    res.status(201).json({ success: true, data: product });
  }));

  router.put('/:id', requireAdmin, asyncHandler(async (req, res) => {
    validId(req.params.id);
    const product = await Product.findByIdAndUpdate(req.params.id, parse(productUpdate, req.body), { new: true, runValidators: true });
    if (!product) throw new HttpError(404, 'Product not found');
    await invalidate(product.id);
    await cache.del('products:categories');
    await broker.publish(Events.PRODUCT_UPDATED, { productId: product.id, price: product.price, stock: product.stock });
    res.json({ success: true, data: product });
  }));

  router.delete('/:id', requireAdmin, asyncHandler(async (req, res) => {
    validId(req.params.id);
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product) throw new HttpError(404, 'Product not found');
    await invalidate(product.id);
    await cache.del('products:categories');
    await broker.publish(Events.PRODUCT_DELETED, { productId: product.id });
    res.json({ success: true, message: 'Product deleted' });
  }));

  return router;
}

/**
 * Saga participant endpoints, called by order-service only.
 * reserve: atomically decrements stock for every item (conditional update `stock >= qty`); if any
 * item fails, the already-decremented items are compensated and 409 is returned.
 * release: compensating action that puts reserved stock back. Both are idempotent per orderId.
 */
export function internalProductRoutes({ broker, cache, logger }: { broker: Broker; cache: Cache; logger: Logger }): Router {
  const router = Router();

  const restore = async (items: ReservationItem[]) => {
    for (const item of items) await Product.updateOne({ _id: item.productId }, { $inc: { stock: item.quantity } });
  };

  router.post('/reserve', asyncHandler(async (req, res) => {
    const { orderId, items } = parse(reserveInput, req.body);
    const existing = await Reservation.findOne({ orderId });
    if (existing) {
      res.json({ success: true, data: existing, idempotent: true });
      return;
    }
    const done: ReservationItem[] = [];
    const lowStock: { productId: string; name: string; stock: number }[] = [];
    for (const item of items) {
      if (!mongoose.isValidObjectId(item.productId)) {
        await restore(done);
        throw new HttpError(400, `Invalid product id ${item.productId}`);
      }
      const updated = await Product.findOneAndUpdate({ _id: item.productId, stock: { $gte: item.quantity } }, { $inc: { stock: -item.quantity } }, { new: true });
      if (!updated) {
        await restore(done);
        const product = await Product.findById(item.productId);
        throw new HttpError(409, product ? `Insufficient stock for ${product.name} (available ${product.stock})` : `Product ${item.productId} not found`, { productId: item.productId });
      }
      done.push(item);
      if (updated.stock <= LOW_STOCK) lowStock.push({ productId: updated.id, name: updated.name, stock: updated.stock });
    }
    try {
      const reservation = await Reservation.create({ orderId, items });
      for (const item of items) await cache.del(productKey(item.productId));
      await cache.delPrefix(LIST_PREFIX);
      for (const low of lowStock) await broker.publish(Events.STOCK_LOW, low);
      res.status(201).json({ success: true, data: reservation });
    } catch (err) {
      // A concurrent reserve for the same order won the unique index: undo ours and return theirs.
      await restore(done);
      if ((err as { code?: number }).code === 11000) {
        res.json({ success: true, data: await Reservation.findOne({ orderId }), idempotent: true });
        return;
      }
      throw err;
    }
  }));

  router.post('/release', asyncHandler(async (req, res) => {
    const { orderId } = parse(releaseInput, req.body);
    const reservation = await Reservation.findOneAndUpdate({ orderId, status: 'reserved' }, { status: 'released' }, { new: true });
    if (!reservation) {
      res.json({ success: true, data: await Reservation.findOne({ orderId }), idempotent: true });
      return;
    }
    await restore(reservation.items);
    for (const item of reservation.items) await cache.del(productKey(item.productId));
    await cache.delPrefix(LIST_PREFIX);
    logger.info('stock released', { orderId });
    res.json({ success: true, data: reservation });
  }));

  router.post('/lookup', asyncHandler(async (req, res) => {
    const ids = z.array(z.string()).max(100).parse(req.body?.ids ?? []).filter((id) => mongoose.isValidObjectId(id));
    const products = await Product.find({ _id: { $in: ids } });
    res.json({ success: true, data: products });
  }));

  return router;
}
