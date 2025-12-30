"use strict";

// Parser and evaluator for the Brand Query Classification Engine
// The module exports:
//  - parseRule(query: string) -> AST
//  - evaluateRule(ast, text: string) -> { matched: boolean, spans: Array<[number, number]> }
//  - classifyBrandRules(rules: Record<string, string>, text: string) -> Array<{ brand, matched, spans }>

// Article Helpers
function normalizeText(text) {
  if (!text) return "";
  const lower = text.toLowerCase();
  // Remove diacritics via NFD decomposition.
  const stripped = lower.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  // Replace punctuation with spaces but keep alphanumerics together. Preserve @ and # when they prefix a word (for mentions and hashtags).
  const cleaned = stripped.replace(/[^a-z0-9@#\s]+/g, " ");
  return cleaned.replace(/\s+/g, " ").trim();
}

function tokenizeArticle(text) {
  const normalized = normalizeText(text);
  if (!normalized) return [];
  // Split and clean up any standalone @ or # symbols (keep only when prefixing a word)
  return normalized.split(" ").map(token => {
    // Remove @ or # if they appear alone or at the end of a token
    if (token === '@' || token === '#') return '';
    // Keep @ or # only if it's at the start and followed by alphanumeric
    if ((token.startsWith('@') || token.startsWith('#')) && token.length > 1) {
      return token;
    }
    // Remove any trailing @ or #
    return token.replace(/[@#]+$/, '');
  }).filter(t => t.length > 0);
}

function tokenizePhrase(phrase) {
  const normalized = normalizeText(phrase);
  if (!normalized) return [];
  // Split and clean up any standalone @ or # symbols
  return normalized.split(" ").map(token => {
    if (token === '@' || token === '#') return '';
    if ((token.startsWith('@') || token.startsWith('#')) && token.length > 1) {
      return token;
    }
    return token.replace(/[@#]+$/, '');
  }).filter(t => t.length > 0);
}

// Query Helpers
function tokenizeQuery(query) {
  const tokens = [];
  let i = 0;
  while (i < query.length) {
    const ch = query[i];
    if (/[\s]/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === "(") {
      tokens.push({ type: "LPAREN" });
      i += 1;
      continue;
    }
    if (ch === ")") {
      tokens.push({ type: "RPAREN" });
      i += 1;
      continue;
    }
    if (ch === "\"" || ch === "'") {
      const quote = ch;
      i += 1;
      let buf = "";
      while (i < query.length && query[i] !== quote) {
        buf += query[i];
        i += 1;
      }
      if (i >= query.length) {
        throw new Error("Unterminated quoted phrase in query");
      }
      i += 1; // skip closing quote
      tokens.push({ type: "PHRASE", value: buf });
      continue;
    }
    // Parse bare token until whitespace, paren, or quote (to handle "phrase"OR cases).
    let buf = "";
    while (i < query.length && !/[\s()"']/.test(query[i])) {
      buf += query[i];
      i += 1;
    }
    if (buf.length === 0) continue; // Skip empty tokens
    const upper = buf.toUpperCase();
    if (upper === "AND" || upper === "OR") {
      tokens.push({ type: upper });
    } else if (upper === "NOT") {
      tokens.push({ type: "NOT" });
    } else if (/^NEAR\/\d+$/i.test(buf)) {
      const distance = parseInt(buf.split("/")[1], 10);
      tokens.push({ type: "NEAR", distance });
    } else if (upper === "NEAR") {
      // Support two-token form: NEAR /n
      // Peek ahead for /n in the raw string from the tokenizer position (already consumed current token).
      // Here we just mark NEAR; parser will read following token if in that form.
      tokens.push({ type: "NEAR_WORD" });
    } else {
      tokens.push({ type: "TERM", value: buf });
    }
  }
  return tokens;
}

// Parser (recursive descent with precedence)
function parseRule(query) {
  const tokens = tokenizeQuery(query || "");
  let pos = 0;

  function peek() {
    return tokens[pos];
  }

  function consume() {
    return tokens[pos++];
  }

  function expect(type) {
    const tok = consume();
    if (!tok || tok.type !== type) {
      throw new Error(`Expected ${type} but found ${tok ? tok.type : "EOF"}`);
    }
    return tok;
  }

  function parsePrimary() {
    const tok = peek();
    if (!tok) return null;
    if (tok.type === "LPAREN") {
      consume();
      const expr = parseOr();
      expect("RPAREN");
      return expr;
    }
    if (tok.type === "PHRASE") {
      consume();
      const phraseTokens = tokenizePhrase(tok.value);
      return { type: "PHRASE", tokens: phraseTokens };
    }
    if (tok.type === "TERM") {
      consume();
      const raw = tok.value;
      if (raw.endsWith("*")) {
        const prefix = normalizeText(raw.slice(0, -1));
        return { type: "WILDCARD", prefix };
      }
      return { type: "TERM", value: normalizeText(raw) };
    }
    return null;
  }

  function parseUnary() {
    const tok = peek();
    if (tok && tok.type === "NOT") {
      consume();
      const child = parseUnary();
      if (!child) throw new Error("NOT must be followed by an expression");
      return { type: "NOT", child };
    }
    return parsePrimary();
  }

  function parseNear() {
    let node = parseUnary();
    while (true) {
      const tok = peek();
      if (tok && (tok.type === "NEAR" || tok.type === "NEAR_WORD")) {
        consume();
        let distance = tok.distance;
        if (tok.type === "NEAR_WORD") {
          const next = peek();
          if (next && next.type === "TERM" && /^\/(\d+)$/.test(next.value)) {
            consume();
            distance = parseInt(next.value.slice(1), 10);
          } else {
            // NEAR without /n defaults to NEAR/9
            distance = 9;
          }
        }
        const right = parseUnary();
        if (!right) throw new Error("NEAR must have right operand");
        node = { type: "NEAR", distance, left: node, right };
        continue;
      }
      break;
    }
    return node;
  }

  function parseAnd() {
    let node = parseNear();
    while (true) {
      const tok = peek();
      if (tok && (tok.type === "AND" || tok.type === "NOT")) {
        if (tok.type === "AND") consume();
        // Implicit AND before NOT supports queries like "A AND B NOT C".
        const right = parseNear();
        if (!right) throw new Error("AND must have right operand");
        node = { type: "AND", left: node, right };
        continue;
      }
      break;
    }
    return node;
  }

  function parseOr() {
    let node = parseAnd();
    while (true) {
      const tok = peek();
      if (tok && tok.type === "OR") {
        consume();
        const right = parseAnd();
        if (!right) throw new Error("OR must have right operand");
        node = { type: "OR", left: node, right };
        continue;
      }
      break;
    }
    return node;
  }

  const ast = parseOr();
  if (pos !== tokens.length) {
    throw new Error("Unexpected tokens remaining in query");
  }
  return ast;
}

// Matching primitives
function matchTerm(value, tokens) {
  const spans = [];
  const startsWithPrefix = value.startsWith('@') || value.startsWith('#');
  
  tokens.forEach((tok, idx) => {
    if (startsWithPrefix) {
      // Query term has @ or # prefix - require exact match
      if (tok === value) spans.push([idx, idx + 1]);
    } else {
      // Query term has no prefix - match exact OR with @ or # prefix
      // e.g., "stryker" matches "stryker", "#stryker", "@stryker"
      if (tok === value || tok === `@${value}` || tok === `#${value}`) {
        spans.push([idx, idx + 1]);
      }
    }
  });
  return spans;
}

function matchWildcard(prefix, tokens) {
  const spans = [];
  const startsWithSpecial = prefix.startsWith('@') || prefix.startsWith('#');
  
  tokens.forEach((tok, idx) => {
    if (startsWithSpecial) {
      // Wildcard has @ or # - require prefix to match exactly
      if (tok.startsWith(prefix)) spans.push([idx, idx + 1]);
    } else {
      // Wildcard has no prefix - match with or without @ or #
      // e.g., "stryker*" matches "strykermed", "#strykermed", "@strykermed"
      if (tok.startsWith(prefix) || 
          tok.startsWith(`@${prefix}`) || 
          tok.startsWith(`#${prefix}`)) {
        spans.push([idx, idx + 1]);
      }
    }
  });
  return spans;
}

function matchPhrase(phraseTokens, tokens) {
  if (phraseTokens.length === 0) return [];
  const spans = [];
  
  // Helper to check if a single phrase token matches a text token
  function tokenMatches(phraseToken, textToken) {
    const startsWithPrefix = phraseToken.startsWith('@') || phraseToken.startsWith('#');
    if (startsWithPrefix) {
      return textToken === phraseToken;
    } else {
      return textToken === phraseToken || 
             textToken === `@${phraseToken}` || 
             textToken === `#${phraseToken}`;
    }
  }
  
  for (let i = 0; i <= tokens.length - phraseTokens.length; i += 1) {
    let ok = true;
    for (let j = 0; j < phraseTokens.length; j += 1) {
      if (!tokenMatches(phraseTokens[j], tokens[i + j])) {
        ok = false;
        break;
      }
    }
    if (ok) spans.push([i, i + phraseTokens.length]);
  }
  return spans;
}

function spanDistance(a, b) {
  const [aStart, aEnd] = a;
  const [bStart, bEnd] = b;
  if (aEnd <= bStart) return bStart - aEnd;
  if (bEnd <= aStart) return aStart - bEnd;
  return 0; // overlapping
}

function combineNearSpans(leftSpans, rightSpans, distance) {
  const combined = [];
  leftSpans.forEach((ls) => {
    rightSpans.forEach((rs) => {
      const d = spanDistance(ls, rs);
      if (d <= distance) {
        combined.push([Math.min(ls[0], rs[0]), Math.max(ls[1], rs[1])]);
      }
    });
  });
  return combined;
}

// Evaluation
function evaluatePositive(node, tokens) {
  if (!node) return { matched: true, spans: [], hasPositive: false };
  switch (node.type) {
    case "TERM": {
      const spans = matchTerm(node.value, tokens);
      return { matched: spans.length > 0, spans, hasPositive: true };
    }
    case "WILDCARD": {
      const spans = matchWildcard(node.prefix, tokens);
      return { matched: spans.length > 0, spans, hasPositive: true };
    }
    case "PHRASE": {
      const spans = matchPhrase(node.tokens, tokens);
      return { matched: spans.length > 0, spans, hasPositive: true };
    }
    case "NOT": {
      // NOT is not a positive contributor; treat as neutral true for conjunctions.
      const child = evaluatePositive(node.child, tokens);
      return { matched: true, spans: [], hasPositive: child.hasPositive }; // hasPositive propagates for detection
    }
    case "AND": {
      const left = evaluatePositive(node.left, tokens);
      const right = evaluatePositive(node.right, tokens);
      return {
        matched: left.matched && right.matched,
        spans: [...left.spans, ...right.spans],
        hasPositive: left.hasPositive || right.hasPositive,
      };
    }
    case "OR": {
      const left = evaluatePositive(node.left, tokens);
      const right = evaluatePositive(node.right, tokens);
      const matched = left.matched || right.matched;
      const spans = [];
      if (left.matched) spans.push(...left.spans);
      if (right.matched) spans.push(...right.spans);
      return { matched, spans, hasPositive: left.hasPositive || right.hasPositive };
    }
    case "NEAR": {
      const left = evaluatePositive(node.left, tokens);
      const right = evaluatePositive(node.right, tokens);
      const spans = (left.matched && right.matched)
        ? combineNearSpans(left.spans, right.spans, node.distance)
        : [];
      return {
        matched: spans.length > 0,
        spans,
        hasPositive: true,
      };
    }
    default:
      throw new Error(`Unknown node type: ${node.type}`);
  }
}

function checkForbidden(node, tokens) {
  if (!node) return false;
  if (node.type === "NOT") {
    const result = evaluatePositive(node.child, tokens);
    return result.matched;
  }
  if (node.type === "AND" || node.type === "OR" || node.type === "NEAR") {
    return checkForbidden(node.left, tokens) || checkForbidden(node.right, tokens);
  }
  return false;
}

function evaluateRule(ast, text) {
  const tokens = tokenizeArticle(text);
  const forbids = checkForbidden(ast, tokens);
  const positive = evaluatePositive(ast, tokens);
  if (forbids) {
    return { matched: false, spans: [] };
  }
  if (positive.hasPositive) {
    return { matched: positive.matched, spans: positive.matched ? mergeSpans(positive.spans) : [] };
  }
  // Negation-only: match if no forbidden tokens matched.
  return { matched: true, spans: [] };
}

function mergeSpans(spans) {
  if (spans.length === 0) return [];
  const sorted = spans.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged = [sorted[0]];
  for (let i = 1; i < sorted.length; i += 1) {
    const [curS, curE] = sorted[i];
    const last = merged[merged.length - 1];
    if (curS <= last[1]) {
      last[1] = Math.max(last[1], curE);
    } else {
      merged.push([curS, curE]);
    }
  }
  return merged;
}

function classifyBrandRules(rules, text) {
  const results = [];
  Object.entries(rules || {}).forEach(([brand, rule]) => {
    const ast = parseRule(rule || "");
    const evaluation = evaluateRule(ast, text || "");
    results.push({ brand, matched: evaluation.matched, spans: evaluation.spans });
  });
  return results;
}

const _internals = {
  tokenizeQuery,
  tokenizeArticle,
  tokenizePhrase,
  evaluatePositive,
  checkForbidden,
  mergeSpans,
};

export {
  parseRule,
  evaluateRule,
  classifyBrandRules,
  _internals,
};
