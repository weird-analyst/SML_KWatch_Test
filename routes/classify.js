const express = require('express');
const router = express.Router();
const { classifyText, getClassifierStatus } = require('../services/brandClassifier');

// POST /api/classify - Classify text against brand queries
router.post('/', (req, res) => {
  try {
    const { text, title, content } = req.body;
    
    // Support both { text } and { title, content } formats
    let textToClassify = text;
    if (!textToClassify && content) {
      textToClassify = `${title || ''} ${content}`;
    }
    
    if (!textToClassify || typeof textToClassify !== 'string') {
      return res.status(400).json({ 
        error: 'Missing or invalid "text" field (or "title"/"content" fields) in request body' 
      });
    }

    const status = getClassifierStatus();
    if (!status.initialized) {
      return res.status(503).json({
        error: 'Brand classifier not initialized',
        message: 'The server is still starting up. Please try again in a moment.',
      });
    }

    const result = classifyText(textToClassify);
    
    res.json({
      matched: result.matched,
      classification: result.classification,
      textLength: textToClassify.length,
      queryCount: status.queryCount,
    });
  } catch (error) {
    console.error('Classification error:', error);
    res.status(500).json({ error: 'Classification failed', message: error.message });
  }
});

// GET /api/classify/status - Get classifier status
router.get('/status', (req, res) => {
  const status = getClassifierStatus();
  res.json(status);
});

module.exports = router;
