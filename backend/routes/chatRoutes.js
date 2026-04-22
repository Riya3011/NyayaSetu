// routes/chatRoutes.js
// ─────────────────────────────────────────────────────────────────────────────
// NyayaSetu — AI Chatbot Proxy (NyayaBot)
//
// Endpoint:
//   POST /api/chat
//
// Request body:
//   { messages: [{ role: "user"|"assistant", content: "..." }] }
//
// Response:
//   { success: true, reply: "..." }
//
// The Groq API key stays server-side — never exposed to the browser.
// ─────────────────────────────────────────────────────────────────────────────

const express = require("express");
const router  = express.Router();

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

// Primary and fallback model — if primary is decommissioned, we retry
const MODELS = [
  "llama-3.3-70b-versatile",
  "gemma2-9b-it",
];

// System prompt injected server-side — users cannot override it
const SYSTEM_PROMPT = `You are NyayaBot, a knowledgeable and empathetic AI legal assistant specializing in Indian law. 

Your role:
- Explain legal concepts in clear, plain English that any citizen can understand
- Provide practical, actionable steps when users describe legal problems
- Always mention relevant Indian laws, acts, and sections where applicable
- Recommend consulting a qualified lawyer for serious matters
- Keep answers concise but thorough — aim for 3-6 sentences unless the topic requires more detail
- Format lists with bullet points and use **bold** for key terms
- NEVER fabricate laws, case numbers, or legal citations — only reference well-known statutes
- If unsure about something, say so clearly rather than guessing

Topics you help with: Criminal Law, Family Law, Property Law, Consumer Rights, Labour Law, Corporate Law, Cyber Law, Civil disputes, and general legal awareness in India.`;

// Maximum messages to include (system + last N turns) to stay within context limits
const MAX_HISTORY_TURNS = 20;

// Maximum allowed characters per user message
const MAX_MESSAGE_LENGTH = 3000;


// ── Input validation ────────────────────────────────────────────────────────
function validateMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return "messages must be a non-empty array";
  }

  for (const msg of messages) {
    if (!msg || typeof msg !== "object") return "Each message must be an object";
    if (!["user", "assistant"].includes(msg.role)) return `Invalid role: ${msg.role}`;
    if (typeof msg.content !== "string" || !msg.content.trim()) {
      return "Each message must have a non-empty string content";
    }
    if (msg.content.length > MAX_MESSAGE_LENGTH) {
      return `Message too long — max ${MAX_MESSAGE_LENGTH} characters`;
    }
  }

  // Last message must be from the user
  if (messages[messages.length - 1].role !== "user") {
    return "Last message must be from the user";
  }

  return null; // valid
}


// ── POST /api/chat ──────────────────────────────────────────────────────────
router.post("/chat", async (req, res) => {
  try {
    const { messages } = req.body || {};

    // Validate input
    const validationError = validateMessages(messages);
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }

    // Check API key is configured
    if (!process.env.GROQ_API_KEY) {
      console.error("[Chat] GROQ_API_KEY is not set");
      return res.status(500).json({
        success: false,
        message: "AI service is not configured. Please contact support.",
      });
    }

    // Trim history to avoid context overflow — keep last MAX_HISTORY_TURNS messages
    const trimmedMessages = messages.slice(-MAX_HISTORY_TURNS);

    // Build full message array: system prompt + trimmed history
    const fullMessages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...trimmedMessages,
    ];

    let reply = null;
    let lastError = null;

    // Try each model in sequence — stop on first success
    for (const model of MODELS) {
      try {
        console.log(`[Chat] Sending request to Groq with model: ${model}`);

        const groqResponse = await fetch(GROQ_API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
          },
          body: JSON.stringify({
            model,
            messages: fullMessages,
            temperature: 0.4,
            max_tokens: 1024,
            stream: false,
          }),
        });

        const rawText = await groqResponse.text();
        let payload;
        try {
          payload = JSON.parse(rawText);
        } catch (_) {
          throw new Error("Groq returned non-JSON response");
        }

        if (!groqResponse.ok) {
          const code = payload?.error?.code;
          // Only retry if model is decommissioned
          if (code === "model_decommissioned") {
            console.warn(`[Chat] Model ${model} decommissioned, trying next...`);
            lastError = new Error(`Model ${model} decommissioned`);
            continue;
          }
          throw new Error(payload?.error?.message || `Groq error: HTTP ${groqResponse.status}`);
        }

        reply = payload?.choices?.[0]?.message?.content?.trim();
        if (!reply) throw new Error("Groq returned an empty reply");

        // Success — stop retrying
        break;

      } catch (modelErr) {
        lastError = modelErr;
        console.error(`[Chat] Model ${model} failed:`, modelErr.message);
        // Continue to next model only for model_decommissioned
        if (!modelErr.message.includes("decommissioned")) break;
      }
    }

    if (!reply) {
      console.error("[Chat] All models failed:", lastError?.message);
      return res.status(503).json({
        success: false,
        message: "NyayaBot is temporarily unavailable. Please try again in a moment.",
      });
    }

    return res.status(200).json({ success: true, reply });

  } catch (err) {
    console.error("[Chat] Unexpected error:", err.message);
    return res.status(500).json({
      success: false,
      message: "An unexpected error occurred. Please try again.",
    });
  }
});


module.exports = router;
