require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

// Import routes and services
const routes = require('./routes');
const { startQueueProcessor } = require('./services/kwatchQueue');

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

// Start queue processor for KWatch
startQueueProcessor();

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
