// routes/queryRoutes.js
// ─────────────────────────────────────────────────────────────────────────────
// NyayaSetu — Legal Query / Case Endpoints
//
// POST  /api/classify         – Groq LLM classification
// POST  /api/query            – save query (attaches user_id if logged in)
// GET   /api/queries          – all queries (admin/lawyer) or own (user)
// GET   /api/queries/:id      – single query with populated user+lawyer
// PUT   /api/query/:id        – update status / document_uploaded
// POST  /api/query/:id/respond – add a lawyer/admin response message
// POST  /api/analyze-document – extract text from uploaded file
// POST  /api/ai-analyze       – AI document risk analysis via Groq
// ─────────────────────────────────────────────────────────────────────────────

const express       = require("express");
const router        = express.Router();
const Query         = require("../models/Query");
const multer        = require("multer");
const WordExtractor = require("word-extractor");
const pdfjsLib      = require("pdfjs-dist/legacy/build/pdf.js");
// Suppress canvas/DOMMatrix warnings in Node.js (not needed server-side)
pdfjsLib.GlobalWorkerOptions.workerSrc = false;
const { protect, requireRole } = require("../middleware/auth");

// ── Upload middleware ─────────────────────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

const ALLOWED_EXTENSIONS = new Set(["txt", "pdf", "doc", "docx"]);
const wordExtractor       = new WordExtractor();

// ── Groq config ───────────────────────────────────────────────────────────────
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const AI_MODELS    = ["llama-3.3-70b-versatile", "gemma2-9b-it"];

const CLASSIFY_SYSTEM_PROMPT = `You are a senior legal classification expert specializing in Indian law.

A citizen has described their legal problem. Your job is to classify it and return ONLY a valid JSON object — no prose, no markdown, no explanation before or after.

JSON schema (all fields required):
{
  "category": "<exactly one of: Criminal Law | Family Law | Property Law | Labour Law | Corporate Law | Consumer Law | Cyber Law | Civil Law | Other>",
  "urgency": "<exactly one of: high | medium | low>",
  "confidence": "<exactly one of: High | Medium | Low>",
  "suggested_lawyer": "<specific lawyer type, e.g. 'Criminal Lawyer', 'Family Lawyer', 'Property Lawyer', 'Labour Lawyer', 'Cyber Crime Expert', 'Corporate Lawyer', 'Consumer Rights Lawyer', 'Civil Lawyer', 'General Lawyer'>",
  "reasoning": "<one sentence explaining why you chose this category and urgency>"
}

Rules:
- Violent crimes (stabbing, murder, assault, rape, kidnapping) → Criminal Law + HIGH urgency
- Domestic violence, dowry harassment → Family Law + HIGH urgency
- Workplace harassment, unpaid salary > 2 months → Labour Law + MEDIUM urgency
- Online fraud, hacking, data theft → Cyber Law + MEDIUM urgency
- Property disputes, rent not returned → Property Law + LOW to MEDIUM urgency
- Consumer fraud, defective products → Consumer Law + LOW urgency
- Company disputes, contracts → Corporate Law + LOW urgency
- Medical negligence, road accidents → Civil Law + MEDIUM urgency
- Urgency = high if: immediate physical danger, ongoing crime, person is arrested, court date imminent, life at risk
- Urgency = medium if: legal deadline approaching, financial harm ongoing, formal notices received
- Urgency = low if: dispute is ongoing but not time-sensitive
- Confidence = High if the category is unambiguous; Medium if 2-3 categories could apply; Low if it is vague
- Only respond with the JSON object, nothing else.`;

