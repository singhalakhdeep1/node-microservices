'use client';

import { useState } from 'react';

export default function MicroservicesTestDashboard() {
    const [users, setUsers] = useState([]);
    const [products, setProducts] = useState([]);
    const [orders, setOrders] = useState([]);
    const [health, setHealth] = useState({});
    const [loading, setLoading] = useState({});

    const API_GATEWAY = 'http://localhost:3000';

    // User Operations
    const createUser = async () => {
        setLoading(prev => ({ ...prev, createUser: true }));
        try {
            const res = await fetch(`${API_GATEWAY}/api/users/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: `User ${Date.now()}`,
                    email: `user${Date.now()}@test.com`,
                    password: 'password123'
                })
            });
            const data = await res.json();
            alert(data.success ? 'User created!' : `Error: ${data.error}`);
            fetchUsers();
        } catch (error) {
            alert('Error: ' + error.message);
        } finally {
            setLoading(prev => ({ ...prev, createUser: false }));
        }
    };

    const fetchUsers = async () => {
        setLoading(prev => ({ ...prev, users: true }));
        try {
            const res = await fetch(`${API_GATEWAY}/api/users`);
            const data = await res.json();
            setUsers(data.data || []);
        } catch (error) {
            console.error('Error fetching users:', error);
        } finally {
            setLoading(prev => ({ ...prev, users: false }));
        }
    };

    // Product Operations
    const createProduct = async () => {
        setLoading(prev => ({ ...prev, createProduct: true }));
        try {
            const res = await fetch(`${API_GATEWAY}/api/products`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: `Product ${Date.now()}`,
                    description: 'Test product from frontend',
                    price: Math.floor(Math.random() * 1000) + 100,
                    stock: Math.floor(Math.random() * 100) + 10,
                    category: 'Electronics'
                })
            });
            const data = await res.json();
            alert(data.success ? 'Product created!' : `Error: ${data.error}`);
            fetchProducts();
        } catch (error) {
            alert('Error: ' + error.message);
        } finally {
            setLoading(prev => ({ ...prev, createProduct: false }));
        }
    };

    const fetchProducts = async () => {
        setLoading(prev => ({ ...prev, products: true }));
        try {
            const res = await fetch(`${API_GATEWAY}/api/products`);
            const data = await res.json();
            setProducts(data.data || []);
        } catch (error) {
            console.error('Error fetching products:', error);
        } finally {
            setLoading(prev => ({ ...prev, products: false }));
        }
    };

    // Order Operations (Saga Pattern Test)
    const createOrder = async () => {
        if (users.length === 0 || products.length === 0) {
            alert('Please create users and products first!');
            return;
        }

        setLoading(prev => ({ ...prev, createOrder: true }));
        try {
            const userId = users[0]._id;
            const productId = products[0]._id;

            const res = await fetch(`${API_GATEWAY}/api/orders`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId,
                    items: [{ productId, quantity: 2 }],
                    shippingAddress: {
                        street: '123 Test St',
                        city: 'Test City',
                        zipCode: '12345'
                    }
                })
            });
            const data = await res.json();
            alert(data.success ? 'Order created (Saga executed)!' : `Error: ${data.error}`);
            fetchOrders();
        } catch (error) {
            alert('Error: ' + error.message);
        } finally {
            setLoading(prev => ({ ...prev, createOrder: false }));
        }
    };

    const fetchOrders = async () => {
        setLoading(prev => ({ ...prev, orders: true }));
        try {
            const res = await fetch(`${API_GATEWAY}/api/orders`);
            const data = await res.json();
            setOrders(data.data || []);
        } catch (error) {
            console.error('Error fetching orders:', error);
        } finally {
            setLoading(prev => ({ ...prev, orders: false }));
        }
    };

    // Health Check
    const checkHealth = async () => {
        setLoading(prev => ({ ...prev, health: true }));
        try {
            const res = await fetch(`${API_GATEWAY}/health`);
            const data = await res.json();
            setHealth(data);
        } catch (error) {
            setHealth({ error: error.message });
        } finally {
            setLoading(prev => ({ ...prev, health: false }));
        }
    };

    return (
        <div style={{ padding: '40px', fontFamily: 'system-ui', maxWidth: '1400px', margin: '0 auto' }}>
            <h1 style={{ fontSize: '32px', fontWeight: 'bold', marginBottom: '10px' }}>🏗️ Microservices Test Dashboard</h1>
            <p style={{ color: '#666', marginBottom: '30px' }}>
                Testing API Gateway, User Service, Product Service, Order Service, RabbitMQ, Circuit Breaker, Saga Pattern
            </p>

            {/* Health Check */}
            <div style={{ marginBottom: '30px', padding: '20px', background: '#f5f5f5', borderRadius: '8px' }}>
                <h2 style={{ fontSize: '20px', marginBottom: '15px' }}>🔍 System Health</h2>
                <button
                    onClick={checkHealth}
                    disabled={loading.health}
                    style={{
                        padding: '10px 20px',
                        background: '#10b981',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: loading.health ? 'not-allowed' : 'pointer',
                        opacity: loading.health ? 0.6 : 1
                    }}
                >
                    {loading.health ? 'Checking...' : 'Check All Services'}
                </button>
                {Object.keys(health).length > 0 && (
                    <pre style={{
                        marginTop: '15px',
                        padding: '15px',
                        background: 'white',
                        borderRadius: '6px',
                        overflow: 'auto',
                        fontSize: '13px'
                    }}>
                        {JSON.stringify(health, null, 2)}
                    </pre>
                )}
            </div>

            {/* User Service */}
            <div style={{ marginBottom: '30px', padding: '20px', background: '#eff6ff', borderRadius: '8px' }}>
                <h2 style={{ fontSize: '20px', marginBottom: '15px' }}>👥 User Service</h2>
                <div style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
                    <button
                        onClick={createUser}
                        disabled={loading.createUser}
                        style={{
                            padding: '10px 20px',
                            background: '#3b82f6',
                            color: 'white',
                            border: 'none',
                            borderRadius: '6px',
                            cursor: loading.createUser ? 'not-allowed' : 'pointer',
                            opacity: loading.createUser ? 0.6 : 1
                        }}
                    >
                        {loading.createUser ? 'Creating...' : 'Create User'}
                    </button>
                    <button
                        onClick={fetchUsers}
                        disabled={loading.users}
                        style={{
                            padding: '10px 20px',
                            background: '#6366f1',
                            color: 'white',
                            border: 'none',
                            borderRadius: '6px',
                            cursor: loading.users ? 'not-allowed' : 'pointer',
                            opacity: loading.users ? 0.6 : 1
                        }}
                    >
                        {loading.users ? 'Loading...' : 'Fetch Users'}
                    </button>
                </div>
                <div style={{ fontSize: '14px', color: '#666' }}>Users: {users.length}</div>
                {users.length > 0 && (
                    <div style={{ marginTop: '10px', maxHeight: '200px', overflow: 'auto' }}>
                        {users.map(user => (
                            <div key={user._id} style={{
                                padding: '10px',
                                background: 'white',
                                marginBottom: '8px',
                                borderRadius: '6px',
                                fontSize: '13px'
                            }}>
                                <strong>{user.name}</strong> - {user.email}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Product Service */}
            <div style={{ marginBottom: '30px', padding: '20px', background: '#f0fdf4', borderRadius: '8px' }}>
                <h2 style={{ fontSize: '20px', marginBottom: '15px' }}>📦 Product Service</h2>
                <div style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
                    <button
                        onClick={createProduct}
                        disabled={loading.createProduct}
                        style={{
                            padding: '10px 20px',
                            background: '#10b981',
                            color: 'white',
                            border: 'none',
                            borderRadius: '6px',
                            cursor: loading.createProduct ? 'not-allowed' : 'pointer',
                            opacity: loading.createProduct ? 0.6 : 1
                        }}
                    >
                        {loading.createProduct ? 'Creating...' : 'Create Product'}
                    </button>
                    <button
                        onClick={fetchProducts}
                        disabled={loading.products}
                        style={{
                            padding: '10px 20px',
                            background: '#14b8a6',
                            color: 'white',
                            border: 'none',
                            borderRadius: '6px',
                            cursor: loading.products ? 'not-allowed' : 'pointer',
                            opacity: loading.products ? 0.6 : 1
                        }}
                    >
                        {loading.products ? 'Loading...' : 'Fetch Products'}
                    </button>
                </div>
                <div style={{ fontSize: '14px', color: '#666' }}>Products: {products.length}</div>
                {products.length > 0 && (
                    <div style={{ marginTop: '10px', maxHeight: '200px', overflow: 'auto' }}>
                        {products.map(product => (
                            <div key={product._id} style={{
                                padding: '10px',
                                background: 'white',
                                marginBottom: '8px',
                                borderRadius: '6px',
                                fontSize: '13px'
                            }}>
                                <strong>{product.name}</strong> - ${product.price} (Stock: {product.stock})
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Order Service (Saga Pattern) */}
            <div style={{ marginBottom: '30px', padding: '20px', background: '#fef3c7', borderRadius: '8px' }}>
                <h2 style={{ fontSize: '20px', marginBottom: '15px' }}>🛒 Order Service (Saga Pattern)</h2>
                <div style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
                    <button
                        onClick={createOrder}
                        disabled={loading.createOrder}
                        style={{
                            padding: '10px 20px',
                            background: '#f59e0b',
                            color: 'white',
                            border: 'none',
                            borderRadius: '6px',
                            cursor: loading.createOrder ? 'not-allowed' : 'pointer',
                            opacity: loading.createOrder ? 0.6 : 1
                        }}
                    >
                        {loading.createOrder ? 'Creating...' : 'Create Order (Test Saga)'}
                    </button>
                    <button
                        onClick={fetchOrders}
                        disabled={loading.orders}
                        style={{
                            padding: '10px 20px',
                            background: '#d97706',
                            color: 'white',
                            border: 'none',
                            borderRadius: '6px',
                            cursor: loading.orders ? 'not-allowed' : 'pointer',
                            opacity: loading.orders ? 0.6 : 1
                        }}
                    >
                        {loading.orders ? 'Loading...' : 'Fetch Orders'}
                    </button>
                </div>
                <div style={{ fontSize: '14px', color: '#666' }}>Orders: {orders.length}</div>
                {orders.length > 0 && (
                    <div style={{ marginTop: '10px', maxHeight: '200px', overflow: 'auto' }}>
                        {orders.map(order => (
                            <div key={order._id} style={{
                                padding: '10px',
                                background: 'white',
                                marginBottom: '8px',
                                borderRadius: '6px',
                                fontSize: '13px'
                            }}>
                                <strong>Order #{order._id.slice(-6)}</strong> - ${order.totalAmount} ({order.status})
                                <div style={{ fontSize: '12px', color: '#666', marginTop: '5px' }}>
                                    Items: {order.items.length} | User: {order.userId.slice(-6)}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Testing Notes */}
            <div style={{ marginTop: '40px', padding: '20px', background: '#f3f4f6', borderRadius: '8px' }}>
                <h3 style={{ fontSize: '18px', marginBottom: '15px' }}>📝 Testing Notes</h3>
                <ul style={{ fontSize: '14px', lineHeight: '1.8', color: '#374151' }}>
                    <li><strong>API Gateway:</strong> Routes requests to appropriate microservices (localhost:3000)</li>
                    <li><strong>Circuit Breaker:</strong> Prevents cascading failures when services are down</li>
                    <li><strong>Saga Pattern:</strong> Order creation triggers distributed transaction across User, Product services</li>
                    <li><strong>RabbitMQ:</strong> Events published to message queue (USER_CREATED, ORDER_CREATED)</li>
                    <li><strong>Notification Service:</strong> Consumes events and sends emails (check console logs)</li>
                    <li><strong>Redis Caching:</strong> User lookups cached for 1 hour</li>
                    <li><strong>Service Discovery:</strong> Health checks monitor all services</li>
                </ul>
            </div>
        </div>
    );
}
