// routes/analyticsRoutes.js
// ─────────────────────────────────────────────────────────────────────────────
// NyayaSetu — Analytics & Recommendations Endpoints
//
// Endpoints:
//   GET /api/analytics        – category, urgency, document stats
//   GET /api/recommendations  – trending categories + suggested actions
// ─────────────────────────────────────────────────────────────────────────────

const express = require("express");
const router  = express.Router();
const Query   = require("../models/Query");
const { generateRecommendations } = require("../utils/recommendations");


// ── GET /api/analytics ────────────────────────────────────────────────────────
// Returns aggregated stats across ALL stored queries.
// Used by the dashboard Analytics section.
//
// Response shape:
// {
//   success: true,
//   analytics: {
//     categoryStats  : [{ category, count }],   // queries per legal category
//     urgencyStats   : { high, medium, low },    // urgency distribution
//     documentStats  : { withDoc, withoutDoc, uploadPct }  // doc upload %
//   }
// }

router.get("/analytics", async (req, res) => {
  try {
    // Load all queries — collection is small, no pagination needed
    const queries = await Query.find({}, "detected_category urgency_level document_uploaded");

    const total = queries.length;

    // ── Category frequency ────────────────────────────────────────────────
    const catMap = {};
    for (const q of queries) {
      const cat = q.detected_category || "Other";
      catMap[cat] = (catMap[cat] || 0) + 1;
    }
    const categoryStats = Object.entries(catMap)
      .sort((a, b) => b[1] - a[1])
      .map(([category, count]) => ({ category, count }));

    // ── Urgency distribution ──────────────────────────────────────────────
    const urgencyStats = { high: 0, medium: 0, low: 0 };
    for (const q of queries) {
      const u = q.urgency_level || "low";
      if (urgencyStats[u] !== undefined) urgencyStats[u]++;
    }

    // ── Document upload percentage ────────────────────────────────────────
    const withDoc    = queries.filter(q => q.document_uploaded).length;
    const withoutDoc = total - withDoc;
    const uploadPct  = total > 0 ? Math.round((withDoc / total) * 100) : 0;
    const documentStats = { withDoc, withoutDoc, uploadPct };

    return res.status(200).json({
      success: true,
      analytics: { categoryStats, urgencyStats, documentStats },
    });

  } catch (err) {
    console.error("Analytics error:", err.message);
    return res.status(500).json({ success: false, message: "Could not compute analytics" });
  }
});


// ── GET /api/recommendations ──────────────────────────────────────────────────
// Analyses stored queries and returns smart recommendations.
//
// Response shape:
// {
//   success: true,
//   recommendations: {
//     trendingCategories : [{ category, count }],
//     suggestedActions   : { "Family Law": [...], ... },
//     commonIssues       : [{ category, count, message }]
//   }
// }

router.get("/recommendations", async (req, res) => {
  try {
    // Only fetch fields needed for analysis — keeps the payload light
    const queries = await Query.find({}, "detected_category urgency_level");

    const recommendations = generateRecommendations(queries);

    return res.status(200).json({ success: true, recommendations });

  } catch (err) {
    console.error("Recommendations error:", err.message);
    return res.status(500).json({ success: false, message: "Could not generate recommendations" });
  }
});


module.exports = router;
