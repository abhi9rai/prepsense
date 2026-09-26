function getUserId() {
  let id = localStorage.getItem("prepsense_user_id");
  if (!id) {
    id =
      "user_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem("prepsense_user_id", id);
  }
  return id;
}
const USER_ID = getUserId();
let selectedFiles = [];

const dropZone = document.getElementById("drop-zone");
const pdfInput = document.getElementById("pdf-input");

dropZone.addEventListener("click", () => pdfInput.click());
dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("dragover");
});
dropZone.addEventListener("dragleave", () =>
  dropZone.classList.remove("dragover"),
);
dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("dragover");
  handleFiles(e.dataTransfer.files);
});
pdfInput.addEventListener("change", () => handleFiles(pdfInput.files));

function handleFiles(fileList) {
  selectedFiles = Array.from(fileList).filter(
    (f) => f.type === "application/pdf",
  );
  renderFileChips();
}

function renderFileChips() {
  const container = document.getElementById("file-list");
  container.innerHTML = selectedFiles.length
    ? selectedFiles
        .map((f) => `<span class="file-chip">📄 ${f.name}</span>`)
        .join("")
    : "";
}

async function uploadPDFs() {
  const status = document.getElementById("status");
  if (selectedFiles.length === 0) {
    status.textContent = "Please select at least one PDF.";
    return;
  }

  const formData = new FormData();
  selectedFiles.forEach((f) => formData.append("pdfs", f));

  status.textContent = `Uploading & embedding ${selectedFiles.length} file(s)... this can take a bit for large PDFs.`;

  try {
    const res = await fetch("/upload", {
      method: "POST",
      headers: { "x-user-id": USER_ID },
      body: formData,
    });
    const data = await res.json();
    if (data.error) {
      status.textContent = "Error: " + data.error;
    } else {
      const names = data.processed
        .map((p) => `${p.name} (${p.chunksAdded} chunks)`)
        .join(", ");
      status.textContent = `✅ Processed: ${names} — total chunks: ${data.totalChunks}`;
      selectedFiles = [];
      renderFileChips();
      pdfInput.value = "";
      loadDocuments();
    }
  } catch (err) {
    status.textContent = "Upload failed: " + err.message;
  }
}

async function loadDocuments() {
  const docList = document.getElementById("doc-list");
  try {
    const res = await fetch("/documents", {
      headers: { "x-user-id": USER_ID },
    });
    const data = await res.json();
    if (!data.documents || data.documents.length === 0) {
      docList.innerHTML = `<div id="no-docs">No documents uploaded yet.</div>`;
      return;
    }
    docList.innerHTML = data.documents
      .map(
        (d) => `
        <div class="doc-item">
          <span class="doc-name">📄 ${d.source} — ${d.chunkCount} chunks</span>
          <button onclick="removeDoc('${d.source.replace(/'/g, "\\'")}')">Remove</button>
        </div>`,
      )
      .join("");
  } catch (err) {
    docList.innerHTML = `<div id="no-docs">Could not load documents.</div>`;
  }
}

async function removeDoc(source) {
  if (!confirm(`Remove "${source}"?`)) return;
  await fetch("/remove", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-user-id": USER_ID },
    body: JSON.stringify({ source }),
  });
  loadDocuments();
}

async function clearDocs() {
  if (!confirm("Remove all uploaded documents?")) return;
  const status = document.getElementById("status");
  const res = await fetch("/clear", { method: "POST", headers: { "x-user-id": USER_ID } });
  const data = await res.json();
  status.textContent = data.message;
  loadDocuments();
}

function renderMarkdown(text) {
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  html = html.replace(/^\*\*(.+?)\*\*$/gm, "<h4>$1</h4>");
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  const lines = html.split("\n");
  let out = [];
  let inList = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^[\*\-]\s+/.test(trimmed)) {
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push(`<li>${trimmed.replace(/^[\*\-]\s+/, "")}</li>`);
    } else {
      if (inList) {
        out.push("</ul>");
        inList = false;
      }
      if (trimmed)
        out.push(trimmed.startsWith("<h4>") ? trimmed : `<p>${trimmed}</p>`);
    }
  }
  if (inList) out.push("</ul>");
  return out.join("");
}

function confidenceBadge(confidence) {
  if (!confidence || confidence === "none") return "";
  const labels = {
    high: "High confidence",
    medium: "Medium confidence",
    low: "Low confidence",
  };
  return `<div class="confidence-badge confidence-${confidence}">${labels[confidence]}</div>`;
}

function sourceCards(sources) {
  if (!sources || sources.length === 0) return "";
  return sources
    .map(
      (s) => `<div class="source-card"><span class="dot">📄</span> ${s}</div>`,
    )
    .join("");
}

async function askQuestion() {
  const input = document.getElementById("question-input");
  const chatLog = document.getElementById("chat-log");
  const question = input.value.trim();
  if (!question) return;

  chatLog.innerHTML += `
    <div class="msg user-msg">
      <div class="msg-label">You</div>
      <div class="bubble">${question}</div>
    </div>`;
  input.value = "";

  const loadingId = "loading-" + Date.now();
  chatLog.innerHTML += `
    <div class="msg bot-msg" id="${loadingId}">
      <div class="msg-label">Sensei</div>
      <div class="bubble"><span class="typing-dots"><span></span><span></span><span></span></span></div>
    </div>`;
  chatLog.scrollTop = chatLog.scrollHeight;

  try {
    const res = await fetch("/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-user-id": USER_ID },
      body: JSON.stringify({ question }),
    });
    const data = await res.json();

    const loadingDiv = document.getElementById(loadingId);
    const badge = confidenceBadge(data.confidence);
    const bodyHtml = renderMarkdown(data.answer || data.error || "No answer.");
    const sources = sourceCards(data.sources);

    loadingDiv.querySelector(".bubble").innerHTML = badge + bodyHtml + sources;
  } catch (err) {
    document.getElementById(loadingId).querySelector(".bubble").textContent =
      "Error: " + err.message;
  }

  chatLog.scrollTop = chatLog.scrollHeight;
}

document.getElementById("question-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") askQuestion();
});

loadDocuments();