const DOCUMENT_AI_PROMPT = `You are a senior Indian legal expert and document risk analyst.

Analyze the provided legal document text and return ONLY a valid JSON object — no markdown fences, no prose, nothing outside the JSON.

JSON schema:
{
  "risk_level": "<exactly one of: High | Medium | Low>",
  "summary": "<2-3 sentence plain-English summary of what this document is about and its overall risk>",
  "risky_clauses": [
    { "clause": "<verbatim or near-verbatim text of the risky part>", "reason": "<why this is legally risky for the reader>" }
  ],
  "obligations": ["<list of key obligations the reader must fulfil>"],
  "advice": "<3-5 actionable steps the reader should take before signing or acting on this document>"
}

Risk level rules:
- High: document contains penalty clauses, indemnification at user's cost, irrevocable waivers, termination without notice, unlimited liability, or non-refundable deposits
- Medium: document has strict deadlines, arbitration clauses only favorable to one party, or unusual governing law jurisdictions
- Low: standard terms with minor obligations

Find at minimum 1 risky clause if one exists. If genuinely no risk exists, return an empty risky_clauses array.
Only respond with the JSON object.`;

// ── Shared Groq helper ────────────────────────────────────────────────────────
async function callGroqForJson(messages, temperature = 0.15) {
  if (!process.env.GROQ_API_KEY || process.env.GROQ_API_KEY === "your_groq_api_key_here") {
    throw new Error("GROQ_API_KEY is not configured. Please add a valid key to your .env file.");
  }
  let lastError = null;

  for (const model of AI_MODELS) {
    let groqRes, rawText, parsed;
    try {
      groqRes = await fetch(GROQ_API_URL, {
        method:  "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model, messages, temperature,
          max_tokens: 1024,
          response_format: { type: "json_object" },
          stream: false,
        }),
      });
      rawText = await groqRes.text();
    } catch (fetchErr) {
      lastError = fetchErr;
      continue;
    }

    try { parsed = JSON.parse(rawText); }
    catch (_) { lastError = new Error("Groq returned non-JSON envelope"); continue; }

    if (!groqRes.ok) {
      const code = parsed?.error?.code;
      lastError  = new Error(parsed?.error?.message || `HTTP ${groqRes.status}`);
      if (code === "model_decommissioned" || code === "model_not_found") continue;
      throw lastError;
    }

    const content = parsed?.choices?.[0]?.message?.content?.trim();
    if (!content) { lastError = new Error("Model returned empty content"); continue; }

    let result;
    try { result = JSON.parse(content); }
    catch (_) {
      const first = content.indexOf("{"), last = content.lastIndexOf("}");
      if (first !== -1 && last > first) {
        try { result = JSON.parse(content.slice(first, last + 1)); } catch (_) {}
      }
    }
    if (!result || typeof result !== "object") {
      lastError = new Error("Model content was not a JSON object");
      continue;
    }
    return result;
  }
  throw lastError || new Error("All Groq models failed");
}

