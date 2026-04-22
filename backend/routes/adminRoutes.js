// routes/adminRoutes.js
// ─────────────────────────────────────────────────────────────────────────────
// NyayaSetu — Admin-Only Endpoints
//
// All routes require: protect + requireRole("admin")
//
// GET  /api/admin/users                  – list all users (paginated, filterable)
// GET  /api/admin/users/:id              – single user detail
// PUT  /api/admin/users/:id/role         – change a user's role
// PUT  /api/admin/users/:id/status       – activate / deactivate account
// DELETE /api/admin/users/:id            – permanently delete a user (lawyer removal)
// GET  /api/admin/queries                – all queries with filters
// PUT  /api/admin/queries/:id/assign     – assign query to a lawyer
// PUT  /api/admin/queries/:id/status     – update query status
// GET  /api/admin/stats                  – platform overview stats
// ─────────────────────────────────────────────────────────────────────────────

const express                  = require("express");
const router                   = express.Router();
const User                     = require("../models/User");
const Query                    = require("../models/Query");
const { protect, requireRole } = require("../middleware/auth");

// All admin routes are protected
router.use(protect, requireRole("admin"));

// ─────────────────────────────────────────────────────────────────────────────
// USER MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/admin/users
// Query params: ?page=1&limit=20&role=lawyer&search=name_or_email&active=true
router.get("/users", async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const skip  = (page - 1) * limit;
    const filter = {};

    if (req.query.role && ["user", "lawyer", "admin"].includes(req.query.role)) {
      filter.role = req.query.role;
    }
    if (req.query.active !== undefined) {
      filter.isActive = req.query.active === "true";
    }
    if (req.query.search) {
      const re   = new RegExp(req.query.search, "i");
      filter.$or = [{ name: re }, { email: re }];
    }

    const [users, total] = await Promise.all([
      User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      User.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      users,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error("admin/users error:", err.message);
    return res.status(500).json({ success: false, message: "Could not fetch users." });
  }
});

// GET /api/admin/users/:id
router.get("/users/:id", async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: "User not found." });

    // If lawyer, also fetch their assigned cases count
    let assignedCases = 0;
    if (user.role === "lawyer") {
      assignedCases = await Query.countDocuments({ lawyer_id: user._id });
    }

    return res.json({ success: true, user, assignedCases });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Could not fetch user." });
  }
});

// PUT /api/admin/users/:id/role
// Body: { role: "user" | "lawyer" | "admin" }
router.put("/users/:id/role", async (req, res) => {
  try {
    const { role } = req.body;

    if (!["user", "lawyer", "admin"].includes(role)) {
      return res.status(400).json({
        success: false,
        message: "Invalid role. Use: user, lawyer, or admin.",
      });
    }

    if (req.params.id === req.user._id.toString() && role !== "admin") {
      return res.status(400).json({
        success: false,
        message: "You cannot change your own admin role.",
      });
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { $set: { role } },
      { new: true }
    );
    if (!user) return res.status(404).json({ success: false, message: "User not found." });

    // If demoting a lawyer → unassign all their cases
    if (role !== "lawyer") {
      await Query.updateMany(
        { lawyer_id: req.params.id },
        { $set: { lawyer_id: null } }
      );
    }

    return res.json({ success: true, message: `Role updated to ${role}.`, user });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Could not update role." });
  }
});

