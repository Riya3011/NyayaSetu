/**
 * NyayaSetu – QueryStore (v4 – LLM Classification)
 *
 * All classification is now done server-side by Groq via POST /api/classify.
 * No keyword lists. No local guessing. Real AI understanding.
 *
 * Public API (unchanged — all pages call the same functions as before):
 *   QueryStore.createQuery(userInput)          → classified + saved query
 *   QueryStore.loadAll()                       → all queries from MongoDB
 *   QueryStore.updateQuery(queryId, fields)    → patch status / document_uploaded
 *   QueryStore.attachDocumentToLatest()        → marks latest query as having doc
 */

const QueryStore = (() => {

  const API_BASE = "http://localhost:5050/api";

  // ── Internal fetch helper ─────────────────────────────────────────────────
  // Throws a descriptive Error on network failure or API-level errors.
  async function apiFetch(path, options = {}) {
    // Always attach the JWT token so the backend knows which user is calling
    const token = localStorage.getItem("ns_token");
    const headers = {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    };

    let res;
    try {
      res = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers,
      });
    } catch (networkErr) {
      throw new Error(
        "Cannot connect to the NyayaSetu backend. " +
        "Please make sure the server is running at localhost:5050."
      );
    }

    let data;
    try {
      data = await res.json();
    } catch (_) {
      throw new Error(`Server returned an unexpected response (HTTP ${res.status}).`);
    }

    if (!res.ok || !data.success) {
      throw new Error(data.message || `API error (HTTP ${res.status})`);
    }

    return data;
  }

  // ── Step 1: Classify query via Groq (backend) ─────────────────────────────
  // Returns { category, urgency, confidence, suggested_lawyer, reasoning }
  async function classifyQuery(userInput) {
    const data = await apiFetch("/classify", {
      method: "POST",
      body:   JSON.stringify({ query: userInput }),
    });

    return {
      category:         data.category         || "Other",
      confidence:       data.confidence       || "Low",
      urgency:          data.urgency          || "low",
      suggested_lawyer: data.suggested_lawyer || "General Lawyer",
      reasoning:        data.reasoning        || "",
    };
  }

  // ── Step 2: Save query to MongoDB ────────────────────────────────────────
  async function saveQuery(payload) {
    const data = await apiFetch("/query", {
      method: "POST",
      body:   JSON.stringify(payload),
    });
    return data.query;
  }

  // ── createQuery ──────────────────────────────────────────────────────────
  // Main entry point used by query.html.
  // 1. Sends query to backend for LLM classification.
  // 2. Saves the classified query to MongoDB.
  // 3. Returns the saved query document.
  async function createQuery(userInput) {
    if (!userInput || typeof userInput !== "string" || userInput.trim().length < 10) {
      throw new Error("Please describe your legal issue in at least 10 characters.");
    }

    const input = userInput.trim();

    // Step 1 — LLM classification (server-side Groq call)
    console.log("[QueryStore] Classifying:", input.slice(0, 80));
    const analysis = await classifyQuery(input);
    console.log("[QueryStore] Classification result:", analysis);

    // Step 2 — Persist to MongoDB
    const queryId = "Q" + Date.now();
    const payload = {
      query_id:              queryId,
      user_input:            input,
      detected_category:     analysis.category,
      confidence_score:      analysis.confidence,
      urgency_level:         analysis.urgency,
      suggested_lawyer_type: analysis.suggested_lawyer,
      document_uploaded:     false,
      status:                "analyzed",
    };

    const saved = await saveQuery(payload);

    // Attach reasoning so the UI can optionally display it
    saved._reasoning = analysis.reasoning;
    return saved;
  }

  // ── loadAll ──────────────────────────────────────────────────────────────
  async function loadAll() {
    const data = await apiFetch("/queries");
    return data.queries;
  }

  // ── updateQuery ───────────────────────────────────────────────────────────
  async function updateQuery(queryId, fields) {
    const data = await apiFetch(`/query/${queryId}`, {
      method: "PUT",
      body:   JSON.stringify(fields),
    });
    return data.query;
  }

  // ── attachDocumentToLatest ─────────────────────────────────────────────────
  async function attachDocumentToLatest() {
    try {
      const queries = await loadAll();
      if (!queries.length) return null;
      return updateQuery(queries[0].query_id, { document_uploaded: true, status: "in_progress" });
    } catch (e) {
      console.warn("[QueryStore] attachDocumentToLatest failed:", e.message);
      return null;
    }
  }

  return {
    createQuery,
    loadAll,
    updateQuery,
    attachDocumentToLatest,
  };

})();
