const express = require("express");

const router = express.Router();

// ---------- Gemini model fallback ----------

// Newest first. Add/remove as Google ships or retires models.
const DEFAULT_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite"
];

// Optional override in .env: GEMINI_MODELS=gemini-3.8-flash,gemini-3.7-flash
// (GEMINI_MODEL still works and is tried first)
function getModelList() {
  const fromEnv = [process.env.GEMINI_MODELS, process.env.GEMINI_MODEL]
    .filter(Boolean)
    .join(",")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set([...fromEnv, ...DEFAULT_MODELS])];
}

// Models that returned 404 (retired/not found) are skipped for an hour,
// so we don't waste a round trip on them every request.
const deadModels = new Map();
const DEAD_TTL_MS = 60 * 60 * 1000;

// Status codes where trying the next model makes sense.
const RETRYABLE = new Set([404, 429, 500, 503]);

async function generateWithFallback(apiKey, body) {
  const now = Date.now();
  const all = getModelList();
  const alive = all.filter((m) => (deadModels.get(m) || 0) < now);
  const toTry = alive.length ? alive : all; // if everything is "dead", retry them all

  let last = { status: 502, error: "No Gemini model available." };

  for (const model of toTry) {
    let response;
    try {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey
          },
          body: JSON.stringify(body)
        }
      );
    } catch (err) {
      console.warn(`Gemini [${model}] network error:`, err.message);
      last = { status: 502, error: err.message };
      continue;
    }

    let result;
    try {
      result = await response.json();
    } catch {
      last = { status: 502, error: "Unreadable response" };
      continue;
    }

    if (response.ok) {
      return { ok: true, model, result };
    }

    const message = result?.error?.message || String(response.status);
    console.warn(`Gemini [${model}] failed (${response.status}): ${message}`);

    if (response.status === 404) {
      deadModels.set(model, now + DEAD_TTL_MS);
    }

    if (RETRYABLE.has(response.status)) {
      last = { status: response.status, error: message };
      continue; // try next model
    }

    // 400 / 401 / 403 etc: bad request or bad key. Another model won't fix it.
    return { ok: false, status: response.status, error: message };
  }

  return { ok: false, ...last };
}

function sendGeminiError(res, out) {
  if (out.status === 503) {
    return res.status(503).json({
      error: "Gemini is temporarily unavailable. Please try again shortly."
    });
  }
  if (out.status === 429) {
    return res.status(429).json({
      error: "Gemini is rate limited. Please try again shortly."
    });
  }
  return res.status(502).json({ error: "Gemini could not process the request." });
}

// ---------- Routes ----------

router.post("/chat", async (req, res) => {
  try {
    const { message, history = [] } = req.body || {};

    if (typeof message !== "string" || !message.trim() || message.length > 4000) {
      return res.status(400).json({
        error: "A message between 1 and 4000 characters is required."
      });
    }

    if (
      !Array.isArray(history) ||
      history.length > 20 ||
      history.some((item) =>
        !item ||
        !["user", "assistant"].includes(item.role) ||
        typeof item.text !== "string" ||
        !item.text.trim() ||
        item.text.length > 4000
      )
    ) {
      return res.status(400).json({ error: "Chat history is invalid." });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(503).json({
        error: "Gemini is not configured. Add GEMINI_API_KEY to the root .env file."
      });
    }

    const out = await generateWithFallback(apiKey, {
      systemInstruction: {
        parts: [{
          text: "You are BATN's conversational voice assistant. Be helpful, concise, and respond in the language the user uses. You can explain BATN concepts and help users understand how to navigate the workspace. You cannot access live account data or perform actions. Never claim to have created agents, changed transactions, initiated payments, or performed any other action. For sensitive or consequential operations, explain that the user must review and confirm them in the BATN interface."
        }]
      },
      contents: [
        ...history.map((item) => ({
          role: item.role === "assistant" ? "model" : "user",
          parts: [{ text: item.text }]
        })),
        { role: "user", parts: [{ text: message.trim() }] }
      ],
      generationConfig: { temperature: 0.6, maxOutputTokens: 512 }
    });

    if (!out.ok) {
      console.error("Gemini voice chat error:", out.error);
      return sendGeminiError(res, out);
    }

    const reply = out.result.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || "")
      .join("")
      .trim();

    if (!reply) {
      return res.status(502).json({ error: "Gemini returned no chat response." });
    }

    return res.json({ reply });
  } catch (error) {
    console.error("Voice chat error:", error);
    return res.status(500).json({ error: "Unable to process the voice chat request." });
  }
});

router.post("/process", async (req, res) => {
  try {
    const { text, sourceLanguage = "en", targetLanguage = "sw" } = req.body || {};

    if (!text || typeof text !== "string" || !text.trim()) {
      return res.status(400).json({ error: "Voice text is required." });
    }

    if (!["en", "sw"].includes(sourceLanguage) || !["en", "sw"].includes(targetLanguage)) {
      return res.status(400).json({ error: "Only English and Kiswahili are supported." });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(503).json({
        error: "Gemini is not configured. Add GEMINI_API_KEY to backend/.env."
      });
    }

    const prompt = `You are BATN's secure voice translation assistant.
Supported languages: English (en) and Kiswahili (sw).
Translate the user text naturally from ${sourceLanguage} to ${targetLanguage}.
Also identify whether the text is requesting a BATN action such as navigating, searching, creating an agent, reviewing a transaction, or payment.
Never execute an action or claim that an action occurred.
Return only valid JSON with this shape:
{"translatedText":"...","intent":"general|navigate|search|agent|transaction|payment","summary":"...","requiresConfirmation":true}
Set requiresConfirmation to true for payments, transaction changes, agent changes, or sensitive actions.

User text: ${text}`;

    const out = await generateWithFallback(apiKey, {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, responseMimeType: "application/json" }
    });

    if (!out.ok) {
      console.error("Gemini voice error:", out.error);
      return sendGeminiError(res, out);
    }

    const raw = out.result.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!raw) {
      return res.status(502).json({ error: "Gemini returned no result." });
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { translatedText: raw, intent: "general", summary: raw, requiresConfirmation: true };
    }

    return res.json(parsed);
  } catch (error) {
    console.error("Voice assistant error:", error);
    return res.status(500).json({ error: "Unable to process voice request." });
  }
});

module.exports = router;