require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

// Import routes and services
const routes = require('./routes');
const { startQueueProcessor } = require('./services/kwatchQueue');
const { initializeBrandClassifier, getClassifierStatus } = require('./services/brandClassifier');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.use('/api', routes);

// Root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'), (err) => {
    if (err) {
      res.status(500).send('Frontend not found. Please deploy frontend files to /public folder.');
    }
  });
});

// Initialize Brand Classifier with pre-compiled ASTs
console.log('[Server] Initializing Brand Classifier...');
const classifierInit = initializeBrandClassifier();
if (classifierInit.success) {
  console.log(`[Server] Brand Classifier ready with ${classifierInit.queryCount} queries`);
} else {
  console.error('[Server] Brand Classifier initialization failed:', classifierInit.error);
}

// Start queue processor for KWatch
startQueueProcessor();
console.log('[Server] KWatch queue processor started');

app.listen(PORT, () => {
  const status = getClassifierStatus();
  console.log(`Server running on port ${PORT}`);
  console.log(`Brand Classifier: ${status.initialized ? 'Ready' : 'Not Ready'} (${status.queryCount} queries)`);
});
