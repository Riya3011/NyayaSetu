// utils/recommendations.js
// ─────────────────────────────────────────────────────────────────────────────
// NyayaSetu — Smart Recommendation Engine
//
// generateRecommendations(queries) analyses stored queries and returns:
//   - trendingCategories : top categories by query count
//   - suggestedActions   : category → list of actionable next steps
//   - commonIssues       : categories with 2+ queries (flagged as common)
// ─────────────────────────────────────────────────────────────────────────────

// ── Action map: category → suggested next steps ──────────────────────────────
// Add or extend entries here without touching any other file.
const CATEGORY_ACTIONS = {
  "Family Law": [
    "Consider mediation before litigation — it's faster and less costly.",
    "Send a formal legal notice through your lawyer.",
    "Collect all marriage/financial documents as evidence.",
    "Contact a Family Court for interim relief if children are involved.",
  ],
  "Criminal Law": [
    "File an FIR at the nearest police station immediately.",
    "Consult a criminal lawyer before making any statement to police.",
    "Apply for anticipatory bail if arrest is feared.",
    "Preserve all evidence: messages, photos, CCTV footage.",
  ],
  "Cyber Law": [
    "Report to the National Cyber Crime portal: cybercrime.gov.in",
    "File a complaint with your local Cyber Cell.",
    "Change all passwords and enable two-factor authentication.",
    "Do NOT delete any evidence — screenshots and logs are critical.",
  ],
  "Property Law": [
    "Verify property title documents with a registered lawyer.",
    "Send a legal notice to the opposing party before approaching court.",
    "Approach the Rent Control Court for tenancy disputes.",
    "Get a property survey done to settle boundary disputes.",
  ],
  "Labour Law": [
    "Document all communications with your employer in writing.",
    "File a complaint with the Labour Commissioner's office.",
    "Check your PF balance at the EPFO portal: epfindia.gov.in",
    "Consult the Employees' Tribunal for wrongful termination cases.",
  ],
  "Corporate Law": [
    "Ensure all agreements are in writing and notarised.",
    "Consult a Company Secretary for MCA/ROC compliance.",
    "Review your shareholder agreement for dispute resolution clauses.",
    "Approach NCLT for insolvency or serious corporate disputes.",
  ],
  "Consumer Law": [
    "File a complaint on the National Consumer Helpline: 1800-11-4000",
    "Email the company's nodal officer with a written complaint.",
    "Approach the District Consumer Forum for disputes up to ₹50 lakh.",
    "Keep all receipts, order confirmations, and chat transcripts.",
  ],
  "Personal Injury / Civil": [
    "File a First Information Report if injuries were caused by another party.",
    "Gather medical records and doctor's statements as evidence.",
    "Consult a civil lawyer to estimate compensation under tort law.",
    "Report to the Motor Accident Claims Tribunal for road accidents.",
  ],
  "Other": [
    "Consult a general legal aid clinic for initial guidance.",
    "Visit your nearest District Legal Services Authority (DLSA) for free help.",
    "Document all facts and dates chronologically before approaching a lawyer.",
  ],
};

// ── generateRecommendations ───────────────────────────────────────────────────
/**
 * @param {Array} queries - Array of Query documents from MongoDB
 * @returns {Object} { trendingCategories, suggestedActions, commonIssues }
 */
function generateRecommendations(queries) {
  if (!queries || queries.length === 0) {
    return { trendingCategories: [], suggestedActions: {}, commonIssues: [] };
  }

  // Step 1 — Count queries per category using a simple frequency map
  const categoryCount = {};
  for (const q of queries) {
    const cat = q.detected_category || "Other";
    categoryCount[cat] = (categoryCount[cat] || 0) + 1;
  }

  // Step 2 — Sort categories by frequency (descending)
  const trendingCategories = Object.entries(categoryCount)
    .sort((a, b) => b[1] - a[1])          // highest count first
    .map(([category, count]) => ({ category, count }));

  // Step 3 — Flag categories that appear 2+ times as "common issues"
  const commonIssues = trendingCategories
    .filter(({ count }) => count >= 2)
    .map(({ category, count }) => ({
      category,
      count,
      message: `${count} users have reported issues related to ${category}.`,
    }));

  // Step 4 — Build suggested actions for every category present in queries
  const suggestedActions = {};
  for (const { category } of trendingCategories) {
    // Fall back to "Other" if we don't have a specific action map entry
    suggestedActions[category] = CATEGORY_ACTIONS[category] || CATEGORY_ACTIONS["Other"];
  }

  return { trendingCategories, suggestedActions, commonIssues };
}

module.exports = { generateRecommendations };