// ── Text extraction helpers ───────────────────────────────────────────────────
function normalizeExtractedText(text) {
  return String(text || "").replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

async function extractTextFromUpload(file) {
  const ext = (file.originalname.split(".").pop() || "").toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error("Unsupported file type. Please upload .pdf, .doc, .docx, or .txt.");
  }
  if (ext === "txt") return normalizeExtractedText(file.buffer.toString("utf8"));
  if (ext === "pdf") {
    try {
      const uint8Array = new Uint8Array(file.buffer);
      const loadingTask = pdfjsLib.getDocument({ data: uint8Array, useSystemFonts: true });
      const pdfDoc = await loadingTask.promise;
      const numPages = pdfDoc.numPages;
      const pageTexts = [];
      for (let i = 1; i <= numPages; i++) {
        const page = await pdfDoc.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items.map(item => item.str).join(" ");
        pageTexts.push(pageText);
      }
      return normalizeExtractedText(pageTexts.join("\n"));
    } catch (err) {
      throw new Error("Could not parse PDF. " + (err.message || "The file may be encrypted or corrupted."));
    }
  }
  try {
    const extracted = await wordExtractor.extract(file.buffer);
    return normalizeExtractedText(extracted.getBody());
  } catch (_) {
    throw new Error("Could not extract text from Word document.");
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// ROUTE 1: POST /api/classify   (optionally authenticated)
// ═══════════════════════════════════════════════════════════════════════════════
router.post("/classify", async (req, res) => {
  try {
    const { query } = req.body || {};
    if (!query || typeof query !== "string") {
      return res.status(400).json({ success: false, message: "A 'query' string is required." });
    }
    const trimmed = query.trim();
    if (trimmed.length < 10) {
      return res.status(400).json({ success: false, message: "Query is too short (minimum 10 characters)." });
    }

    const messages = [
      { role: "system", content: CLASSIFY_SYSTEM_PROMPT },
      { role: "user",   content: `Legal query from Indian citizen:\n\n"${trimmed}"` },
    ];
    const result = await callGroqForJson(messages, 0.1);

    const VALID_CATEGORIES = new Set([
      "Criminal Law","Family Law","Property Law","Labour Law",
      "Corporate Law","Consumer Law","Cyber Law","Civil Law","Other"
    ]);
    const VALID_URGENCIES   = new Set(["high","medium","low"]);
    const VALID_CONFIDENCES = new Set(["High","Medium","Low"]);

    const category   = VALID_CATEGORIES.has(result.category) ? result.category : "Other";
    const urgency    = VALID_URGENCIES.has((result.urgency||"").toLowerCase()) ? result.urgency.toLowerCase() : "low";
    const confidence = VALID_CONFIDENCES.has(result.confidence) ? result.confidence : "Medium";
    const lawyerMap  = {
      "Criminal Law":"Criminal Lawyer","Family Law":"Family Lawyer",
      "Property Law":"Property Lawyer","Labour Law":"Labour Lawyer",
      "Corporate Law":"Corporate Lawyer","Consumer Law":"Consumer Rights Lawyer",
      "Cyber Law":"Cyber Crime Expert","Civil Law":"Civil Lawyer","Other":"General Lawyer",
    };
    const suggested_lawyer = (result.suggested_lawyer && String(result.suggested_lawyer).length > 3)
      ? result.suggested_lawyer : lawyerMap[category];
    const reasoning = String(result.reasoning || "").slice(0, 300);

    return res.status(200).json({ success: true, category, urgency, confidence, suggested_lawyer, reasoning });
  } catch (err) {
    console.error("[Classify] Error:", err.message);
    const isMissingKey = err.message.includes("GROQ_API_KEY");
    return res.status(isMissingKey ? 501 : 503).json({
      success: false,
      message: isMissingKey 
        ? "AI Classification unavailable: GROQ_API_KEY is missing in backend .env"
        : "Classification service temporarily unavailable.",
    });
  }
});


// ═══════════════════════════════════════════════════════════════════════════════
// ROUTE 2: POST /api/query   — save a query, optionally attach user_id
// ═══════════════════════════════════════════════════════════════════════════════
router.post("/query", async (req, res) => {
  try {
    // Try to identify logged-in user from token (optional — not enforced)
    let userId = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      try {
        const jwt     = require("jsonwebtoken");
        const decoded = jwt.verify(authHeader.split(" ")[1], process.env.JWT_SECRET);
        userId = decoded.id;
      } catch (_) {}
    }

    const {
      query_id, user_input, detected_category,
      confidence_score, urgency_level, suggested_lawyer_type,
      document_uploaded, status, title,
    } = req.body;

    if (!query_id || !user_input) {
      return res.status(400).json({ success: false, message: "query_id and user_input are required." });
    }

    const existing = await Query.findOne({ query_id });
    if (existing) {
      return res.status(409).json({ success: false, message: `Query ${query_id} already exists.` });
    }

    const query = await Query.create({
      query_id,
      user_id:               userId,
      user_input,
      title:                 title || user_input.slice(0, 80),
      detected_category:     detected_category     || "Other",
      confidence_score:      confidence_score      || "Low",
      urgency_level:         urgency_level         || "low",
      suggested_lawyer_type: suggested_lawyer_type || "General Lawyer",
      document_uploaded:     Boolean(document_uploaded),
      status:                status || "pending",
    });

    return res.status(201).json({ success: true, query });
  } catch (err) {
    const message = err.name === "ValidationError"
      ? Object.values(err.errors).map(e => e.message).join(", ")
      : "Server error — could not save query.";
    console.error("[Query] Save error:", err.message);
    return res.status(500).json({ success: false, message });
  }
});


// ═══════════════════════════════════════════════════════════════════════════════
// ROUTE 3: GET /api/queries
// — If user role: only own queries
// — If lawyer: only assigned queries
// — If admin or no auth: all queries
// ═══════════════════════════════════════════════════════════════════════════════
router.get("/queries", async (req, res) => {
  try {
    // Identify caller role from optional JWT
    let callerRole = null, callerId = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      try {
        const jwt     = require("jsonwebtoken");
        const decoded = jwt.verify(authHeader.split(" ")[1], process.env.JWT_SECRET);
        const User    = require("../models/User");
        const caller  = await User.findById(decoded.id).select("role");
        if (caller) { callerRole = caller.role; callerId = caller._id; }
      } catch (_) {}
    }

    let filter = {};
    if (callerRole === "user")   filter = { $or: [{ user_id: callerId }, { user_id: null }] };
    if (callerRole === "lawyer") filter = { lawyer_id: callerId };
    // admin → no filter (sees all)

    // Optional query param filters
    if (req.query.status)   filter.status             = req.query.status;
    if (req.query.urgency)  filter.urgency_level       = req.query.urgency;
    if (req.query.category) filter.detected_category   = req.query.category;
    if (req.query.lawyer_id && callerRole === "admin") filter.lawyer_id = req.query.lawyer_id;
    if (req.query.user_id   && callerRole === "admin") filter.user_id   = req.query.user_id;

    const queries = await Query.find(filter)
      .sort({ createdAt: -1 })
      .populate("user_id",   "name email")
      .populate("lawyer_id", "name email specialization");

    return res.status(200).json({ success: true, queries });
  } catch (err) {
    console.error("[Queries] Fetch error:", err.message);
    return res.status(500).json({ success: false, message: "Could not fetch queries." });
  }
});


