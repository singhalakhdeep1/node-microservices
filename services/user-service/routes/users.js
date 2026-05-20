/**
 * USER ROUTES
 * 
 * CURRICULUM COVERAGE:
 * #1201-1210: User service endpoints
 * #1271-1275: Publishing user events to message queue
 */

const express = require('express');
const router = express.Router();
const User = require('../models/User');
const messageQueue = require('../config/messageQueue');
const redis = require('../config/redis');

// Register user
router.post('/register', async (req, res) => {
    try {
        const { name, email, password } = req.body;

        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({
                success: false,
                error: 'User already exists'
            });
        }

        const user = await User.create({ name, email, password });
        const token = user.generateToken();

        // #1271-1275: Publish USER_CREATED event to RabbitMQ
        await messageQueue.publish(
            messageQueue.exchanges.USER_EVENTS,
            'USER_CREATED',
            {
                userId: user._id,
                email: user.email,
                name: user.name
            }
        );

        res.status(201).json({
            success: true,
            token,
            data: {
                id: user._id,
                name: user.name,
                email: user.email
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Login user
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        const user = await User.findOne({ email }).select('+password');
        if (!user || !(await user.comparePassword(password))) {
            return res.status(401).json({
                success: false,
                error: 'Invalid credentials'
            });
        }

        const token = user.generateToken();

        res.json({
            success: true,
            token,
            data: {
                id: user._id,
                name: user.name,
                email: user.email
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get user by ID - #1276-1285: Redis caching
router.get('/:id', async (req, res) => {
    try {
        const cacheKey = `user:${req.params.id}`;

        // Check cache first
        const cached = await redis.get(cacheKey);
        if (cached) {
            return res.json({
                success: true,
                data: JSON.parse(cached),
                cached: true
            });
        }

        // Get from database
        const user = await User.findById(req.params.id);
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        // Cache for 1 hour
        await redis.setEx(cacheKey, 3600, JSON.stringify(user));

        res.json({
            success: true,
            data: user,
            cached: false
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;
