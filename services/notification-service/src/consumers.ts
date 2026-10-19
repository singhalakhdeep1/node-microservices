import { eventsCounter, Events, type Broker, type EventEnvelope, type Logger } from '@nms/shared';
import { Notification } from './models/Notification';
import { templates, type EmailService } from './email';

interface Recipient {
  userId: string;
  email: string;
}

export function registerConsumers(broker: Broker, email: EmailService, logger: Logger): Promise<void[]> {
  const deliver = async (evt: EventEnvelope, to: Recipient, mail: { subject: string; text: string; html: string }) => {
    eventsCounter.inc({ service: 'notification-service', direction: 'consumed', type: evt.type });
    if (await Notification.exists({ eventId: evt.id, to: to.email })) return; // redelivery
    let status: 'sent' | 'failed' | 'skipped' = 'failed';
    let error: string | undefined;
    try {
      status = await email.send({ to: to.email, ...mail });
    } catch (err) {
      error = (err as Error).message;
      logger.error('email failed', { to: to.email, type: evt.type, err: error });
    }
    await Notification.create({ eventId: evt.id, eventType: evt.type, userId: to.userId, to: to.email, subject: mail.subject, body: mail.text, status, error }).catch((err) => {
      if ((err as { code?: number }).code !== 11000) throw err;
    });
  };

  const admins = (): Recipient[] =>
    (process.env.ADMIN_EMAILS ?? '').split(',').map((e) => e.trim()).filter(Boolean).map((e) => ({ userId: 'admins', email: e }));

  return Promise.all([
    broker.subscribe<{ userId: string; email: string; name: string }>('notification.user-events', ['user.registered'], async (evt) => {
      await deliver(evt, { userId: evt.data.userId, email: evt.data.email }, templates.welcome(evt.data.name));
    }),

    broker.subscribe<{ orderId: string; userId: string; email: string; name: string; totalAmount: number; items: never[]; newStatus?: string }>(
      'notification.order-events',
      ['order.*'],
      async (evt) => {
        const d = evt.data;
        const to = { userId: d.userId, email: d.email };
        if (!d.email) return;
        if (evt.type === Events.ORDER_CREATED) await deliver(evt, to, templates.orderConfirmed(d.name, d.orderId, d.totalAmount, d.items));
        else if (evt.type === Events.ORDER_CANCELLED) await deliver(evt, to, templates.cancelled(d.name, d.orderId));
        else if (evt.type === Events.ORDER_STATUS_CHANGED && d.newStatus) await deliver(evt, to, templates.statusChanged(d.name, d.orderId, d.newStatus));
      },
    ),

    broker.subscribe<{ productId: string; name: string; stock: number }>('notification.inventory-events', ['product.stock_low'], async (evt) => {
      for (const admin of admins()) await deliver(evt, admin, templates.stockLow(evt.data.name, evt.data.stock));
    }),
  ]);
}