// ═══════════════════════════════════════════════════════════════════════════════
// ROUTE 4: GET /api/queries/:id  — single query detail with population
// ═══════════════════════════════════════════════════════════════════════════════
router.get("/queries/:id", async (req, res) => {
  try {
    const query = await Query.findById(req.params.id)
      .populate("user_id",   "name email phone")
      .populate("lawyer_id", "name email specialization barCouncilId experience phone");

    if (!query) {
      return res.status(404).json({ success: false, message: "Query not found." });
    }
    return res.json({ success: true, query });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Could not fetch query." });
  }
});


// ═══════════════════════════════════════════════════════════════════════════════
// ROUTE 5: PUT /api/query/:id  — update status / document_uploaded
// ═══════════════════════════════════════════════════════════════════════════════
router.put("/query/:id", async (req, res) => {
  try {
    const allowedUpdates = {};
    const validStatuses  = ["pending","in_progress","resolved","submitted","analyzed","completed"];

    if (req.body.status !== undefined) {
      if (!validStatuses.includes(req.body.status)) {
        return res.status(400).json({
          success: false,
          message: `Invalid status. Must be one of: ${validStatuses.join(", ")}`,
        });
      }
      allowedUpdates.status = req.body.status;
    }
    if (req.body.document_uploaded !== undefined) {
      allowedUpdates.document_uploaded = Boolean(req.body.document_uploaded);
    }
    if (!Object.keys(allowedUpdates).length) {
      return res.status(400).json({ success: false, message: "No valid fields to update." });
    }

    const updated = await Query.findOneAndUpdate(
      { query_id: req.params.id },
      { $set: allowedUpdates },
      { new: true }
    );
    if (!updated) {
      return res.status(404).json({ success: false, message: `No query found with id ${req.params.id}.` });
    }
    return res.status(200).json({ success: true, query: updated });
  } catch (err) {
    console.error("[Query] Update error:", err.message);
    return res.status(500).json({ success: false, message: "Could not update query." });
  }
});


