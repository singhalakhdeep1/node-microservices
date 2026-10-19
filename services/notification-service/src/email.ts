import nodemailer, { type Transporter } from 'nodemailer';
import type { Logger } from '@nms/shared';

export interface Mail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * SMTP mailer. Without EMAIL_HOST it uses nodemailer's JSON transport, which renders the message
 * but does not deliver it (the notification is stored with status "skipped").
 */
export class EmailService {
  private transporter: Transporter;
  readonly delivering: boolean;

  constructor(private readonly logger: Logger) {
    this.delivering = Boolean(process.env.EMAIL_HOST);
    this.transporter = this.delivering
      ? nodemailer.createTransport({
          host: process.env.EMAIL_HOST,
          port: Number(process.env.EMAIL_PORT ?? 587),
          secure: Number(process.env.EMAIL_PORT) === 465,
          auth: process.env.EMAIL_USER ? { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS } : undefined,
        })
      : nodemailer.createTransport({ jsonTransport: true });
  }

  async send(mail: Mail): Promise<'sent' | 'skipped'> {
    await this.transporter.sendMail({ from: process.env.EMAIL_FROM ?? '"Node Microservices" <noreply@example.com>', ...mail });
    this.logger.info(this.delivering ? 'email sent' : 'email rendered (EMAIL_HOST not set, not delivered)', { to: mail.to, subject: mail.subject });
    return this.delivering ? 'sent' : 'skipped';
  }

  async verify(): Promise<string> {
    if (!this.delivering) return 'disabled';
    await this.transporter.verify();
    return 'connected';
  }
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const money = (n: unknown) => `$${Number(n ?? 0).toFixed(2)}`;

interface OrderItem {
  productName: string;
  quantity: number;
  price: number;
}

export const templates = {
  welcome: (name: string) => ({
    subject: 'Welcome!',
    text: `Hi ${name}, thanks for registering.`,
    html: `<h1>Welcome ${esc(name)}!</h1><p>Thanks for registering with Node Microservices.</p>`,
  }),
  orderConfirmed: (name: string, orderId: string, total: number, items: OrderItem[]) => ({
    subject: `Order ${orderId} confirmed`,
    text: `Hi ${name}, your order ${orderId} (${money(total)}) is confirmed.\n${items.map((i) => `- ${i.quantity} x ${i.productName}`).join('\n')}`,
    html: `<h1>Order confirmed</h1><p>Hi ${esc(name)}, order <b>${esc(orderId)}</b> is confirmed.</p><ul>${items
      .map((i) => `<li>${i.quantity} &times; ${esc(i.productName)} (${money(i.price)})</li>`)
      .join('')}</ul><p>Total: <b>${money(total)}</b></p>`,
  }),
  statusChanged: (name: string, orderId: string, status: string) => ({
    subject: `Order ${orderId} is now ${status}`,
    text: `Hi ${name}, order ${orderId} is now ${status}.`,
    html: `<p>Hi ${esc(name)}, order <b>${esc(orderId)}</b> is now <b>${esc(status)}</b>.</p>`,
  }),
  cancelled: (name: string, orderId: string) => ({
    subject: `Order ${orderId} cancelled`,
    text: `Hi ${name}, order ${orderId} was cancelled and any payment hold released.`,
    html: `<p>Hi ${esc(name)}, order <b>${esc(orderId)}</b> was cancelled.</p>`,
  }),
  stockLow: (product: string, stock: number) => ({
    subject: `Low stock: ${product}`,
    text: `${product} has ${stock} unit(s) left.`,
    html: `<p><b>${esc(product)}</b> has <b>${stock}</b> unit(s) left.</p>`,
  }),
};
