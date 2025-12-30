const fs = require('fs');
const path = require('path');
const { parseRule, evaluateRule } = require('../utils/parser');

// In-memory storage for compiled brand query ASTs
let brandQueries = [];
let isInitialized = false;

/**
 * Parse CSV handling multi-line quoted fields
 * @param {string} csvContent - Raw CSV content
 * @returns {Array} Array of row objects
 */
function parseCSV(csvContent) {
  const rows = [];
  const lines = csvContent.split('\n');
  let headers = null;
  let currentRow = null;
  let inQuotedField = false;
  let currentField = '';
  let fieldIndex = 0;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];

    if (!headers) {
      // Parse header row
      headers = line.split(',').map(h => h.trim());
      continue;
    }

    // Initialize new row if needed
    if (!currentRow) {
      currentRow = {};
      currentField = '';
      fieldIndex = 0;
      inQuotedField = false;
    }

    // Process character by character
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      const nextCh = line[i + 1];

      if (inQuotedField) {
        if (ch === '"' && nextCh === '"') {
          // Escaped quote
          currentField += '"';
          i++; // Skip next quote
        } else if (ch === '"') {
          // End of quoted field
          inQuotedField = false;
        } else {
          currentField += ch;
        }
      } else {
        if (ch === '"' && currentField === '') {
          // Start of quoted field
          inQuotedField = true;
        } else if (ch === ',') {
          // End of field
          if (fieldIndex < headers.length) {
            currentRow[headers[fieldIndex]] = currentField.trim();
          }
          currentField = '';
          fieldIndex++;
        } else {
          currentField += ch;
        }
      }
    }

    // Handle end of line
    if (inQuotedField) {
      // Multi-line quoted field - add newline and continue
      currentField += '\n';
    } else {
      // End of row - save last field
      if (fieldIndex < headers.length) {
        currentRow[headers[fieldIndex]] = currentField.trim();
      }
      if (Object.keys(currentRow).length > 0 && currentRow[headers[0]]) {
        rows.push(currentRow);
      }
      currentRow = null;
      currentField = '';
      fieldIndex = 0;
    }
  }

  return rows;
}

/**
 * Initialize the brand classifier by loading and pre-compiling all queries
 * Should be called once at server startup
 */
function initializeBrandClassifier() {
  if (isInitialized) {
    console.log('[BrandClassifier] Already initialized, skipping...');
    return { success: true, queryCount: brandQueries.length };
  }

  try {
    const csvPath = path.join(__dirname, '../config/BrandQueries.csv');
    console.log(`[BrandClassifier] Loading brand queries from: ${csvPath}`);

    const csvContent = fs.readFileSync(csvPath, 'utf-8');
    const rows = parseCSV(csvContent);

    let parseSuccessCount = 0;
    let parseFailCount = 0;
    const failedQueries = [];

    brandQueries = rows.map((row, index) => {
      const topic = row['Topic'] || '';
      const subTopic = row['Sub topic'] || '';
      const queryName = row['Query name'] || '';
      const internalId = row['Internal ID'] || '';
      const queryText = row['Query'] || '';

      let ast = null;
      try {
        ast = parseRule(queryText);
        parseSuccessCount++;
      } catch (err) {
        parseFailCount++;
        failedQueries.push({ index, topic, subTopic, queryName, error: err.message });
        console.warn(`[BrandClassifier] Failed to parse query "${queryName}": ${err.message}`);
      }

      return {
        topic,
        subTopic,
        queryName,
        internalId,
        queryText,
        ast,
      };
    }).filter(q => q.ast !== null); // Only keep successfully parsed queries

    isInitialized = true;

    console.log(`[BrandClassifier] Initialization complete:`);
    console.log(`  - Total queries loaded: ${rows.length}`);
    console.log(`  - Successfully parsed: ${parseSuccessCount}`);
    console.log(`  - Failed to parse: ${parseFailCount}`);

    if (failedQueries.length > 0) {
      console.log(`  - Failed queries:`);
      failedQueries.forEach(fq => {
        console.log(`    - ${fq.queryName}: ${fq.error}`);
      });
    }

    return {
      success: true,
      queryCount: brandQueries.length,
      parseSuccessCount,
      parseFailCount,
      failedQueries,
    };
  } catch (error) {
    console.error('[BrandClassifier] Failed to initialize:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Classify text against all brand queries
 * Returns on first match (single classification only)
 * @param {string} text - The text to classify (content from social media post)
 * @returns {Object} Classification result with single match
 */
function classifyText(text) {
  if (!isInitialized) {
    console.warn('[BrandClassifier] Not initialized. Call initializeBrandClassifier() first.');
    return { matched: false, classification: null };
  }

  if (!text || typeof text !== 'string' || text.trim() === '') {
    return { matched: false, classification: null };
  }

  for (const query of brandQueries) {
    try {
      const result = evaluateRule(query.ast, text);
      if (result.matched) {
        // Return immediately on first match
        return {
          matched: true,
          classification: {
            topic: query.topic,
            subTopic: query.subTopic,
            queryName: query.queryName,
            internalId: query.internalId,
          },
        };
      }
    } catch (err) {
      console.error(`[BrandClassifier] Error evaluating query "${query.queryName}":`, err.message);
    }
  }

  return {
    matched: false,
    classification: null,
  };
}

// Get the current status of the brand classifier
function getClassifierStatus() {
  return {
    initialized: isInitialized,
    queryCount: brandQueries.length,
  };
}

// Force re-initialization (useful for hot-reloading queries)
function reloadQueries() {
  isInitialized = false;
  brandQueries = [];
  return initializeBrandClassifier();
}

module.exports = {
  initializeBrandClassifier,
  classifyText,
  getClassifierStatus,
  reloadQueries,
};
