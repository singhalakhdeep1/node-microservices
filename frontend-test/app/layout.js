export const metadata = {
    title: 'Microservices Test Dashboard',
    description: 'Test API Gateway, Circuit Breaker, Saga Pattern, RabbitMQ',
};

export default function RootLayout({ children }) {
    return (
        <html lang="en">
            <body style={{ margin: 0, padding: 0 }}>{children}</body>
        </html>
    );
}
