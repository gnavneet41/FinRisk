import { useEffect, useRef, useState } from "react";
import { askQuestion } from "../api.js";

const SUGGESTIONS = [
  "Why is liquidity rated this way?",
  "What does the quick ratio measure?",
  "Is the high return on equity a good sign?",
  "Why wasn't interest coverage calculated?"
];

export default function ChatPanel({ report }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const listRef = useRef(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  async function send(question) {
    const q = question.trim();
    if (!q || busy) return;
    setInput("");
    const history = messages.map(({ role, content }) => ({ role, content }));
    setMessages((m) => [...m, { role: "user", content: q }]);
    setBusy(true);
    try {
      const res = await askQuestion({ question: q, reportId: report.id, history });
      setMessages((m) => [...m, {
        role: "assistant",
        content: res.answer,
        sources: res.sources,
        fallback: res.generated_by?.method === "rule_based"
      }]);
    } catch (e) {
      setMessages((m) => [...m, { role: "assistant", content: e.message, error: true }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="chat">
      <div className="chat-head">
        <h2>Ask the Risk Advisor</h2>
        <p>Answers come from this report and the knowledge base.</p>
      </div>

      <div className="chat-messages" ref={listRef} aria-live="polite">
        {messages.length === 0 && (
          <div className="chat-empty">
            <p>Try one of these:</p>
            {SUGGESTIONS.map((s) => (
              <button key={s} className="suggestion" onClick={() => send(s)}>{s}</button>
            ))}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`msg msg-${m.role} ${m.error ? "msg-error" : ""}`}>
            <p>{m.content}</p>
            {m.sources?.length > 0 && <p className="msg-sources">Sources: {m.sources.join(", ")}</p>}
            {m.fallback && <p className="msg-sources">LLM unavailable: answer built from retrieved facts.</p>}
          </div>
        ))}
        {busy && <div className="msg msg-assistant"><span className="spinner" aria-hidden="true" /> Thinking…</div>}
      </div>

      <form
        className="chat-input"
        onSubmit={(e) => { e.preventDefault(); send(input); }}
      >
        <label htmlFor="chat-q" className="sr-only">Your question</label>
        <input
          id="chat-q"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about a ratio or risk factor"
          maxLength={1000}
          disabled={busy}
        />
        <button className="btn btn-primary" disabled={busy || !input.trim()}>Ask</button>
      </form>
    </div>
  );
}
