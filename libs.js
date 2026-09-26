const fs = require("fs");
const pdf = require("pdf-parse-new");

function cleanText(text) {
  const lines = text.split("\n");
  const cleanedLines = lines.map((line) => {
    let prev;
    do {
      prev = line;
      line = line.replace(
        /([A-Za-z0-9][A-Za-z0-9\s&,.'()\-\/:]{2,100}?)\1/g,
        "$1"
      );
    } while (line !== prev);
    return line;
  });
  let result = cleanedLines.join("\n");
  result = result.replace(/\b(\d{2,6})\1\b/g, "$1");
  result = result.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n");
  return result.trim();
}

function chunkText(text, wordsPerChunk = 150) {
  const words = text.split(/\s+/);
  const chunks = [];
  for (let i = 0; i < words.length; i += wordsPerChunk) {
    const chunkWords = words.slice(i, i + wordsPerChunk);
    if (chunkWords.length < 10) continue;
    chunks.push(chunkWords.join(" "));
  }
  return chunks;
}

// Extract text page-by-page so every chunk knows its page number
async function processPDF(filePath, sourceName) {
  const dataBuffer = fs.readFileSync(filePath);
  const pages = [];

  function renderPage(pageData) {
    return pageData.getTextContent().then((textContent) => {
      let text = "";
      for (const item of textContent.items) {
        text += item.str + " ";
      }
      pages.push({ page: pageData.pageNumber, text });
      return text;
    });
  }

  await pdf(dataBuffer, { pagerender: renderPage });

  const allChunks = [];
  for (const p of pages) {
    const cleaned = cleanText(p.text);
    const chunks = chunkText(cleaned);
    chunks.forEach((text, index) => {
      allChunks.push({
        id: `${sourceName}_p${p.page}_${index}`,
        text,
        source: sourceName,
        page: p.page,
      });
    });
  }

  return allChunks;
}

// ---- Embeddings ----

async function getEmbedding(genAI, text, retries = 3) {
  const model = genAI.getGenerativeModel({ model: "gemini-embedding-001" });
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const result = await model.embedContent(text);
      return result.embedding.values;
    } catch (err) {
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } else {
        throw err;
      }
    }
  }
}

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Semantic search: compare query embedding against every chunk's embedding
function embeddingSearch(queryEmbedding, chunks, topN = 4) {
  const withScores = chunks
    .filter((c) => Array.isArray(c.embedding))
    .map((c) => ({ ...c, score: cosineSimilarity(queryEmbedding, c.embedding) }));

  withScores.sort((a, b) => b.score - a.score);
  return withScores.slice(0, topN);
}

module.exports = { processPDF, getEmbedding, embeddingSearch, cosineSimilarity };