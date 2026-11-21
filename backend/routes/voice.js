const express = require("express");

const router = express.Router();
const supportedLanguages = new Set(["en", "sw"]);
const supportedIntents = new Set(["translate", "negotiate", "general"]);

router.post("/process", async (req, res) => {
  try {
    const { text, sourceLanguage = "en", targetLanguage = "sw" } = req.body || {};

    if (typeof text !== "string" || !text.trim() || text.length > 2000) {
      return res.status(400).json({ error: "Enter text between 1 and 2000 characters." });
    }

    if (!supportedLanguages.has(sourceLanguage) || !supportedLanguages.has(targetLanguage)) {
      return res.status(400).json({ error: "Only English and Kiswahili are supported." });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(503).json({ error: "Gemini is not configured. Add GEMINI_API_KEY to backend/.env." });
    }

    const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
    const prompt = `You are a bilingual English/Kiswahili assistant for BATN, a demo agentic transaction network.
Translate the user's message from language code ${sourceLanguage} to ${targetLanguage}.
Extract a negotiation request ONLY when the user clearly asks to buy or negotiate for an item. Never invent missing fields, agent IDs, authorization, approval, or claim that anything has executed.
Return only JSON with this exact schema:
{"translatedText":"translation","intent":"translate|negotiate|general","summary":"brief explanation","negotiation":{"item_description":null,"quantity":null,"initial_offer":null}}
For a negotiation, quantity must be a positive integer and initial_offer must be a positive number representing the proposed KES unit price. Use null for any field not clearly stated. For non-negotiation messages, set intent to translate or general and all negotiation fields to null.
User message: ${JSON.stringify(text.trim())}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    let geminiResponse;
    try {
      geminiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`,
        {
          method: "POST",
          signal: controller.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.1, responseMimeType: "application/json" }
          })
        }
      );
    } finally {
      clearTimeout(timeout);
    }

    const result = await geminiResponse.json();
    if (!geminiResponse.ok) {
      console.error("Gemini voice request failed:", result.error?.status || geminiResponse.status);
      return res.status(502).json({ error: "Gemini could not process the request. Check the key, model and quota." });
    }

    const raw = result.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!raw) return res.status(502).json({ error: "Gemini returned no result." });

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return res.status(502).json({ error: "Gemini returned an unreadable response. Please try again." });
    }

    const intent = supportedIntents.has(parsed.intent) ? parsed.intent : "general";
    const extracted = parsed.negotiation && typeof parsed.negotiation === "object" ? parsed.negotiation : {};
    const negotiation = {
      item_description: typeof extracted.item_description === "string" ? extracted.item_description.trim().slice(0, 200) || null : null,
      quantity: Number.isInteger(extracted.quantity) && extracted.quantity > 0 ? extracted.quantity : null,
      initial_offer: Number.isFinite(extracted.initial_offer) && extracted.initial_offer > 0 ? extracted.initial_offer : null
    };

    return res.json({
      translatedText: typeof parsed.translatedText === "string" ? parsed.translatedText : "",
      intent,
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      negotiation
    });
  } catch (error) {
    console.error("Voice assistant error:", error.name === "AbortError" ? "Gemini request timed out" : error.message);
    return res.status(error.name === "AbortError" ? 504 : 500).json({ error: "Unable to process the voice request." });
  }
});

module.exports = router;
