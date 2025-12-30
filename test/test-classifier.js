/**
 * Brand Classifier Test Script
 * Tests the brandClassifier service against historic data
 * 
 * This mirrors the logic from classification-test.js:
 * - Tests ALL queries against each row
 * - Checks if ANY expected query matched
 * - Only counts accuracy for rows where expected query EXISTS
 * 
 * Usage:
 *   node test-classifier.js                    # Run with 10 sample rows
 *   node test-classifier.js --sample 20        # Run with 20 sample rows
 *   node test-classifier.js --full             # Run on all data
 */

const fs = require('fs');
const path = require('path');
const { parseRule, evaluateRule } = require('../utils/parser');

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

// CSV Parser - handles multi-line quoted fields
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

// Load files
function loadHistoricData() {
  const filePath = path.join(__dirname, 'HistoricData.csv');
  if (!fs.existsSync(filePath)) {
    console.error(`${colors.red}Error: HistoricData.csv not found at ${filePath}${colors.reset}`);
    process.exit(1);
  }
  return parseCSV(fs.readFileSync(filePath, 'utf-8'));
}

function loadQueries() {
  const filePath = path.join(__dirname, '../config/BrandQueries.csv');
  if (!fs.existsSync(filePath)) {
    console.error(`${colors.red}Error: BrandQueries.csv not found at ${filePath}${colors.reset}`);
    process.exit(1);
  }
  return parseCSV(fs.readFileSync(filePath, 'utf-8'));
}

