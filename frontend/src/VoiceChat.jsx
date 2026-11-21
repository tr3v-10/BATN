import { useEffect, useRef, useState } from "react";
import { Bot, Mic, MicOff, Send, Sparkles, Volume2 } from "lucide-react";
import "./VoiceChat.css";

const API = "http://localhost:5000/api/voice/chat";

function VoiceChat() {
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content: "Hi! I’m the BATN voice assistant. Ask me a question or use the microphone to speak."
    }
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState("");
  const recognitionRef = useRef(null);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  useEffect(() => () => {
    recognitionRef.current?.abort();
    window.speechSynthesis?.cancel();
  }, []);

  async function sendMessage(event) {
    event.preventDefault();
    const message = input.trim();
    if (!message || sending) return;

    const history = messages.slice(1).slice(-20).map(({ role, content }) => ({
      role,
      text: content
    }));

    setMessages((current) => [...current, { role: "user", content: message }]);
    setInput("");
    setError("");
    setSending(true);

    try {
      const response = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, history })
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Gemini could not answer. Please try again.");
      }

      setMessages((current) => [
        ...current,
        { role: "assistant", content: result.reply }
      ]);
    } catch (requestError) {
      setError(requestError.message || "Unable to reach the voice assistant.");
    } finally {
      setSending(false);
    }
  }

  function toggleRecording() {
    if (recording) {
      recognitionRef.current?.stop();
      return;
    }

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError("Voice input is not supported in this browser. You can type your message instead.");
      return;
    }

    setError("");
    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.onstart = () => setRecording(true);
    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      setInput((current) => `${current}${current ? " " : ""}${transcript}`);
    };
    recognition.onerror = (event) => {
      if (event.error !== "no-speech" && event.error !== "aborted") {
        setError("Microphone input failed. Check your browser microphone permissions.");
      }
      setRecording(false);
    };
    recognition.onend = () => setRecording(false);
    recognitionRef.current = recognition;

    try {
      recognition.start();
    } catch {
      setRecording(false);
      setError("Could not start microphone input. Please try again.");
    }
  }

  function speakMessage(content) {
    if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) {
      setError("Spoken playback is not supported in this browser.");
      return;
    }

    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new window.SpeechSynthesisUtterance(content));
  }

  return (
    <section className="voice-chat-card">
      <header className="voice-chat-header">
        <div className="voice-chat-avatar">
          <Bot size={22} />
        </div>
        <div>
          <h3>BATN Voice Assistant</h3>
          <p><span className="voice-online-dot" /> Gemini-powered chat</p>
        </div>
        <div className="voice-chat-sparkle"><Sparkles size={18} /></div>
      </header>

      <div className="voice-chat-messages" aria-live="polite">
        {messages.map((message, index) => (
          <article
            className={`voice-message ${message.role}`}
            key={`${message.role}-${index}`}
          >
            {message.role === "assistant" && (
              <div className="voice-message-avatar"><Bot size={16} /></div>
            )}
            <div className="voice-message-content">
              <p>{message.content}</p>
              {message.role === "assistant" && index > 0 && (
                <button
                  type="button"
                  className="voice-speak-button"
                  onClick={() => speakMessage(message.content)}
                  aria-label="Read response aloud"
                >
                  <Volume2 size={14} />
                  Read aloud
                </button>
              )}
            </div>
          </article>
        ))}
        {sending && (
          <div className="voice-typing" role="status">Gemini is thinking…</div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {error && <p className="voice-chat-error" role="alert">{error}</p>}

      <form className="voice-chat-composer" onSubmit={sendMessage}>
        <button
          type="button"
          className={`voice-mic-button ${recording ? "recording" : ""}`}
          onClick={toggleRecording}
          aria-label={recording ? "Stop recording" : "Start voice input"}
          title={recording ? "Stop recording" : "Speak"}
        >
          {recording ? <MicOff size={19} /> : <Mic size={19} />}
        </button>
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={recording ? "Listening…" : "Ask BATN anything…"}
          aria-label="Message the BATN voice assistant"
          maxLength={4000}
          disabled={sending}
        />
        <button
          className="voice-send-button"
          type="submit"
          disabled={!input.trim() || sending}
          aria-label="Send message"
        >
          <Send size={17} />
        </button>
      </form>
      <p className="voice-chat-disclaimer">
        The assistant can explain and guide, but cannot perform payments or account actions.
      </p>
    </section>
  );
}

export default VoiceChat;
