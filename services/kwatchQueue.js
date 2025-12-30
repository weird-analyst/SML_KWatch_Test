const crypto = require('crypto');
const { kwatchContainer } = require('../config/database');

// In-memory queue for handling webhook notifications
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

// Add item to queue
function addToQueue(document) {
  kwatchQueue.push(document);
  return kwatchQueue.length;
}

// Get queue status
function getQueueStatus() {
  return {
    pending: kwatchQueue.length,
    processing: isProcessingQueue
  };
}

// Start queue processor interval
function startQueueProcessor() {
  return setInterval(processKWatchQueue, BATCH_INTERVAL);
}

module.exports = {
  generateKWatchId,
  addToQueue,
  getQueueStatus,
  startQueueProcessor
};
