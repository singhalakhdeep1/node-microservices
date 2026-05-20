const nodemailer = require('nodemailer');
const winston = require('winston');

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.simple(),
    transports: [new winston.transports.Console()]
});

const transporter = nodemailer.createTransporter({
    host: process.env.EMAIL_HOST,
    port: process.env.EMAIL_PORT,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

class EmailService {
    async sendWelcomeEmail(email, name) {
        try {
            await transporter.sendMail({
                from: '"Microservices App" <noreply@microservices.com>',
                to: email,
                subject: 'Welcome!',
                html: `
          <h1>Welcome ${name}!</h1>
          <p>Thank you for registering with our microservices application.</p>
        `
            });
            logger.info(`✅ Welcome email sent to ${email}`);
        } catch (error) {
            logger.error('Email send failed:', error);
        }
    }

    async sendOrderConfirmation(email, orderDetails) {
        try {
            await transporter.sendMail({
                from: '"Microservices App" <noreply@microservices.com>',
                to: email,
                subject: 'Order Confirmation',
                html: `
          <h1>Order Confirmed!</h1>
          <p>Order #${orderDetails.orderNumber}</p>
          <p>Total: $${orderDetails.totalAmount}</p>
          <p>Items: ${orderDetails.items.length}</p>
        `
            });
            logger.info(`✅ Order confirmation sent to ${email}`);
        } catch (error) {
            logger.error('Email send failed:', error);
        }
    }
}

module.exports = new EmailService();
