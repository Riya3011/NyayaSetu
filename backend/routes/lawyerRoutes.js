// routes/lawyerRoutes.js
// ─────────────────────────────────────────────────────────────────────────────
// NyayaSetu — Lawyer Portal Endpoints
//
// PUBLIC (no auth):
//   GET  /api/lawyers                  – list all active lawyers
//
// PROTECTED (lawyer or admin):
//   GET  /api/lawyer/cases             – lawyer's assigned cases
//   GET  /api/lawyer/cases/:id         – single case detail
//   PUT  /api/lawyer/cases/:id/status  – update case status
//   POST /api/lawyer/cases/:id/respond – add text response to case
//   GET  /api/lawyer/clients           – list of users with cases assigned to me
//   GET  /api/lawyer/stats             – dashboard stats
//   GET  /api/lawyer/profile           – own profile
// ─────────────────────────────────────────────────────────────────────────────

const express                  = require("express");
const router                   = express.Router();
const User                     = require("../models/User");
const Query                    = require("../models/Query");
const { protect, requireRole } = require("../middleware/auth");

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC: List all active lawyers
// ─────────────────────────────────────────────────────────────────────────────
router.get("/lawyers", async (req, res) => {
  try {
    const { specialization, minExperience } = req.query;
    
    let filter = { role: "lawyer", isActive: true };
    
    if (specialization) {
      filter.specialization = specialization;
    }
    
    if (minExperience) {
      filter.experience = { $gte: parseInt(minExperience) || 0 };
    }

    const lawyers = await User.find(
      filter,
      "name email specialization barCouncilId experience createdAt"
    ).sort({ experience: -1, name: 1 });

    return res.json({ success: true, lawyers });
  } catch (err) {
    console.error("GET /lawyers error:", err.message);
    return res.status(500).json({ success: false, message: "Could not fetch lawyers." });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// All routes below require lawyer or admin role
// ─────────────────────────────────────────────────────────────────────────────
router.use(protect, requireRole("lawyer", "admin"));

// ── GET /api/lawyer/stats ─────────────────────────────────────────────────────
router.get("/stats", async (req, res) => {
  try {
    const myId = req.user._id;

    const [total, pending, inProgress, resolved, highUrgency] = await Promise.all([
      Query.countDocuments({ lawyer_id: myId }),
      Query.countDocuments({ lawyer_id: myId, status: "pending" }),
      Query.countDocuments({ lawyer_id: myId, status: "in_progress" }),
      Query.countDocuments({ lawyer_id: myId, status: "resolved" }),
      Query.countDocuments({ lawyer_id: myId, urgency_level: "high" }),
    ]);

    // Unique clients
    const clientAgg = await Query.distinct("user_id", { lawyer_id: myId, user_id: { $ne: null } });

    const catAgg = await Query.aggregate([
      { $match: { lawyer_id: myId } },
      { $group: { _id: "$detected_category", count: { $sum: 1 } } },
      { $sort:  { count: -1 } },
      { $limit: 5 },
    ]);

    return res.json({
      success: true,
      stats: {
        totalCases:    total,
        pending,
        inProgress,
        resolved,
        highUrgency,
        totalClients:  clientAgg.length,
        topCategories: catAgg.map(c => ({ category: c._id || "Other", count: c.count })),
      },
    });
  } catch (err) {
    console.error("lawyer/stats error:", err.message);
    return res.status(500).json({ success: false, message: "Could not fetch stats." });
  }
});

// ── GET /api/lawyer/cases ─────────────────────────────────────────────────────
// Returns only cases assigned to this lawyer.
// Optional filters: ?status=in_progress&urgency=high&category=Criminal+Law
router.get("/cases", async (req, res) => {
  try {
    const filter = { lawyer_id: req.user._id };

    if (req.query.status && ["pending","in_progress","resolved","submitted","analyzed","completed"].includes(req.query.status)) {
      filter.status = req.query.status;
    }
    if (req.query.urgency && ["high","medium","low"].includes(req.query.urgency)) {
      filter.urgency_level = req.query.urgency;
    }
    if (req.query.category) {
      filter.detected_category = req.query.category;
    }

    const cases = await Query.find(filter)
      .sort({ createdAt: -1 })
      .populate("user_id",   "name email phone")
      .populate("lawyer_id", "name email specialization");

    return res.json({ success: true, cases });
  } catch (err) {
    console.error("lawyer/cases error:", err.message);
    return res.status(500).json({ success: false, message: "Could not fetch cases." });
  }
});

// ── GET /api/lawyer/cases/:id ─────────────────────────────────────────────────
router.get("/cases/:id", async (req, res) => {
  try {
    const caseDoc = await Query.findById(req.params.id)
      .populate("user_id",   "name email phone")
      .populate("lawyer_id", "name email specialization barCouncilId experience");

    if (!caseDoc) {
      return res.status(404).json({ success: false, message: "Case not found." });
    }

    // Ensure lawyer only sees their own assigned cases
    if (
      req.user.role === "lawyer" &&
      caseDoc.lawyer_id &&
      caseDoc.lawyer_id._id.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({ success: false, message: "Access denied. This case is not assigned to you." });
    }

    return res.json({ success: true, case: caseDoc });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Could not fetch case." });
  }
});

// ── PUT /api/lawyer/cases/:id/reject ─────────────────────────────────────────
// Lawyer declines an assigned case → returns it to the unassigned pool.
router.put("/cases/:id/reject", async (req, res) => {
  try {
    const caseDoc = await Query.findById(req.params.id);
    if (!caseDoc) {
      return res.status(404).json({ success: false, message: "Case not found." });
    }

    // Only the assigned lawyer can reject
    if (
      req.user.role === "lawyer" &&
      caseDoc.lawyer_id?.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({ success: false, message: "This case is not assigned to you." });
    }

    caseDoc.lawyer_id = null;
    caseDoc.status    = "pending";
    await caseDoc.save();

    return res.json({ success: true, message: "Case returned to unassigned pool." });
  } catch (err) {
    console.error("lawyer/reject error:", err.message);
    return res.status(500).json({ success: false, message: "Could not reject case." });
  }
});

// ── PUT /api/lawyer/cases/:id/status ─────────────────────────────────────────
// Lawyer updates status: pending → in_progress → resolved
// Body: { status: "in_progress" | "resolved" }
router.put("/cases/:id/status", async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ["pending", "in_progress", "resolved"];

    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Lawyers can set: ${validStatuses.join(", ")}`,
      });
    }

    const caseDoc = await Query.findById(req.params.id);
    if (!caseDoc) {
      return res.status(404).json({ success: false, message: "Case not found." });
    }

    // Lawyer can only update their own cases
    if (
      req.user.role === "lawyer" &&
      caseDoc.lawyer_id?.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({ success: false, message: "Access denied. This case is not assigned to you." });
    }

    caseDoc.status = status;
    await caseDoc.save();

    const populated = await Query.findById(caseDoc._id)
      .populate("user_id",   "name email")
      .populate("lawyer_id", "name email specialization");

    return res.json({ success: true, message: `Case marked as ${status}.`, case: populated });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Could not update case status." });
  }
});

// ── POST /api/lawyer/cases/:id/respond ───────────────────────────────────────
// Lawyer adds a text response to a case.
// Body: { message: "..." }
router.post("/cases/:id/respond", async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, message: "Response message cannot be empty." });
    }

    const caseDoc = await Query.findById(req.params.id);
    if (!caseDoc) {
      return res.status(404).json({ success: false, message: "Case not found." });
    }

    if (
      req.user.role === "lawyer" &&
      caseDoc.lawyer_id?.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({ success: false, message: "Access denied. This case is not assigned to you." });
    }

    caseDoc.responses.push({
      author_id:   req.user._id,
      author_name: req.user.name,
      author_role: req.user.role,
      message:     message.trim(),
    });

    // Auto-advance from pending → in_progress on first lawyer response
    if (caseDoc.status === "pending") {
      caseDoc.status = "in_progress";
    }

    await caseDoc.save();

    const populated = await Query.findById(caseDoc._id)
      .populate("user_id",   "name email")
      .populate("lawyer_id", "name email specialization");

    return res.status(201).json({ success: true, message: "Response added.", case: populated });
  } catch (err) {
    console.error("lawyer/respond error:", err.message);
    return res.status(500).json({ success: false, message: "Could not add response." });
  }
});

// ── GET /api/lawyer/clients ───────────────────────────────────────────────────
// Returns all unique users whose cases are assigned to this lawyer.
router.get("/clients", async (req, res) => {
  try {
    const cases = await Query.find({
      lawyer_id: req.user._id,
      user_id:   { $ne: null },
    })
      .populate("user_id", "name email phone createdAt")
      .select("user_id status urgency_level detected_category createdAt");

    // Deduplicate by user_id and build client list with case summaries
    const clientMap = new Map();
    for (const c of cases) {
      if (!c.user_id) continue;
      const uid = c.user_id._id.toString();
      if (!clientMap.has(uid)) {
        clientMap.set(uid, {
          user:       c.user_id,
          totalCases: 0,
          openCases:  0,
          lastCase:   c.createdAt,
        });
      }
      const entry = clientMap.get(uid);
      entry.totalCases++;
      if (c.status !== "resolved") entry.openCases++;
      if (c.createdAt > entry.lastCase) entry.lastCase = c.createdAt;
    }

    return res.json({
      success: true,
      clients: Array.from(clientMap.values()),
    });
  } catch (err) {
    console.error("lawyer/clients error:", err.message);
    return res.status(500).json({ success: false, message: "Could not fetch clients." });
  }
});

// ── GET /api/lawyer/profile ───────────────────────────────────────────────────
router.get("/profile", async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    return res.json({ success: true, user });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Could not fetch profile." });
  }
});

module.exports = router;