// PUT /api/admin/users/:id/status
// Body: { isActive: true | false }
router.put("/users/:id/status", async (req, res) => {
  try {
    const { isActive } = req.body;

    if (typeof isActive !== "boolean") {
      return res.status(400).json({ success: false, message: "isActive must be true or false." });
    }
    if (req.params.id === req.user._id.toString() && !isActive) {
      return res.status(400).json({ success: false, message: "You cannot deactivate your own account." });
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { $set: { isActive } },
      { new: true }
    );
    if (!user) return res.status(404).json({ success: false, message: "User not found." });

    return res.json({
      success: true,
      message: `Account ${isActive ? "activated" : "deactivated"}.`,
      user,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Could not update status." });
  }
});

// DELETE /api/admin/users/:id
// Removes a user (typically for removing a lawyer). Also unassigns their cases.
router.delete("/users/:id", async (req, res) => {
  try {
    if (req.params.id === req.user._id.toString()) {
      return res.status(400).json({ success: false, message: "You cannot delete your own account." });
    }

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: "User not found." });

    // Unassign cases if lawyer
    if (user.role === "lawyer") {
      await Query.updateMany(
        { lawyer_id: req.params.id },
        { $set: { lawyer_id: null, status: "pending" } }
      );
    }

    await User.findByIdAndDelete(req.params.id);

    return res.json({ success: true, message: `User "${user.name}" deleted successfully.` });
  } catch (err) {
    console.error("admin/delete user error:", err.message);
    return res.status(500).json({ success: false, message: "Could not delete user." });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// QUERY / CASE MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/admin/queries
// Full query list with populated user and lawyer info.
// Filters: ?status=pending&urgency=high&lawyer_id=xxx&user_id=xxx&category=xxx
router.get("/queries", async (req, res) => {
  try {
    const filter = {};

    if (req.query.status && ["pending","in_progress","resolved","submitted","analyzed","completed"].includes(req.query.status)) {
      filter.status = req.query.status;
    }
    if (req.query.urgency && ["high","medium","low"].includes(req.query.urgency)) {
      filter.urgency_level = req.query.urgency;
    }
    if (req.query.category) {
      filter.detected_category = req.query.category;
    }
    if (req.query.lawyer_id) {
      filter.lawyer_id = req.query.lawyer_id === "unassigned" ? null : req.query.lawyer_id;
    }
    if (req.query.user_id) {
      filter.user_id = req.query.user_id;
    }

    const queries = await Query.find(filter)
      .sort({ createdAt: -1 })
      .populate("user_id",   "name email phone")
      .populate("lawyer_id", "name email specialization");

    return res.json({ success: true, queries });
  } catch (err) {
    console.error("admin/queries error:", err.message);
    return res.status(500).json({ success: false, message: "Could not fetch queries." });
  }
});

// PUT /api/admin/queries/:id/assign
// Assign (or unassign) a query to a lawyer.
// Body: { lawyer_id: "mongoId" | null }
router.put("/queries/:id/assign", async (req, res) => {
  try {
    const { lawyer_id } = req.body;

    // If assigning, validate the target is actually a lawyer
    if (lawyer_id) {
      const lawyer = await User.findById(lawyer_id);
      if (!lawyer || lawyer.role !== "lawyer") {
        return res.status(400).json({
          success: false,
          message: "Target user is not a registered lawyer.",
        });
      }
    }

    const query = await Query.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          lawyer_id: lawyer_id || null,
          // When assigning, move status from pending to in_progress
          ...(lawyer_id ? { status: "in_progress" } : { status: "pending" }),
        },
      },
      { new: true }
    )
      .populate("user_id",   "name email")
      .populate("lawyer_id", "name email specialization");

    if (!query) {
      return res.status(404).json({ success: false, message: "Query not found." });
    }

    return res.json({
      success: true,
      message: lawyer_id ? "Case assigned to lawyer." : "Case unassigned.",
      query,
    });
  } catch (err) {
    console.error("admin/assign error:", err.message);
    return res.status(500).json({ success: false, message: "Could not assign case." });
  }
});

// PUT /api/admin/queries/:id/status
// Admin can set any status.
// Body: { status: "pending" | "in_progress" | "resolved" }
router.put("/queries/:id/status", async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ["pending","in_progress","resolved","submitted","analyzed","completed"];

    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Must be one of: ${validStatuses.join(", ")}`,
      });
    }

    const query = await Query.findByIdAndUpdate(
      req.params.id,
      { $set: { status } },
      { new: true }
    )
      .populate("user_id",   "name email")
      .populate("lawyer_id", "name email specialization");

    if (!query) {
      return res.status(404).json({ success: false, message: "Query not found." });
    }

    return res.json({ success: true, message: "Status updated.", query });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Could not update status." });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// STATS
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/admin/stats
router.get("/stats", async (req, res) => {
  try {
    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [
      userCount, lawyerCount, adminCount,
      totalQueries, pendingQueries, inProgressQueries, resolvedQueries,
      highUrgency, unassignedQueries,
      newUsers, newQueries,
    ] = await Promise.all([
      User.countDocuments({ role: "user",   isActive: true }),
      User.countDocuments({ role: "lawyer", isActive: true }),
      User.countDocuments({ role: "admin",  isActive: true }),
      Query.countDocuments(),
      Query.countDocuments({ status: "pending" }),
      Query.countDocuments({ status: "in_progress" }),
      Query.countDocuments({ status: "resolved" }),
      Query.countDocuments({ urgency_level: "high" }),
      Query.countDocuments({ lawyer_id: null }),
      User.countDocuments({ createdAt: { $gte: since7d } }),
      Query.countDocuments({ createdAt: { $gte: since7d } }),
    ]);

    const catAgg = await Query.aggregate([
      { $group: { _id: "$detected_category", count: { $sum: 1 } } },
      { $sort:  { count: -1 } },
      { $limit: 8 },
    ]);

    return res.json({
      success: true,
      stats: {
        users:   { total: userCount + lawyerCount + adminCount, users: userCount, lawyers: lawyerCount, admins: adminCount },
        queries: {
          total: totalQueries, pending: pendingQueries,
          inProgress: inProgressQueries, resolved: resolvedQueries,
          highUrgency, unassigned: unassignedQueries,
          newLast7d: newQueries,
        },
        newUsersLast7d: newUsers,
        topCategories:  catAgg.map(c => ({ category: c._id || "Other", count: c.count })),
      },
    });
  } catch (err) {
    console.error("admin/stats error:", err.message);
    return res.status(500).json({ success: false, message: "Could not fetch stats." });
  }
});

module.exports = router;
