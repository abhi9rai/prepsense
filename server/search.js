const fs = require("fs");
const readlineSync = require("readline-sync");

const chunks = JSON.parse(fs.readFileSync("chunks.json", "utf-8"));

// Common words to ignore completely — they add noise, not signal
const STOPWORDS = new Set([
  "what", "is", "are", "the", "a", "an", "of", "in", "to", "and",
  "or", "for", "on", "how", "does", "do", "who", "which", "with",
]);

// Split text into clean word tokens (letters/numbers only)
function tokenize(text) {
  return text.toLowerCase().match(/[a-z0-9]+/g) || [];
}

function search(query, topN = 3) {
  const queryWords = tokenize(query).filter((w) => !STOPWORDS.has(w));

  if (queryWords.length === 0) {
    return [];
  }

  // How many chunks contain each query word (as a real token, not substring)
  const chunkTokens = chunks.map((c) => tokenize(c.text));

  const docFreq = {};
  for (const word of queryWords) {
    docFreq[word] = chunkTokens.filter((tokens) => tokens.includes(word)).length;
  }

  const scored = chunks.map((chunk, i) => {
    const tokens = chunkTokens[i];
    let score = 0;

    for (const word of queryWords) {
      const occurrences = tokens.filter((t) => t === word).length;
      if (occurrences > 0) {
        const rarityBoost = Math.log((chunks.length + 1) / (docFreq[word] + 1)) + 1;
        score += occurrences * rarityBoost;
      }
    }

    return { ...chunk, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.filter((c) => c.score > 0).slice(0, topN);
}

const question = readlineSync.question("Ask a question: ");
const results = search(question);

if (results.length === 0) {
  console.log("No relevant chunks found.");
} else {
  results.forEach((r, i) => {
    console.log(`\n---- Match ${i + 1} (score: ${r.score.toFixed(2)}) ----`);
    console.log(r.text);
  });
}