// ═══════════════════════════════════════════════════════════════════════════════
// ROUTE 6: POST /api/queries/:id/respond  — lawyer or admin adds a response
// ═══════════════════════════════════════════════════════════════════════════════
router.post("/queries/:id/respond", protect, requireRole("lawyer", "admin"), async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, message: "Response message cannot be empty." });
    }

    const query = await Query.findById(req.params.id);
    if (!query) {
      return res.status(404).json({ success: false, message: "Query not found." });
    }

    // Lawyer can only respond to their assigned queries
    if (req.user.role === "lawyer" &&
        query.lawyer_id &&
        query.lawyer_id.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: "You can only respond to queries assigned to you.",
      });
    }

    query.responses.push({
      author_id:   req.user._id,
      author_name: req.user.name,
      author_role: req.user.role,
      message:     message.trim(),
    });

    // Auto-advance status when lawyer first responds
    if (req.user.role === "lawyer" && query.status === "pending") {
      query.status = "in_progress";
    }

    await query.save();

    const populated = await Query.findById(query._id)
      .populate("user_id",   "name email")
      .populate("lawyer_id", "name email specialization");

    return res.status(201).json({
      success: true,
      message: "Response added.",
      query: populated,
    });
  } catch (err) {
    console.error("[Respond] Error:", err.message);
    return res.status(500).json({ success: false, message: "Could not add response." });
  }
});


// ═══════════════════════════════════════════════════════════════════════════════
// ROUTE 7: POST /api/analyze-document
// ═══════════════════════════════════════════════════════════════════════════════
router.post("/analyze-document", upload.single("document"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "No file uploaded. Use field name 'document'." });
    }
    const text = await extractTextFromUpload(req.file);
    if (!text || text.length < 30) {
      return res.status(422).json({ success: false, message: "Not enough readable text found in this file." });
    }
    return res.status(200).json({
      success:   true,
      fileName:  req.file.originalname,
      charCount: text.length,
      text,
    });
  } catch (err) {
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ success: false, message: "File too large. Maximum size is 10 MB." });
    }
    return res.status(400).json({ success: false, message: err.message });
  }
});


// ═══════════════════════════════════════════════════════════════════════════════
// ROUTE 8: POST /api/ai-analyze
// ═══════════════════════════════════════════════════════════════════════════════
router.post("/ai-analyze", async (req, res) => {
  try {
    const { text } = req.body || {};
    if (!text || typeof text !== "string" || text.trim().length < 30) {
      return res.status(400).json({ success: false, message: "Valid 'text' field (min 30 chars) required." });
    }
    const boundedText = text.trim().slice(0, 18000);
    const messages = [
      { role: "system", content: DOCUMENT_AI_PROMPT },
      { role: "user",   content: `Analyze this legal document:\n\n${boundedText}` },
    ];
    const result = await callGroqForJson(messages, 0.15);
    const VALID_RISK = { HIGH:"High", MEDIUM:"Medium", LOW:"Low" };
    const risk_level = VALID_RISK[String(result.risk_level||"").trim().toUpperCase()] || "Low";
    const summary    = String(result.summary || "").trim();
    const advice     = String(result.advice  || "").trim();
    if (!summary || !advice) {
      return res.status(500).json({ success: false, message: "AI analysis returned incomplete results." });
    }
    const risky_clauses = Array.isArray(result.risky_clauses)
      ? result.risky_clauses.map(c => ({
          clause: String(c?.clause||"").trim(),
          reason: String(c?.reason||"").trim()
        })).filter(c => c.clause && c.reason)
      : [];
    const obligations = Array.isArray(result.obligations)
      ? result.obligations.map(o => String(o).trim()).filter(Boolean)
      : [];

    return res.status(200).json({ success: true, risk_level, summary, risky_clauses, obligations, advice });
  } catch (err) {
    console.error("[DocAI] Error:", err.message);
    const isMissingKey = err.message.includes("GROQ_API_KEY");
    return res.status(isMissingKey ? 501 : 503).json({
      success: false,
      message: isMissingKey 
        ? "AI Analysis unavailable: GROQ_API_KEY is missing in backend .env"
        : "AI analysis service temporarily unavailable.",
    });
  }
});

module.exports = router;
