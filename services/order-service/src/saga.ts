/**
 * Create-order saga (orchestration). Steps:
 *   1. verify the buyer       (user-service, GET /internal/users/:id)
 *   2. price the items        (product-service, POST /internal/products/lookup)
 *   3. persist order=pending
 *   4. reserve stock          (product-service, POST /internal/products/reserve)
 *   5. confirm + emit order.created
 * If step 4 fails the order is marked `failed` and the compensating release is issued (it is a
 * no-op when nothing was reserved), so stock is never left decremented for a failed order.
 */
import { Events, HttpError, ServiceUnavailableError, type Broker, type Logger, type ServiceClient } from '@nms/shared';
import { Order, type SagaStep } from './models/Order';

export interface CreateOrderInput {
  userId: string;
  items: { productId: string; quantity: number }[];
  shippingAddress?: Record<string, string>;
  idempotencyKey?: string;
}

interface UserDto {
  id: string;
  name: string;
  email: string;
}
interface ProductDto {
  id: string;
  name: string;
  price: number;
  stock: number;
}

const step = (name: string, status: SagaStep['status'], detail?: string): SagaStep => ({ step: name, status, detail, at: new Date() });

export class OrderSaga {
  constructor(
    private readonly users: ServiceClient,
    private readonly products: ServiceClient,
    private readonly broker: Broker,
    private readonly logger: Logger,
  ) {}

  async releaseStock(orderId: string): Promise<boolean> {
    try {
      const res = await this.products.request('/internal/products/release', { method: 'POST', body: { orderId }, retries: 2 });
      return res.status < 300;
    } catch (err) {
      this.logger.error('stock release failed; needs retry', { orderId, err: (err as Error).message });
      return false;
    }
  }

  async createOrder(input: CreateOrderInput) {
    if (input.idempotencyKey) {
      const existing = await Order.findOne({ idempotencyKey: input.idempotencyKey });
      if (existing) return { order: existing, replayed: true };
    }

    // Merge duplicate lines so one product is reserved once.
    const quantities = new Map<string, number>();
    for (const item of input.items) quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.quantity);

    // 1. buyer
    const userRes = await this.users.request<{ data?: UserDto }>(`/internal/users/${encodeURIComponent(input.userId)}`);
    if (userRes.status === 404 || !userRes.body.data) throw new HttpError(400, 'User not found');
    const user = userRes.body.data;

    // 2. prices
    const productRes = await this.products.request<{ data: ProductDto[] }>('/internal/products/lookup', {
      method: 'POST',
      body: { ids: [...quantities.keys()] },
      retries: 2,
    });
    const byId = new Map(productRes.body.data.map((p) => [p.id, p]));
    const missing = [...quantities.keys()].filter((id) => !byId.has(id));
    if (missing.length) throw new HttpError(400, `Unknown product(s): ${missing.join(', ')}`);
    const items = [...quantities].map(([productId, quantity]) => {
      const p = byId.get(productId)!;
      if (p.stock < quantity) throw new HttpError(409, `Insufficient stock for ${p.name} (available ${p.stock})`);
      return { productId, productName: p.name, quantity, price: p.price };
    });
    const totalAmount = Math.round(items.reduce((sum, i) => sum + i.price * i.quantity, 0) * 100) / 100;

    // 3. pending order
    let order;
    try {
      order = await Order.create({
        userId: user.id,
        customer: { name: user.name, email: user.email },
        items,
        totalAmount,
        status: 'pending',
        shippingAddress: input.shippingAddress,
        idempotencyKey: input.idempotencyKey,
        saga: [step('verify-user', 'ok'), step('price-items', 'ok', `total ${totalAmount}`)],
      });
    } catch (err) {
      if ((err as { code?: number }).code === 11000 && input.idempotencyKey) {
        return { order: (await Order.findOne({ idempotencyKey: input.idempotencyKey }))!, replayed: true };
      }
      throw err;
    }

    // 4. reserve stock
    try {
      const res = await this.products.request<{ error?: string }>('/internal/products/reserve', {
        method: 'POST',
        body: { orderId: order.id, items: items.map(({ productId, quantity }) => ({ productId, quantity })) },
      });
      if (res.status >= 300) {
        order.status = 'failed';
        order.failureReason = res.body.error ?? 'Stock reservation rejected';
        order.saga.push(step('reserve-stock', 'failed', order.failureReason));
        await order.save();
        throw new HttpError(res.status === 409 ? 409 : 400, order.failureReason, { orderId: order.id });
      }
    } catch (err) {
      if (err instanceof ServiceUnavailableError) {
        // The reserve may have been applied before the timeout: compensate.
        const released = await this.releaseStock(order.id);
        order.status = 'failed';
        order.failureReason = 'Product service unavailable';
        order.saga.push(step('reserve-stock', 'failed', err.message), step('release-stock', released ? 'compensated' : 'failed'));
        await order.save();
      }
      throw err;
    }

    // 5. confirm
    order.status = 'confirmed';
    order.saga.push(step('reserve-stock', 'ok'), step('confirm', 'ok'));
    await order.save();
    await this.broker.publish(Events.ORDER_CREATED, {
      orderId: order.id,
      userId: user.id,
      email: user.email,
      name: user.name,
      items,
      totalAmount,
    }, order.id);
    this.logger.info('order saga completed', { orderId: order.id, totalAmount });
    return { order, replayed: false };
  }
}
