const express = require('express');
const router = express.Router();
const { getClassifierStatus, reloadQueries } = require('../services/brandClassifier');
const { getQueueStatus } = require('../services/kwatchQueue');

// GET /api/health - Health check
router.get('/', (req, res) => {
  const classifierStatus = getClassifierStatus();
  const queueStatus = getQueueStatus();
  
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    services: {
      brandClassifier: {
        initialized: classifierStatus.initialized,
        queryCount: classifierStatus.queryCount,
      },
      kwatchQueue: queueStatus,
    },
  });
});

// POST /api/health/reload-classifier - Force reload brand queries
router.post('/reload-classifier', (req, res) => {
  try {
    const result = reloadQueries();
    res.json({
      success: result.success,
      message: result.success 
        ? `Reloaded ${result.queryCount} queries` 
        : `Failed: ${result.error}`,
      details: result,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
