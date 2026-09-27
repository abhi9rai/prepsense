# 📘 PrepSense

**A study assistant that turns your own PDFs into a searchable, question-answering knowledge base.**

🔗 **Live demo:** [https://prepsense-9lsz.onrender.com](https://prepsense-9lsz.onrender.com)
*(hosted on Render's free tier — first load after inactivity may take 30-50s to spin up)*

---

## What it does

Upload your study PDFs — notes, PYQ papers, vocabulary lists, anything — and ask questions in plain English. PrepSense finds the most relevant passages using **semantic search (embeddings)**, not just keyword matching, then generates a grounded, structured answer citing the exact source file and page number.

If your notes genuinely don't cover something, it says so instead of guessing — a confidence check gates every answer against actual retrieval quality.

## Why it's not just a chatbot wrapper

- **Real retrieval-augmented generation (RAG) pipeline**: PDF → page-aware text extraction → chunking → embeddings → vector similarity search → grounded generation
- **Confidence-gated answers**: if the top-matching content isn't similar enough to the question, it refuses to guess rather than hallucinating
- **Multi-document, multi-subject**: upload Polity, Biology, and Vocabulary PDFs together — search correctly discriminates between them per question
- **Per-user isolation**: multiple people can use the same deployed instance without seeing each other's uploaded documents
- **Page-level citations**: every answer traces back to `filename.pdf (p. N)`, so you can verify it against the source instantly

## Tech stack

- **Backend**: Node.js, Express
- **PDF processing**: `pdf-parse-new`, custom text-cleaning pipeline (handles common PDF extraction artifacts like duplicated overlapping text)
- **Search & generation**: text embedding model for semantic search, a lightweight generative language model for structured answer generation, accessed via API
- **Frontend**: Vanilla HTML/CSS/JS — drag-and-drop upload, animated chat interface
- **Hosting**: Render

## Architecture

PDF Upload
->
Page-by-page text extraction + cleanup
->
Chunking (150 words/chunk, tagged with source + page)
->
Embedding generation (via API)
->
[stored per-user, in-memory + JSON persistence]
->
Question → embedded → cosine similarity search against all chunks
->
Confidence check (reject if best match too weak)
->
Language model generates structured answer from top-matching chunks
->
Answer + page citations returned to UI


## Known limitations

- Free-tier hosting means uploaded documents don't persist across server restarts/redeploys — fine for demo use, not production-grade storage
- No real user accounts — isolation is via anonymous per-browser IDs, not authentication
- Shared API free-tier quota across all users of the live demo — rate-limited per user to keep it fair

## What's next

- MCQ/quiz generation mode
- Progress tracking across subjects
- Conversation memory for follow-up questions
- Persistent database instead of JSON file storage

---

Built by [Abhinav](https://github.com/abhi9rai)
