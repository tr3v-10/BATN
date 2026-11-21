const express = require("express");

const router = express.Router();

router.post("/process", async (req, res) => {
  try {
    const { text, sourceLanguage = "en", targetLanguage = "sw" } = req.body;

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

    const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
    const prompt = `You are BATN's secure voice translation assistant.
Supported languages: English (en) and Kiswahili (sw).
Translate the user text naturally from ${sourceLanguage} to ${targetLanguage}.
Also identify whether the text is requesting a BATN action such as navigating, searching, creating an agent, reviewing a transaction, or payment.
Never execute an action or claim that an action occurred.
Return only valid JSON with this shape:
{"translatedText":"...","intent":"general|navigate|search|agent|transaction|payment","summary":"...","requiresConfirmation":true}
Set requiresConfirmation to true for payments, transaction changes, agent changes, or sensitive actions.

User text: ${text}`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, responseMimeType: "application/json" }
        })
      }
    );

    const result = await response.json();

    if (!response.ok) {
      console.error("Gemini voice error:", result);
      return res.status(response.status).json({ error: "Gemini could not process the request." });
    }

    const raw = result.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!raw) {
      return res.status(502).json({ error: "Gemini returned no result." });
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { translatedText: raw, intent: "general", summary: raw, requiresConfirmation: false };
    }

    return res.json(parsed);
  } catch (error) {
    console.error("Voice assistant error:", error);
    return res.status(500).json({ error: "Unable to process voice request." });
  }
});

module.exports = router;
