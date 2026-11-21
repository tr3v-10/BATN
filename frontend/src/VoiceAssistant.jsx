import { useEffect, useRef, useState } from "react";
import { Languages, Mic, MicOff, Send, Volume2, X } from "lucide-react";
import "./VoiceAssistant.css";

const API = (import.meta.env.VITE_API_BASE_URL || "http://localhost:5000").replace(/\/$/, "");

function speak(text, language) {
  if (!("speechSynthesis" in window) || !text) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = language === "sw" ? "sw-KE" : "en-US";
  window.speechSynthesis.speak(utterance);
}

async function request(path, options = {}) {
  const response = await fetch(`${API}/api${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || data.message || `Request failed (${response.status})`);
  return data;
}

export default function VoiceAssistant() {
  const [open, setOpen] = useState(false);
  const [sourceLanguage, setSourceLanguage] = useState("en");
  const [targetLanguage, setTargetLanguage] = useState("sw");
  const [text, setText] = useState("");
  const [result, setResult] = useState(null);
  const [agents, setAgents] = useState([]);
  const [buyerId, setBuyerId] = useState("");
  const [sellerId, setSellerId] = useState("");
  const [autoMode, setAutoMode] = useState(false);
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const recognitionRef = useRef(null);

  useEffect(() => {
    request("/agents")
      .then((data) => setAgents(Array.isArray(data) ? data.filter((agent) => agent.status === "active") : data.agents || []))
      .catch(() => setAgents([]));

    return () => {
      recognitionRef.current?.stop();
      window.speechSynthesis?.cancel();
    };
  }, []);

  function startListening() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      setError("Voice recognition is not available in this browser. Type your request instead.");
      return;
    }
    setError("");
    const recognition = new Recognition();
    recognition.lang = sourceLanguage === "sw" ? "sw-KE" : "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => setText(event.results[0][0].transcript);
    recognition.onerror = (event) => setError(`Microphone issue: ${event.error}. You can type your request.`);
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  }

  async function submitRequest(event) {
    event?.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    setError("");
    setResult(null);

    try {
      const parsed = await request("/voice/process", {
        method: "POST",
        body: JSON.stringify({ text: text.trim(), sourceLanguage, targetLanguage })
      });
      setResult(parsed);
      if (parsed.translatedText) speak(parsed.translatedText, targetLanguage);

      if (autoMode && parsed.intent === "negotiate") {
        const details = parsed.negotiation || {};
        if (!buyerId || !sellerId || !details.item_description || !details.quantity || !details.initial_offer) {
          setError("Choose active buyer and seller agents and clearly say the item, quantity, and proposed KES unit offer. BATN has not started the negotiation.");
          return;
        }

        const negotiation = await request("/negotiations", {
          method: "POST",
          body: JSON.stringify({
            buyer_agent_id: buyerId,
            seller_agent_id: sellerId,
            item_description: details.item_description,
            quantity: details.quantity,
            initial_offer: details.initial_offer
          })
        });

        if (negotiation.status === "accepted" && negotiation.requires_approval === false && negotiation.risk_assessment?.decision === "allow") {
          const payment = await request("/payments/initiate", {
            method: "POST",
            body: JSON.stringify({
              negotiation_id: negotiation.negotiation_id,
              idempotency_key: `voice-${window.crypto.randomUUID()}`
            })
          });
          const actionResult = `Agents reached an authorized agreement. BATN created a simulated payment intent for KES ${Number(payment.payment.amount).toLocaleString("en-KE")} (${payment.payment.status}). No money was transferred.`;
          setResult((current) => ({ ...current, actionResult }));
          speak("Agents reached an authorized agreement. A simulated payment intent was created. No money was transferred.", targetLanguage);
        } else {
          const actionResult = `BATN negotiation result: ${negotiation.status}. ${negotiation.message || "Approval or risk review is required; no payment intent was created."}`;
          setResult((current) => ({ ...current, actionResult }));
          speak(actionResult, targetLanguage);
        }
      }
    } catch (requestError) {
      setError(requestError.message || "Unable to contact BATN.");
    } finally {
      setBusy(false);
    }
  }

  const buyers = agents.filter((agent) => agent.role === "buyer");
  const sellers = agents.filter((agent) => agent.role === "seller");

  return (
    <>
      <button className="voice-launch" onClick={() => setOpen((value) => !value)} aria-label={open ? "Close voice assistant" : "Open voice assistant"}>
        {open ? <X size={20} /> : <Mic size={20} />}
        <span>{open ? "Close assistant" : "Voice AI"}</span>
      </button>
      {open && (
        <section className="voice-panel" aria-label="BATN voice assistant">
          <header className="voice-heading">
            <div><span className="voice-kicker">BATN ASSISTANT</span><h2>Speak, translate, act</h2></div>
            <button type="button" className="voice-close" onClick={() => setOpen(false)} aria-label="Close assistant"><X size={18} /></button>
          </header>
          <div className="voice-languages">
            <label>Speak in<select value={sourceLanguage} onChange={(event) => setSourceLanguage(event.target.value)}><option value="en">English</option><option value="sw">Kiswahili</option></select></label>
            <Languages size={17} aria-hidden="true" />
            <label>Translate to<select value={targetLanguage} onChange={(event) => setTargetLanguage(event.target.value)}><option value="sw">Kiswahili</option><option value="en">English</option></select></label>
          </div>
          <form onSubmit={submitRequest}>
            <label className="voice-input-label" htmlFor="voice-command">Your request</label>
            <textarea id="voice-command" value={text} onChange={(event) => setText(event.target.value)} maxLength={2000} placeholder={sourceLanguage === "sw" ? "Sema au andika ombi lako…" : "Speak or type your request…"} rows={3} />
            <div className="voice-controls">
              <button type="button" className={`voice-mic ${listening ? "is-listening" : ""}`} onClick={listening ? () => recognitionRef.current?.stop() : startListening} aria-label={listening ? "Stop listening" : "Start voice input"}>
                {listening ? <MicOff size={17} /> : <Mic size={17} />}{listening ? "Stop" : "Speak"}
              </button>
              <button type="submit" className="voice-send" disabled={busy || !text.trim()}>{busy ? "Working…" : "Send"}<Send size={15} /></button>
            </div>
          </form>
          <label className="auto-mode">
            <input type="checkbox" checked={autoMode} onChange={(event) => setAutoMode(event.target.checked)} />
            <span><strong>Mandate-based agent mode</strong><small>Agents may negotiate and create a simulated payment intent when BATN policy allows.</small></span>
          </label>
          {autoMode && <div className="voice-agent-selectors">
            <label>Active buyer<select value={buyerId} onChange={(event) => setBuyerId(event.target.value)}><option value="">Choose buyer</option>{buyers.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label>
            <label>Active seller<select value={sellerId} onChange={(event) => setSellerId(event.target.value)}><option value="">Choose seller</option>{sellers.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label>
            {(!buyers.length || !sellers.length) && <small>Activate a buyer and seller agent first.</small>}
          </div>}
          <p className="voice-safety-note">Automatic mode still enforces saved agent mandates and BATN risk checks. Approval or review stops automation. Payment is mock-only; no funds move.</p>
          {error && <p className="voice-message voice-error" role="alert">{error}</p>}
          {result && <div className="voice-result" aria-live="polite">
            <div><strong>Translation</strong><button type="button" onClick={() => speak(result.translatedText || result.summary, targetLanguage)} aria-label="Speak translation"><Volume2 size={16} /></button></div>
            <p>{result.translatedText || result.summary}</p>
            {result.intent === "negotiate" && <small>Detected request: {result.negotiation?.quantity || "?"} × {result.negotiation?.item_description || "item unclear"}, KES {result.negotiation?.initial_offer ?? "?"} per unit</small>}
            {result.actionResult && <p className="voice-action-result">{result.actionResult}</p>}
          </div>}
        </section>
      )}
    </>
  );
}