// ============================================================================
// MAIN TEST
// ============================================================================
function runClassificationTests() {
  console.log('\n' + '═'.repeat(80));
  console.log(`${colors.bold}${colors.cyan}Brand Classifier Integration Test${colors.reset}`);
  console.log('═'.repeat(80));

  // Load and parse queries
  console.log('\nLoading and parsing brand queries...');
  const queries = loadQueries();
  const parsedQueries = [];
  let parseSuccess = 0;
  let parseFail = 0;

  queries.forEach((q) => {
    if (!q.Query || !q.Query.trim()) return;
    try {
      const ast = parseRule(q.Query);
      parseSuccess++;
      parsedQueries.push({
        topic: q.Topic,
        subtopic: q['Sub topic'],
        queryName: q['Query name'],
        id: q['Internal ID'],
        query: q.Query,
        ast: ast,
      });
    } catch (err) {
      parseFail++;
    }
  });

  console.log(`${colors.green}✓ Parsed ${parseSuccess} queries (${parseFail} failed)${colors.reset}\n`);

  // Build subtopic lookup map
  const subtopicQueryMap = {};
  parsedQueries.forEach((pq) => {
    const key = `${pq.topic}|${pq.subtopic}`;
    if (!subtopicQueryMap[key]) {
      subtopicQueryMap[key] = [];
    }
    subtopicQueryMap[key].push(pq);
  });

  // Load historic data
  console.log('Loading historic data...');
  const historicData = loadHistoricData();
  console.log(`${colors.green}✓ Loaded ${historicData.length} historic records${colors.reset}\n`);

  // Filter out deleted mentions
  let validData = historicData.filter(
    (row) => row['Mention Content'] !== 'Deleted or protected mention'
  );

  // Filter out rows whose mention content ends with ...
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

  // Separate counters for relevant rows
  let testedRelevant = 0;
  let withExpectedQueryRelevant = 0;
  let matchedExpectedRelevant = 0;

  testRows.forEach((row, idx) => {
    tested++;
    // Use title + Mention Content (like classification-test.js)
    const content = `${row.title || ''} ${row['Mention Content'] || ''}`;
    const expectedTopicRaw = row.Topics || '';
    const expectedSubtopicRaw = row.Subtopics || '';
    const classifier = row.Classifiers || '';
    const isRelevant = classifier.trim().toLowerCase() !== 'irrelevant';

    // Handle comma-separated topics/subtopics
    const expectedTopics = expectedTopicRaw.split(',').map(t => t.trim()).filter(t => t);
    const expectedSubtopics = expectedSubtopicRaw.split(',').map(s => s.trim()).filter(s => s);

    // Build all expected topic|subtopic pairs
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

    // Find all matching queries
    const allMatches = [];
    parsedQueries.forEach((pq) => {
      try {
        const result = evaluateRule(pq.ast, content);
        if (result.matched) {
          const matchKey = `${pq.topic}|${pq.subtopic}`;
          allMatches.push({
            topic: pq.topic,
            subtopic: pq.subtopic,
            queryName: pq.queryName,
            spans: result.spans,
            isExpected: expectedPairs.has(matchKey),
          });
        }
      } catch (err) {
        // Skip evaluation errors
      }
    });

    // Check if ANY expected query exists in our query set
    let hasExpectedQuery = false;
    for (const key of expectedPairs) {
      if (subtopicQueryMap[key] !== undefined) {
        hasExpectedQuery = true;
        break;
      }
    }

    if (hasExpectedQuery) {
      withExpectedQuery++;
      if (isRelevant) {
        testedRelevant++;
        withExpectedQueryRelevant++;
      }
    }

    // Check if expected match was found
    const expectedMatch = allMatches.find((m) => m.isExpected);
    if (expectedMatch) {
      matchedExpected++;
      if (isRelevant && hasExpectedQuery) {
        matchedExpectedRelevant++;
      }
    } else if (allMatches.length > 0) {
      matchedOther++;
    } else {
      noMatch++;
    }

    // Detailed logging for failures
    if (!expectedMatch && hasExpectedQuery) {
      const statusIcon = expectedMatch ? '✓' : (allMatches.length > 0 ? '≈' : '○');
      const statusColor = expectedMatch ? colors.green : (allMatches.length > 0 ? colors.yellow : colors.dim);

      console.log(`\n${colors.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
      console.log(`${colors.cyan}[${idx + 1}/${testRows.length}]${colors.reset} ID: ${row.Id} ${isRelevant ? '(Relevant)' : ''}`);
      console.log(`${colors.bold}Content:${colors.reset}`);
      console.log(`  ${colors.dim}${content.substring(0, 200)}${content.length > 200 ? '...' : ''}${colors.reset}`);
      console.log(`\n${colors.bold}Expected:${colors.reset} ${expectedTopicRaw} > ${expectedSubtopicRaw}`);
      console.log(`${colors.bold}Query Available:${colors.reset} ${hasExpectedQuery ? colors.green + 'Yes' : colors.yellow + 'No'}${colors.reset}`);

      if (hasExpectedQuery) {
        console.log(`\n${colors.bold}Expected Matching Query:${colors.reset}`);
        for (const pair of expectedPairs) {
          const queries = subtopicQueryMap[pair];
          if (queries && queries.length > 0) {
            const [topic, subtopic] = pair.split('|');
            console.log(`  ${colors.cyan}${topic} > ${subtopic}:${colors.reset}`);
            queries.forEach(q => {
              console.log(`    ${colors.dim}${q.query.substring(0, 100)}${q.query.length > 100 ? '...' : ''}${colors.reset}`);
            });
          }
        }
      }

      console.log(`\n${statusColor}${statusIcon} ${expectedMatch ? 'CORRECT MATCH' : (allMatches.length > 0 ? 'MATCHED OTHER' : 'NO MATCH')}${colors.reset}`);

      if (allMatches.length > 0) {
        console.log(`\n${colors.bold}All Matches (${allMatches.length}):${colors.reset}`);
        allMatches.forEach((m) => {
          const marker = m.isExpected ? `${colors.green}★${colors.reset}` : `${colors.dim}○${colors.reset}`;
          console.log(`  ${marker} ${m.topic} > ${m.subtopic} (${m.queryName})`);
        });
      }
    } else if (!CONFIG.fullMode) {
      // Show progress for successful matches
      const statusIcon = expectedMatch ? '✓' : (allMatches.length > 0 ? '≈' : '○');
      const statusColor = expectedMatch ? colors.green : (allMatches.length > 0 ? colors.yellow : colors.dim);
      console.log(`${statusColor}${statusIcon}${colors.reset} [${idx + 1}] ${expectedTopicRaw} > ${expectedSubtopicRaw}`);
    } else {
      // Progress for full mode
      if (idx % 500 === 0 || idx === testRows.length - 1) {
        process.stdout.write(`\r  Processing: ${idx + 1}/${testRows.length} (${Math.round((idx + 1) / testRows.length * 100)}%)`);
      }
    }
  });

  if (CONFIG.fullMode) {
    console.log(); // New line after progress
  }

  // Summary
  console.log('\n' + '-'.repeat(80));
  console.log(`${colors.bold}Classification Summary${colors.reset}`);
  console.log('-'.repeat(80));
  console.log(`  Records tested: ${tested}`);
  console.log(`  Records with expected query available: ${withExpectedQuery}`);
  console.log(`  ${colors.green}✓ Matched expected subtopic: ${matchedExpected}${colors.reset}`);
  console.log(`  ${colors.yellow}≈ Matched other: ${matchedOther}${colors.reset}`);
  console.log(`  ${colors.dim}○ No match: ${noMatch}${colors.reset}`);

  if (withExpectedQuery > 0) {
    const accuracy = (matchedExpected / withExpectedQuery * 100).toFixed(1);
    console.log(`\n  ${colors.bold}Accuracy: ${accuracy}%${colors.reset} (${matchedExpected}/${withExpectedQuery})`);
  }

  if (withExpectedQueryRelevant > 0) {
    const accuracyRelevant = (matchedExpectedRelevant / withExpectedQueryRelevant * 100).toFixed(1);
    console.log(`  ${colors.bold}Accuracy (relevant): ${accuracyRelevant}%${colors.reset} (${matchedExpectedRelevant}/${withExpectedQueryRelevant})`);
  }

  console.log('\n' + '═'.repeat(80));
  if (withExpectedQuery > 0) {
    const accuracy = (matchedExpected / withExpectedQuery * 100);
    if (accuracy >= 90) {
      console.log(`${colors.bgGreen}${colors.bold} TEST PASSED ${colors.reset} Accuracy >= 90%`);
    } else if (accuracy >= 70) {
      console.log(`${colors.yellow}${colors.bold} TEST WARNING ${colors.reset} Accuracy between 70-90%`);
    } else {
      console.log(`${colors.bgRed}${colors.bold} TEST FAILED ${colors.reset} Accuracy < 70%`);
    }
  }
}

// Run the tests
runClassificationTests();
