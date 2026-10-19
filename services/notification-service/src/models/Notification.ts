import mongoose from 'mongoose';

export interface NotificationAttrs {
  eventId: string;
  eventType: string;
  /** Recipient user id, or "admins" for operational alerts. */
  userId: string;
  channel: 'email';
  to: string;
  subject: string;
  body: string;
  status: 'sent' | 'failed' | 'skipped';
  error?: string;
  read: boolean;
}

const schema = new mongoose.Schema<NotificationAttrs>(
  {
    eventId: { type: String, required: true },
    eventType: { type: String, required: true },
    userId: { type: String, required: true, index: true },
    channel: { type: String, default: 'email' },
    to: { type: String, required: true },
    subject: { type: String, required: true },
    body: { type: String, required: true },
    status: { type: String, enum: ['sent', 'failed', 'skipped'], required: true },
    error: String,
    read: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret: Record<string, unknown>) => {
        ret.id = String(ret._id);
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  },
);
// Redelivered events must not send a second email to the same recipient.
schema.index({ eventId: 1, to: 1 }, { unique: true });

export const Notification = mongoose.model<NotificationAttrs>('Notification', schema);
