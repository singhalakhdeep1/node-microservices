import mongoose from 'mongoose';

const toJSON = {
  transform: (_doc: unknown, ret: Record<string, unknown>) => {
    ret.id = String(ret._id);
    delete ret._id;
    delete ret.__v;
    return ret;
  },
};

export interface ProductAttrs {
  name: string;
  description: string;
  price: number;
  stock: number;
  category: string;
  imageUrl?: string;
  sku?: string;
}

const productSchema = new mongoose.Schema<ProductAttrs>(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, required: true, maxlength: 5000 },
    price: { type: Number, required: true, min: 0 },
    stock: { type: Number, required: true, min: 0, default: 0 },
    category: { type: String, required: true, trim: true, lowercase: true, index: true },
    imageUrl: { type: String },
    sku: { type: String, unique: true, sparse: true },
  },
  { timestamps: true, toJSON },
);
productSchema.index({ name: 'text', description: 'text' });

export const Product = mongoose.model<ProductAttrs>('Product', productSchema);

export interface ReservationItem {
  productId: string;
  quantity: number;
}

export interface ReservationAttrs {
  orderId: string;
  items: ReservationItem[];
  status: 'reserved' | 'released';
}

// One reservation per order makes reserve/release idempotent under retries.
const reservationSchema = new mongoose.Schema<ReservationAttrs>(
  {
    orderId: { type: String, required: true, unique: true },
    items: [{ _id: false, productId: { type: String, required: true }, quantity: { type: Number, required: true, min: 1 } }],
    status: { type: String, enum: ['reserved', 'released'], default: 'reserved' },
  },
  { timestamps: true, toJSON },
);

export const Reservation = mongoose.model<ReservationAttrs>('Reservation', reservationSchema);
