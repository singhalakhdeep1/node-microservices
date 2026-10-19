import mongoose from 'mongoose';

export const ORDER_STATUSES = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled', 'failed'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Allowed status transitions (admin fulfilment flow + cancellation). */
export const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
  failed: [],
};

export interface SagaStep {
  step: string;
  status: 'ok' | 'failed' | 'compensated';
  detail?: string;
  at: Date;
}

export interface OrderAttrs {
  userId: string;
  customer: { name: string; email: string };
  items: { productId: string; productName: string; quantity: number; price: number }[];
  totalAmount: number;
  status: OrderStatus;
  shippingAddress?: { street?: string; city?: string; state?: string; zipCode?: string; country?: string };
  idempotencyKey?: string;
  failureReason?: string;
  saga: SagaStep[];
}

const orderSchema = new mongoose.Schema<OrderAttrs>(
  {
    userId: { type: String, required: true, index: true },
    customer: { _id: false, name: String, email: String },
    items: [
      {
        _id: false,
        productId: { type: String, required: true },
        productName: String,
        quantity: { type: Number, required: true, min: 1 },
        price: { type: Number, required: true, min: 0 },
      },
    ],
    totalAmount: { type: Number, required: true, min: 0 },
    status: { type: String, enum: ORDER_STATUSES, default: 'pending', index: true },
    shippingAddress: { _id: false, street: String, city: String, state: String, zipCode: String, country: String },
    idempotencyKey: { type: String, unique: true, sparse: true },
    failureReason: String,
    saga: [{ _id: false, step: String, status: String, detail: String, at: Date }],
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret: Record<string, unknown>) => {
        ret.id = String(ret._id);
        delete ret._id;
        delete ret.__v;
        delete ret.idempotencyKey;
        return ret;
      },
    },
  },
);

export const Order = mongoose.model<OrderAttrs>('Order', orderSchema);
