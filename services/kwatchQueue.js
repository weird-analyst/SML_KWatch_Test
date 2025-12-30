const crypto = require('crypto');
const { kwatchContainer, kwatchProcessedContainer } = require('../config/database');
const { classifyText } = require('./brandClassifier');

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

// Classify a single item and push to processed container if matched
async function classifyAndPushIfMatched(item) {
  // Combine title + content for classification
  const textToClassify = `${item.title || ''} ${item.content || ''}`;
  const classificationResult = classifyText(textToClassify);
  
  // If item matched a brand query, push to processed container
  if (classificationResult.matched) {
    try {
      const classification = classificationResult.classification;
      
      const processedDocument = {
        id: item.id,
        platform: item.platform,
        query: item.query, // Original KWatch query
        datetime: item.datetime,
        link: item.link,
        author: item.author,
        title: item.title || '',
        content: item.content,
        sentiment: item.sentiment,
        receivedAt: item.receivedAt,
        // Brand classification results
        topic: classification.topic,
        subTopic: classification.subTopic,
        queryName: classification.queryName,
        internalId: classification.internalId,
      };

      await kwatchProcessedContainer.items.create(processedDocument);
      console.log(`[BrandClassifier] Item ${item.id} classified as "${classification.topic}/${classification.subTopic}" and pushed to processed container`);
      return true;
    } catch (err) {
      // Handle conflict (item already exists) gracefully
      if (err.code === 409) {
        console.log(`[BrandClassifier] Item ${item.id} already exists in processed container, skipping`);
      } else {
        console.error(`[BrandClassifier] Failed to push item ${item.id} to processed container:`, err.message);
      }
    }
  }
  return false;
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

    // Classify and push matched items to processed container
    const classificationResults = await Promise.all(
      batch.map(item => classifyAndPushIfMatched(item))
    );
    const matchedCount = classificationResults.filter(matched => matched).length;

    console.log(`Batch complete: ${successful} raw inserted, ${failed} failed, ${matchedCount} classified`);
    
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
