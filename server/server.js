require("dotenv").config();
const express = require("express");
const multer = require("multer");
const fs = require("fs");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { processPDF, getEmbedding, embeddingSearch } = require("./libs");

const app = express();
const upload = multer({ dest: "uploads/" });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.use(express.json());
app.use(express.static("client/dist"));

let allChunks = [];
const CHUNKS_FILE = "all_chunks.json";
if (fs.existsSync(CHUNKS_FILE)) {
  allChunks = JSON.parse(fs.readFileSync(CHUNKS_FILE, "utf-8"));
  console.log(`Loaded ${allChunks.length} chunks from previous session.`);
}

function saveChunks() {
  fs.writeFileSync(CHUNKS_FILE, JSON.stringify(allChunks, null, 2));
}

// Every request must carry a userId (sent as a header from the frontend)
function getUserId(req) {
  return req.headers["x-user-id"] || "anonymous";
}

// ---- Simple per-user rate limiting ----
const RATE_LIMIT = 15; // max questions per user per hour
const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

const userRequestLog = new Map(); // userId -> array of timestamps

function isRateLimited(userId) {
  const now = Date.now();
  const timestamps = userRequestLog.get(userId) || [];
  const recent = timestamps.filter((t) => now - t < RATE_WINDOW_MS);

  if (recent.length >= RATE_LIMIT) {
    userRequestLog.set(userId, recent);
    return true;
  }

  recent.push(now);
  userRequestLog.set(userId, recent);
  return false;
}

// ---- Upload ----
app.post("/upload", upload.array("pdfs", 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "No files uploaded." });
    }
    const userId = getUserId(req);

    const results = [];
    for (const file of req.files) {
      const sourceName = Buffer.from(file.originalname, "latin1").toString("utf8");
      const newChunks = await processPDF(file.path, sourceName);

      for (const chunk of newChunks) {
        chunk.embedding = await getEmbedding(genAI, chunk.text);
        chunk.userId = userId;
      }

      allChunks = allChunks.concat(newChunks);
      fs.unlinkSync(file.path);
      results.push({ name: sourceName, chunksAdded: newChunks.length });
    }

    saveChunks();
    const userChunkCount = allChunks.filter((c) => c.userId === userId).length;
    res.json({ processed: results, totalChunks: userChunkCount });
  } catch (err) {
    console.error(err);
    if (err.status === 429) {
      return res.status(429).json({
        error: "PrepSense has hit its daily free usage limit for processing uploads. Please try again later.",
      });
    }
    res.status(500).json({ error: "Failed to process PDF(s)." });
  }
});

// ---- List documents (only this user's) ----
app.get("/documents", (req, res) => {
  const userId = getUserId(req);
  const userChunks = allChunks.filter((c) => c.userId === userId);

  const counts = {};
  for (const chunk of userChunks) {
    counts[chunk.source] = (counts[chunk.source] || 0) + 1;
  }
  const docs = Object.entries(counts).map(([source, chunkCount]) => ({ source, chunkCount }));
  res.json({ documents: docs, totalChunks: userChunks.length });
});

// ---- Remove one document (only this user's) ----
app.post("/remove", (req, res) => {
  const userId = getUserId(req);
  const { source } = req.body;
  if (!source) return res.status(400).json({ error: "No source specified." });

  const before = allChunks.length;
  allChunks = allChunks.filter((c) => !(c.source === source && c.userId === userId));
  saveChunks();

  res.json({ message: `Removed ${source}`, removedChunks: before - allChunks.length });
});

// ---- Clear all (only this user's) ----
app.post("/clear", (req, res) => {
  const userId = getUserId(req);
  allChunks = allChunks.filter((c) => c.userId !== userId);
  saveChunks();
  res.json({ message: "Your documents cleared." });
});

// ---- Structured answer generation ----
async function generateAnswer(query, matchedChunks, retries = 3) {
  const model = genAI.getGenerativeModel({ model: "gemini-flash-lite-latest" });

  const context = matchedChunks
    .map((c, i) => `[Source ${i + 1}: ${c.source}, page ${c.page}]\n${c.text}`)
    .join("\n\n");

  const prompt = `You are a study assistant helping a student prepare for CDS/AFCAT exams.

Answer using ONLY the context below. Structure your response EXACTLY like this, using these exact headers:

**Answer**
(2-4 concise sentences)

**Key Points**
- point 1
- point 2
- point 3

**Exam Tip**
(one short line connecting this to how it might appear in an exam — skip this section if not applicable)

If the context doesn't fully cover the question, add one line at the end: "Not fully covered in your notes: [what's missing]"

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
        await new Promise((resolve) => setTimeout(resolve, 3000));
      } else {
        throw err;
      }
    }
  }
}

const CONFIDENCE_THRESHOLD = 0.55;

app.post("/ask", async (req, res) => {
  try {
    const userId = getUserId(req);

    if (isRateLimited(userId)) {
      return res.status(429).json({
        error: `You've hit the limit of ${RATE_LIMIT} questions/hour on this shared demo. Please wait a bit and try again.`,
      });
    }

    const { question } = req.body;
    if (!question) return res.status(400).json({ error: "No question provided." });

    const userChunks = allChunks.filter((c) => c.userId === userId);
    if (userChunks.length === 0) {
      return res.json({ answer: "No documents uploaded yet. Upload a PDF first.", sources: [], confidence: "none" });
    }

    const queryEmbedding = await getEmbedding(genAI, question);
    const results = embeddingSearch(queryEmbedding, userChunks, 4);

    const topScore = results.length > 0 ? results[0].score : 0;

    if (topScore < CONFIDENCE_THRESHOLD) {
      return res.json({
        answer: "I couldn't find this in your uploaded material. Try rephrasing, or upload the relevant document.",
        sources: [],
        confidence: "low",
      });
    }

    const answer = await generateAnswer(question, results);

    const seen = new Set();
    const sources = [];
    for (const r of results) {
      const key = `${r.source}::${r.page}`;
      if (!seen.has(key)) {
        seen.add(key);
        sources.push(`${r.source} (p. ${r.page})`);
      }
    }

    const confidence = topScore > 0.75 ? "high" : topScore > 0.6 ? "medium" : "low";

    res.json({ answer, sources, confidence });
  } catch (err) {
    console.error(err);
    if (err.status === 429) {
      return res.status(429).json({
        error: "PrepSense has hit its daily free usage limit. Please try again later (resets daily).",
      });
    }
    res.status(500).json({ error: "Failed to generate answer. Please try again." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});