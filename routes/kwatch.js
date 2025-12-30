const express = require('express');
const router = express.Router();
const { kwatchContainer, kwatchProcessedContainer } = require('../config/database');
const { getQueueStatus } = require('../services/kwatchQueue');

// GET /api/kwatch - KWatch Raw Data Retrieval Endpoint
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    const querySpec = {
      query: 'SELECT * FROM c ORDER BY c.receivedAt DESC OFFSET @offset LIMIT @limit',
      parameters: [
        { name: '@offset', value: offset },
        { name: '@limit', value: limit }
      ]
    };

    const { resources: items } = await kwatchContainer.items.query(querySpec).fetchAll();
    
    // Get total count
    const countQuery = { query: 'SELECT VALUE COUNT(1) FROM c' };
    const { resources: countResult } = await kwatchContainer.items.query(countQuery).fetchAll();
    const totalItems = countResult[0] || 0;

    res.json({
      items,
      pagination: {
        page,
        limit,
        totalItems,
        totalPages: Math.ceil(totalItems / limit)
      },
      queueStatus: getQueueStatus()
    });
  } catch (error) {
    console.error('Error fetching KWatch items:', error);
    res.status(500).json({ error: 'Failed to fetch KWatch items' });
  }
});

// GET /api/kwatch/processed - KWatch Processed (Classified) Data Retrieval Endpoint
router.get('/processed', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    const querySpec = {
      query: 'SELECT * FROM c ORDER BY c.classifiedAt DESC OFFSET @offset LIMIT @limit',
      parameters: [
        { name: '@offset', value: offset },
        { name: '@limit', value: limit }
      ]
    };

    const { resources: items } = await kwatchProcessedContainer.items.query(querySpec).fetchAll();
    
    // Get total count
    const countQuery = { query: 'SELECT VALUE COUNT(1) FROM c' };
    const { resources: countResult } = await kwatchProcessedContainer.items.query(countQuery).fetchAll();
    const totalItems = countResult[0] || 0;

    res.json({
      items,
      pagination: {
        page,
        limit,
        totalItems,
        totalPages: Math.ceil(totalItems / limit)
      },
      queueStatus: getQueueStatus()
    });
  } catch (error) {
    console.error('Error fetching KWatch processed items:', error);
    res.status(500).json({ error: 'Failed to fetch KWatch processed items' });
  }
});

// DELETE /api/kwatch/:id - Delete a KWatch item
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { platform } = req.query; // Need partition key for deletion
    
    if (!platform) {
      return res.status(400).json({ error: 'Platform (partition key) is required' });
    }

    await kwatchContainer.item(id, platform).delete();
    res.json({ message: 'Item deleted successfully', id });
  } catch (error) {
    console.error('Error deleting KWatch item:', error);
    res.status(500).json({ error: 'Failed to delete item', reason: error });
  }
});

module.exports = router;
