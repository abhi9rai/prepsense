require("dotenv").config();
const fs = require("fs");
const readlineSync = require("readline-sync");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const chunks = JSON.parse(fs.readFileSync("chunks.json", "utf-8"));

const STOPWORDS = new Set([
  "what", "is", "are", "the", "a", "an", "of", "in", "to", "and",
  "or", "for", "on", "how", "does", "do", "who", "which", "with",
]);

function tokenize(text) {
  return text.toLowerCase().match(/[a-z0-9]+/g) || [];
}

function search(query, topN = 3) {
  const queryWords = tokenize(query).filter((w) => !STOPWORDS.has(w));
  if (queryWords.length === 0) return [];

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

async function generateAnswer(query, matchedChunks, retries = 3) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });

  const context = matchedChunks
    .map((c, i) => `[Source ${i + 1}]\n${c.text}`)
    .join("\n\n");

  const prompt = `You are a study assistant helping a student prepare for CDS/AFCAT exams.
Answer the question using ONLY the context below. If the context doesn't fully answer it, say what's missing.
Keep the answer clear and exam-focused. Mention which Source number(s) you used.

Context:
${context}

Question: ${query}

Answer:`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const result = await model.generateContent(prompt);
      return result.response.text();
    } catch (err) {
      if (err.status === 503 && attempt < retries) {
        console.log(`Server busy, retrying (${attempt}/${retries})...`);
        await new Promise((resolve) => setTimeout(resolve, 3000));
      } else {
        throw err;
      }
    }
  }
}

async function main() {
  const question = readlineSync.question("Ask a question: ");
  const results = search(question);

  if (results.length === 0) {
    console.log("No relevant chunks found in your material.");
    return;
  }

  console.log("\n(Searching your notes...)\n");
  const answer = await generateAnswer(question, results);

  console.log("---- Answer ----");
  console.log(answer);
}

main();