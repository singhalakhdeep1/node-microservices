/**
 * ORDER ROUTES WITH INTER-SERVICE COMMUNICATION
 * 
 * CURRICULUM COVERAGE:
 * #1241-1250: Order creation with service orchestration
 * #1311-1325: Circuit breaker for external service calls
 * #1341-1360: Saga pattern for distributed transactions
 */

const express = require('express');
const router = express.Router();
const axios = require('axios');
const Order = require('../models/Order');
const messageQueue = require('../config/messageQueue');

// Circuit Breaker state - #1311-1325
const circuitBreaker = {
    userService: { failures: 0, isOpen: false, lastFailure: null },
    productService: { failures: 0, isOpen: false, lastFailure: null }
};

const FAILURE_THRESHOLD = 5;
const TIMEOUT = 60000; // 1 minute

/**
 * #1311-1320: Circuit Breaker Pattern
 * Prevents cascading failures when a service is down
 */
function checkCircuit(service) {
    const breaker = circuitBreaker[service];

    if (breaker.isOpen) {
        const now = Date.now();
        if (now - breaker.lastFailure > TIMEOUT) {
            // Half-open: try again
            breaker.isOpen = false;
            breaker.failures = 0;
            console.log(`🔄 Circuit breaker for ${service} is now HALF-OPEN`);
        } else {
            throw new Error(`Circuit breaker is OPEN for ${service}`);
        }
    }
}

function recordSuccess(service) {
    circuitBreaker[service].failures = 0;
    circuitBreaker[service].isOpen = false;
}

function recordFailure(service) {
    const breaker = circuitBreaker[service];
    breaker.failures++;
    breaker.lastFailure = Date.now();

    if (breaker.failures >= FAILURE_THRESHOLD) {
        breaker.isOpen = true;
        console.log(`⚡ Circuit breaker OPENED for ${service} after ${breaker.failures} failures`);
    }
}

// Get all orders
router.get('/', async (req, res) => {
    try {
        const orders = await Order.find().sort('-createdAt');
        res.json({ success: true, data: orders });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get order by ID
router.get('/:id', async (req, res) => {
    try {
        const order = await Order.findById(req.params.id);
        if (!order) {
            return res.status(404).json({ success: false, error: 'Order not found' });
        }
        res.json({ success: true, data: order });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Create order - #1341-1360: Saga Pattern
 * Distributed transaction across multiple services
 */
router.post('/', async (req, res) => {
    try {
        const { userId, items, shippingAddress } = req.body;

        // Step 1: Verify user exists - #1241-1245: Inter-service call
        checkCircuit('userService');
        try {
            const userResponse = await axios.get(
                `${process.env.USER_SERVICE_URL}/api/users/${userId}`,
                { timeout: 5000 }
            );

            if (!userResponse.data.success) {
                return res.status(404).json({ success: false, error: 'User not found' });
            }
            recordSuccess('userService');
        } catch (error) {
            recordFailure('userService');
            return res.status(503).json({
                success: false,
                error: 'User service unavailable'
            });
        }

        // Step 2: Verify products exist and fetch prices
        checkCircuit('productService');
        const orderItems = [];
        let totalAmount = 0;

        try {
            for (const item of items) {
                const productResponse = await axios.get(
                    `${process.env.PRODUCT_SERVICE_URL}/api/products/${item.productId}`,
                    { timeout: 5000 }
                );

                if (!productResponse.data.success) {
                    throw new Error(`Product ${item.productId} not found`);
                }

                const product = productResponse.data.data;

                // Check stock
                if (product.stock < item.quantity) {
                    throw new Error(`Insufficient stock for ${product.name}`);
                }

                orderItems.push({
                    productId: product._id,
                    productName: product.name,
                    quantity: item.quantity,
                    price: product.price
                });

                totalAmount += product.price * item.quantity;
            }
            recordSuccess('productService');
        } catch (error) {
            recordFailure('productService');
            return res.status(400).json({
                success: false,
                error: error.message || 'Product service unavailable'
            });
        }

        // Step 3: Create order
        const order = await Order.create({
            userId,
            items: orderItems,
            totalAmount,
            shippingAddress,
            status: 'pending'
        });

        // Step 4: Publish ORDER_CREATED event - #1341-1350: Saga coordination
        await messageQueue.publish(
            messageQueue.exchanges.ORDER_EVENTS,
            'ORDER_CREATED',
            {
                orderId: order._id,
                userId,
                items: orderItems,
                totalAmount,
                timestamp: new Date().toISOString()
            }
        );

        // Step 5: Trigger notification
        await messageQueue.publish(
            messageQueue.exchanges.NOTIFICATION_EVENTS,
            'SEND_ORDER_CONFIRMATION',
            {
                orderId: order._id,
                userId,
                userEmail: 'user@example.com', // Would come from user service
                orderDetails: {
                    orderNumber: order._id,
                    totalAmount,
                    items: orderItems
                }
            }
        );

        console.log(`✅ Order created: ${order._id} - Saga completed successfully`);

        res.status(201).json({
            success: true,
            data: order,
            message: 'Order created and notifications sent'
        });
    } catch (error) {
        console.error('❌ Saga failed:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Update order status
router.put('/:id/status', async (req, res) => {
    try {
        const { status } = req.body;

        const order = await Order.findByIdAndUpdate(
            req.params.id,
            { status },
            { new: true, runValidators: true }
        );

        if (!order) {
            return res.status(404).json({ success: false, error: 'Order not found' });
        }

        // Publish status change event
        await messageQueue.publish(
            messageQueue.exchanges.ORDER_EVENTS,
            'ORDER_STATUS_CHANGED',
            {
                orderId: order._id,
                newStatus: status,
                timestamp: new Date().toISOString()
            }
        );

        res.json({ success: true, data: order });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

module.exports = router;
