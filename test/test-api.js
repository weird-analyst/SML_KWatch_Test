/**
 * API Integration Test
 * Tests the classifier endpoint against the running server
 * 
 * Usage:
 *   node test-api.js                    # Run with 10 sample rows
 *   node test-api.js --sample 20        # Run with 20 sample rows
 *   node test-api.js --full             # Run on all data
 * 
 * Requires: Server running at http://localhost:3000
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const SERVER_URL = 'http://localhost:3000';

// Parse command line arguments
const args = process.argv.slice(2);
const CONFIG = {
  sampleSize: 10,
  fullMode: false,
  ignoreEllipsis: true,
};

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--full') {
    CONFIG.fullMode = true;
  } else if (args[i] === '--sample' && args[i + 1]) {
    CONFIG.sampleSize = parseInt(args[i + 1], 10) || 10;
    i++;
  }
}

// Color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  magenta: '\x1b[35m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
};

// Simple HTTP POST request
function postJSON(url, data) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const postData = JSON.stringify(data);
    
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || 80,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function getJSON(url) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || 80,
      path: urlObj.pathname,
      method: 'GET',
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

// CSV Parser
function parseCSV(content) {
  const rows = [];
  let headers = null;
  let i = 0;
  const len = content.length;

  while (i < len) {
    const { values, nextIndex } = parseCSVRow(content, i);
    i = nextIndex;
    if (values.length === 0) continue;

    if (!headers) {
      headers = values.map(h => h.trim());
    } else {
      const row = {};
      headers.forEach((header, idx) => {
        row[header] = values[idx] || '';
      });
      rows.push(row);
    }
  }
  return rows;
}

function parseCSVRow(content, startIndex) {
  const values = [];
  let current = '';
  let inQuotes = false;
  let i = startIndex;
  const len = content.length;

  while (i < len) {
    const char = content[i];
    const nextChar = content[i + 1];

    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        current += '"';
        i += 2;
      } else if (char === '"') {
        inQuotes = false;
        i++;
      } else {
        current += char;
        i++;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
        i++;
      } else if (char === ',') {
        values.push(current);
        current = '';
        i++;
      } else if (char === '\r' && nextChar === '\n') {
        values.push(current);
        i += 2;
        break;
      } else if (char === '\n') {
        values.push(current);
        i++;
        break;
      } else {
        current += char;
        i++;
      }
    }
  }

  if (i >= len && (current.length > 0 || values.length > 0)) {
    values.push(current);
  }

  return { values, nextIndex: i };
}

// Load historic data
function loadHistoricData() {
  const filePath = path.join(__dirname, 'HistoricData.csv');
  if (!fs.existsSync(filePath)) {
    console.error(`${colors.red}Error: HistoricData.csv not found at ${filePath}${colors.reset}`);
    process.exit(1);
  }
  return parseCSV(fs.readFileSync(filePath, 'utf-8'));
}

// ============================================================================
// MAIN TEST
// ============================================================================
async function runAPITests() {
  console.log('\n' + '═'.repeat(80));
  console.log(`${colors.bold}${colors.cyan}API Integration Test${colors.reset}`);
  console.log('═'.repeat(80));

  // Check server health
  console.log('\nChecking server health...');
  try {
    const health = await getJSON(`${SERVER_URL}/api/health`);
    if (health.status !== 200) {
      console.error(`${colors.red}Server health check failed: ${health.status}${colors.reset}`);
      process.exit(1);
    }
    console.log(`${colors.green}✓ Server is running${colors.reset}`);
    console.log(`  Brand Classifier: ${health.data.services?.brandClassifier?.initialized ? 'Ready' : 'Not Ready'}`);
    console.log(`  Query Count: ${health.data.services?.brandClassifier?.queryCount || 0}`);
  } catch (err) {
    console.error(`${colors.red}Cannot connect to server at ${SERVER_URL}${colors.reset}`);
    console.error(`  Error: ${err.message}`);
    console.error(`\n  Make sure the server is running: npm start`);
    process.exit(1);
  }

  // Check classifier status
  console.log('\nChecking classifier status...');
  const classifierStatus = await getJSON(`${SERVER_URL}/api/classify/status`);
  if (!classifierStatus.data.initialized) {
    console.error(`${colors.red}Classifier not initialized${colors.reset}`);
    process.exit(1);
  }
  console.log(`${colors.green}✓ Classifier ready with ${classifierStatus.data.queryCount} queries${colors.reset}\n`);

  // Load historic data
  console.log('Loading historic data...');
  const historicData = loadHistoricData();
  console.log(`${colors.green}✓ Loaded ${historicData.length} historic records${colors.reset}\n`);

  // Filter out deleted mentions and ellipsis
  let validData = historicData.filter(
    (row) => row['Mention Content'] !== 'Deleted or protected mention'
  );
  if (CONFIG.ignoreEllipsis) {
    validData = validData.filter(
      (row) => !row['Mention Content'].trim().endsWith('...')
    );
  }

  console.log(`Valid rows after filtering: ${validData.length}`);

  // Select sample
  const testRows = CONFIG.fullMode 
    ? validData 
    : validData.slice(0, CONFIG.sampleSize);

  console.log(`Testing ${testRows.length} rows...\n`);
  console.log('-'.repeat(80));

  let tested = 0;
  let withExpectedQuery = 0;
  let matchedExpected = 0;
  let matchedOther = 0;
  let noMatch = 0;
  let apiErrors = 0;

  for (let idx = 0; idx < testRows.length; idx++) {
    const row = testRows[idx];
    tested++;
    
    const title = row.title || '';
    const content = row['Mention Content'] || '';
    const expectedTopicRaw = row.Topics || '';
    const expectedSubtopicRaw = row.Subtopics || '';

    // Handle comma-separated topics/subtopics
    const expectedTopics = expectedTopicRaw.split(',').map(t => t.trim().toLowerCase()).filter(t => t);
    const expectedSubtopics = expectedSubtopicRaw.split(',').map(s => s.trim().toLowerCase()).filter(s => s);

    // Build expected pairs
    const expectedPairs = new Set();
    if (expectedTopics.length === expectedSubtopics.length) {
      for (let i = 0; i < expectedTopics.length; i++) {
        expectedPairs.add(`${expectedTopics[i]}|${expectedSubtopics[i]}`);
      }
    } else {
      expectedTopics.forEach(t => {
        expectedSubtopics.forEach(s => {
          expectedPairs.add(`${t}|${s}`);
        });
      });
    }

    // Call the API
    try {
      const response = await postJSON(`${SERVER_URL}/api/classify`, { title, content });
      
      if (response.status !== 200) {
        apiErrors++;
        console.log(`${colors.red}✗${colors.reset} [${idx + 1}] API Error: ${response.status}`);
        continue;
      }

      const result = response.data;
      
      // Check if we have an expected query (simplified - assume we do if topic/subtopic exist)
      const hasExpectedQuery = expectedTopics.length > 0 && expectedSubtopics.length > 0;
      if (hasExpectedQuery) {
        withExpectedQuery++;
      }

      if (!result.matched) {
        noMatch++;
        const statusIcon = '○';
        console.log(`${colors.dim}${statusIcon}${colors.reset} [${idx + 1}] No match - Expected: ${expectedTopicRaw} > ${expectedSubtopicRaw}`);
      } else {
        const matchedTopic = result.classification.topic.toLowerCase();
        const matchedSubTopic = result.classification.subTopic.toLowerCase();
        const matchKey = `${matchedTopic}|${matchedSubTopic}`;
        
        const isExpectedMatch = expectedPairs.has(matchKey);
        
        if (isExpectedMatch) {
          matchedExpected++;
          console.log(`${colors.green}✓${colors.reset} [${idx + 1}] ${result.classification.topic} > ${result.classification.subTopic}`);
        } else {
          matchedOther++;
          console.log(`${colors.yellow}≈${colors.reset} [${idx + 1}] Expected: ${expectedTopicRaw} > ${expectedSubtopicRaw}`);
          console.log(`   Got: ${result.classification.topic} > ${result.classification.subTopic} (${result.classification.queryName})`);
        }
      }
    } catch (err) {
      apiErrors++;
      console.log(`${colors.red}✗${colors.reset} [${idx + 1}] Request failed: ${err.message}`);
    }

    // Small delay to not overwhelm the server
    if (idx < testRows.length - 1) {
      await new Promise(r => setTimeout(r, 50));
    }
  }

  // Summary
  console.log('\n' + '-'.repeat(80));
  console.log(`${colors.bold}API Test Summary${colors.reset}`);
  console.log('-'.repeat(80));
  console.log(`  Records tested: ${tested}`);
  console.log(`  ${colors.green}✓ Matched expected: ${matchedExpected}${colors.reset}`);
  console.log(`  ${colors.yellow}≈ Matched other: ${matchedOther}${colors.reset}`);
  console.log(`  ${colors.dim}○ No match: ${noMatch}${colors.reset}`);
  if (apiErrors > 0) {
    console.log(`  ${colors.red}✗ API errors: ${apiErrors}${colors.reset}`);
  }

  if (withExpectedQuery > 0) {
    const accuracy = (matchedExpected / withExpectedQuery * 100).toFixed(1);
    console.log(`\n  ${colors.bold}Accuracy: ${accuracy}%${colors.reset} (${matchedExpected}/${withExpectedQuery})`);
  }

  const totalMatched = matchedExpected + matchedOther;
  const matchRate = (totalMatched / tested * 100).toFixed(1);
  console.log(`  ${colors.bold}Match Rate: ${matchRate}%${colors.reset} (${totalMatched}/${tested})`);

  console.log('\n' + '═'.repeat(80));
  if (apiErrors === 0) {
    console.log(`${colors.bgGreen}${colors.bold} API TEST PASSED ${colors.reset} All requests successful`);
  } else {
    console.log(`${colors.bgRed}${colors.bold} API TEST FAILED ${colors.reset} ${apiErrors} API errors`);
  }
}

// Run the tests
runAPITests().catch(err => {
  console.error(`${colors.red}Test failed: ${err.message}${colors.reset}`);
  process.exit(1);
});
