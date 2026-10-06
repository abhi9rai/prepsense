import { useState, useEffect, useRef } from "react";
import { FileText, UploadCloud, Trash2, SendHorizontal, MessageSquare, Library, Target, BarChart3, X, Loader2 } from "lucide-react";

// Same localStorage key as the old UI, so existing users keep their documents.
const USER_ID = (() => {
  let id = localStorage.getItem("prepsense_user_id");
  if (!id) {
    id = "user_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem("prepsense_user_id", id);
  }
  return id;
})();

async function api(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { "x-user-id": USER_ID, ...opts.headers } });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || "Request failed.");
  return data;
}

const SUGGESTIONS = ["Summarize the main ideas in my notes", "List the key terms I should remember", "What are the most important facts here?"];
const CONFIDENCE = { high: "High confidence", medium: "Medium confidence", low: "Low confidence" };

// Renders Gemini's **bold** / bullet output as React elements (no innerHTML, so no XSS).
const Inline = ({ t }) => t.split(/\*\*(.+?)\*\*/g).map((p, i) => (i % 2 ? <strong key={i}>{p}</strong> : p));

function Markdown({ text }) {
  const out = [];
  let list = [];
  const flush = () => {
    if (list.length) out.push(<ul key={out.length}>{list.map((l, i) => <li key={i}><Inline t={l} /></li>)}</ul>);
    list = [];
  };
  text.split("\n").forEach((raw) => {
    const l = raw.trim();
    if (/^[*-]\s+/.test(l)) return list.push(l.replace(/^[*-]\s+/, ""));
    flush();
    if (!l) return;
    const h = l.match(/^\*\*(.+?)\*\*$/);
    out.push(h ? <h4 key={out.length}>{h[1]}</h4> : <p key={out.length}><Inline t={l} /></p>);
  });
  flush();
  return out;
}

function Message({ m }) {
  if (m.role === "user") return <div className="msg user"><div className="bubble">{m.text}</div></div>;
  return (
    <div className="msg bot">
      <div className="who">Sensei</div>
      <div className={"bubble" + (m.error ? " error" : "")}>
        {m.loading ? <span className="dots"><i /><i /><i /></span> : (
          <>
            {m.confidence && m.confidence !== "none" && <span className={"conf " + m.confidence}>{CONFIDENCE[m.confidence]}</span>}
            <Markdown text={m.text || "No answer."} />
            {m.sources?.length > 0 && (
              <div className="sources">
                {m.sources.map((s) => <span className="chip" key={s}><FileText size={13} />{s}</span>)}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const [docs, setDocs] = useState([]);
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [drag, setDrag] = useState(false);
  const [note, setNote] = useState(null);
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const fileRef = useRef();
  const logRef = useRef();

  const loadDocs = () => api("/documents").then((d) => setDocs(d.documents || [])).catch(() => setNote({ error: true, text: "Could not load your library." }));
  useEffect(() => { loadDocs(); }, []);
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" }); }, [msgs]);

  const pick = (list) => setFiles(Array.from(list).filter((f) => f.type === "application/pdf"));

  async function upload() {
    if (!files.length) return setNote({ error: true, text: "Choose at least one PDF first." });
    const body = new FormData();
    files.forEach((f) => body.append("pdfs", f));
    setUploading(true);
    setNote({ text: `Reading ${files.length} file(s) and indexing them. Large PDFs can take a minute.` });
    try {
      const d = await api("/upload", { method: "POST", body });
      setNote({ text: `Added ${d.processed.map((p) => `${p.name} (${p.chunksAdded} chunks)`).join(", ")}.` });
      setFiles([]);
      loadDocs();
    } catch (e) {
      setNote({ error: true, text: e.message });
    }
    setUploading(false);
  }

  async function remove(source) {
    if (!confirm(`Remove "${source}"?`)) return;
    await api("/remove", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source }) });
    loadDocs();
  }

  async function clearAll() {
    if (!confirm("Remove all your uploaded documents?")) return;
    const d = await api("/clear", { method: "POST" });
    setNote({ text: d.message });
    loadDocs();
  }

  async function ask(q = input) {
    q = q.trim();
    if (!q || thinking) return;
    setInput("");
    setThinking(true);
    setMsgs((m) => [...m, { role: "user", text: q }, { role: "bot", loading: true }]);
    let reply;
    try {
      const d = await api("/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: q }) });
      reply = { role: "bot", text: d.answer, sources: d.sources, confidence: d.confidence };
    } catch (e) {
      reply = { role: "bot", text: e.message, error: true };
    }
    setMsgs((m) => [...m.slice(0, -1), reply]);
    setThinking(false);
  }

  return (
    <div className="app">
      <aside className="side">
        <div className="logo">PrepSense</div>
        <nav>
          <a className="active"><MessageSquare size={16} />Ask Sensei</a>
          <a><Library size={16} />Library</a>
          <a className="off"><Target size={16} />Quiz<em>Soon</em></a>
          <a className="off"><BarChart3 size={16} />Progress<em>Soon</em></a>
        </nav>
      </aside>

      <main className="chat">
        <header>
          <h1>Ask your notes anything</h1>
          <p>Answers come only from your own PDFs, with the page they were found on.</p>
        </header>

        <div className="log" ref={logRef}>
          {msgs.length === 0 ? (
            <div className="empty">
              <h2>{docs.length ? "What do you want to revise?" : "Start by adding a PDF"}</h2>
              <p>{docs.length ? "Try one of these, or type your own question." : "Drop a PDF in the panel on the right, then ask questions about it here."}</p>
              {docs.length > 0 && (
                <div className="suggest">{SUGGESTIONS.map((s) => <button key={s} onClick={() => ask(s)}>{s}</button>)}</div>
              )}
            </div>
          ) : msgs.map((m, i) => <Message m={m} key={i} />)}
        </div>

        <div className="ask">
          <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ask()} placeholder="Ask anything from your notes..." aria-label="Your question" />
          <button onClick={() => ask()} disabled={thinking || !input.trim()} aria-label="Send"><SendHorizontal size={18} /></button>
        </div>
      </main>

      <aside className="panel">
        <section>
          <h3>Add study material</h3>
          <div
            className={"drop" + (drag ? " over" : "")}
            onClick={() => fileRef.current.click()}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files); }}
          >
            <UploadCloud size={26} />
            <span>Drop PDFs here, or click to browse</span>
            <input ref={fileRef} type="file" accept="application/pdf" multiple hidden onChange={(e) => pick(e.target.files)} />
          </div>
          {files.map((f) => (
            <div className="file" key={f.name}><FileText size={14} />{f.name}<button onClick={() => setFiles(files.filter((x) => x !== f))} aria-label={`Remove ${f.name}`}><X size={14} /></button></div>
          ))}
          <button className="primary" onClick={upload} disabled={uploading}>
            {uploading ? <><Loader2 size={16} className="spin" />Indexing...</> : "Upload"}
          </button>
          {note && <p className={"note" + (note.error ? " bad" : "")}>{note.text}</p>}
        </section>

        <section>
          <div className="row"><h3>Your library</h3>{docs.length > 0 && <button className="link" onClick={clearAll}><Trash2 size={13} />Clear all</button>}</div>
          {docs.length === 0 ? <p className="muted">No documents yet.</p> : docs.map((d) => (
            <div className="doc" key={d.source}>
              <FileText size={15} />
              <div><b>{d.source}</b><small>{d.chunkCount} chunks</small></div>
              <button onClick={() => remove(d.source)} aria-label={`Remove ${d.source}`}><X size={15} /></button>
            </div>
          ))}
        </section>
      </aside>
    </div>
  );
}
