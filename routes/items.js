const express = require('express');
const router = express.Router();
const { container } = require('../config/database');

// GET /api/items - Fetch paginated items
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    const querySpec = {
      query: 'SELECT * FROM c ORDER BY c.timestamp DESC OFFSET @offset LIMIT @limit',
      parameters: [
        { name: '@offset', value: offset },
        { name: '@limit', value: limit }
      ]
    };

    const { resources: items } = await container.items.query(querySpec).fetchAll();
    
    // Get total count
    const countQuery = { query: 'SELECT VALUE COUNT(1) FROM c' };
    const { resources: countResult } = await container.items.query(countQuery).fetchAll();
    const totalItems = countResult[0] || 0;

    res.json({
      items,
      pagination: {
        page,
        limit,
        totalItems,
        totalPages: Math.ceil(totalItems / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching items:', error);
    res.status(500).json({ error: 'Failed to fetch items' });
  }
});

// POST /api/items - Insert new item
router.post('/', async (req, res) => {
  try {
    const newItem = {
      id: `manual-${Date.now()}`,
      category: req.body.category || 'test',
      source: 'manual',
      content: req.body.content || 'Test data from API',
      timestamp: new Date().toISOString()
    };

    const { resource: createdItem } = await container.items.create(newItem);
    res.status(201).json(createdItem);
  } catch (error) {
    console.error('Error creating item:', error);
    res.status(500).json({ error: 'Failed to create item' });
  }
});

module.exports = router;
