const express = require('express');
const router = express.Router();
const { generateKWatchId, addToQueue } = require('../services/kwatchQueue');

// POST /api/webhook/kwatch - KWatch Webhook Endpoint
router.post('/kwatch', async (req, res) => {
  try {
    const payload = req.body;
    
    // Validate required fields
    if (!payload.platform || !payload.query || !payload.datetime || 
        !payload.link || !payload.author || !payload.content) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        received: Object.keys(payload)
      });
    }

    // Generate unique ID
    const uniqueId = generateKWatchId(payload.platform, payload.datetime, payload.author);

    // Create normalized document for Cosmos DB
    const kwatchDocument = {
      id: uniqueId,
      platform: payload.platform,
      query: payload.query,
      datetime: payload.datetime,
      link: payload.link,
      author: payload.author,
      content: payload.content,
      sentiment: payload.sentiment || 'neutral',
      receivedAt: new Date().toISOString(),
      processed: false // Flag for future processing
    };

    // Add to queue
    const queuePosition = addToQueue(kwatchDocument);
    
    console.log(`KWatch notification queued: ${payload.platform} - ${uniqueId}`);
    console.log(`Queue size: ${queuePosition}`);

    res.status(200).json({ 
      message: 'Notification received',
    });
  } catch (error) {
    console.error('KWatch webhook error:', error);
    res.status(500).json({ error: 'Failed to process webhook' });
  }
});

module.exports = router;
