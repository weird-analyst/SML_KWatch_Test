const express = require('express');
const router = express.Router();

// GET /api/health - Health check
router.get('/', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

module.exports = router;
