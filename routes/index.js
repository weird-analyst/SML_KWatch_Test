const express = require('express');
const router = express.Router();

const kwatchRoutes = require('./kwatch');
const webhookRoutes = require('./webhook');
const itemsRoutes = require('./items'); // Testing routes
const healthRoutes = require('./health');
const classifyRoutes = require('./classify');

// Mount routes
router.use('/webhook', webhookRoutes);
router.use('/kwatch', kwatchRoutes);
router.use('/items', itemsRoutes);
router.use('/health', healthRoutes);
router.use('/classify', classifyRoutes);

module.exports = router;
