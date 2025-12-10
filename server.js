require('dotenv').config();
const express = require('express');
const { CosmosClient } = require('@azure/cosmos');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Cosmos DB setup
const client = new CosmosClient({
  endpoint: process.env.COSMOS_ENDPOINT,
  key: process.env.COSMOS_KEY
});

const database = client.database(process.env.COSMOS_DATABASE);
const container = database.container(process.env.COSMOS_CONTAINER);

// KWatch Database
const kwatchDatabase = client.database(process.env.COSMOS_KWATCH_DATABASE);
const kwatchContainer = kwatchDatabase.container(process.env.COSMOS_KWATCH_CONTAINER);

// KWatch Webhook Queue System, In-memory queue for handling webhook notifications
const kwatchQueue = [];
let isProcessingQueue = false;
const BATCH_SIZE = 10; // Process 10 items at a time
const BATCH_INTERVAL = 60000; // Process every 60 seconds

// Generate unique ID for KWatch items
function generateKWatchId(platform, datetime, author) {
  const input = `${platform}-${datetime}-${author}-${Date.now()}`;
  return crypto.createHash('md5').update(input).digest('hex');
}

// Process queue in batches
async function processKWatchQueue() {
  if (isProcessingQueue || kwatchQueue.length === 0) {
    return;
  }

  isProcessingQueue = true;
  
  try {
    const batch = kwatchQueue.splice(0, BATCH_SIZE);
    console.log(`Processing ${batch.length} KWatch notifications...`);

    // Process batch items in parallel
    const results = await Promise.allSettled(
      batch.map(item => kwatchContainer.items.create(item))
    );

    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    console.log(`Batch complete: ${successful} succeeded, ${failed} failed`);
    
    // Log any failures
    results.forEach((result, idx) => {
      if (result.status === 'rejected') {
        console.error(`Failed to insert item ${batch[idx].id}:`, result.reason);
      }
    });

  } catch (error) {
    console.error('Queue processing error:', error);
  } finally {
    isProcessingQueue = false;
  }
}

// Start queue processor
setInterval(processKWatchQueue, BATCH_INTERVAL);

// KWatch Webhook Endpoint 
app.post('/api/webhook/kwatch', async (req, res) => {
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
    kwatchQueue.push(kwatchDocument);
    
    console.log(`KWatch notification queued: ${payload.platform} - ${uniqueId}`);
    console.log(`Queue size: ${kwatchQueue.length}`);

    // res.status(202).json({ 
    //   message: 'Notification received and queued',
    //   id: uniqueId,
    //   queuePosition: kwatchQueue.length
    // });
    res.status(200).json({ 
      message: 'Notification received',
    });

  } catch (error) {
    console.error('KWatch webhook error:', error);
    res.status(500).json({ error: 'Failed to process webhook' });
  }
});

//  KWatch Data Retrieval Endpoint 
app.get('/api/kwatch', async (req, res) => {
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
      queueStatus: {
        pending: kwatchQueue.length,
        processing: isProcessingQueue
      }
    });
  } catch (error) {
    console.error('Error fetching KWatch items:', error);
    res.status(500).json({ error: 'Failed to fetch KWatch items' });
  }
});

// DELETE /api/kwatch/:id - Delete a KWatch item
app.delete('/api/kwatch/:id', async (req, res) => {
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

// GET /api/items - Fetch paginated items
app.get('/api/items', async (req, res) => {
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
app.post('/api/items', async (req, res) => {
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

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'), (err) => {
    if (err) {
      res.status(500).send('Frontend not found. Please deploy frontend files to /public folder.');
    }
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
