// middleware/auth.js
// ─────────────────────────────────────────────────────────────────────────────
// NyayaSetu — Authentication & Role-Based Access Middleware
//
// Usage:
//   const { protect, requireRole } = require("../middleware/auth");
//
//   router.get("/admin/stats", protect, requireRole("admin"), handler);
//   router.get("/lawyer/cases", protect, requireRole("lawyer", "admin"), handler);
//   router.get("/user/queries", protect, handler);  // any logged-in user
// ─────────────────────────────────────────────────────────────────────────────

const jwt  = require("jsonwebtoken");
const User = require("../models/User");

// ── protect ───────────────────────────────────────────────────────────────────
// Validates the Bearer JWT in the Authorization header.
// Attaches `req.user` (the full Mongoose document, minus password) on success.
async function protect(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Authentication required. Please log in.",
      });
    }

    const token = authHeader.split(" ")[1];

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      const message =
        err.name === "TokenExpiredError"
          ? "Session expired. Please log in again."
          : "Invalid token. Please log in again.";
      return res.status(401).json({ success: false, message });
    }

    // Fetch fresh user from DB (catches deleted / deactivated accounts)
    const user = await User.findById(decoded.id).select("-password");
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Account not found. Please log in again.",
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: "Your account has been deactivated. Contact support.",
      });
    }

    req.user = user;
    next();
  } catch (err) {
    console.error("protect middleware error:", err.message);
    res.status(500).json({ success: false, message: "Authentication error." });
  }
}

// ── requireRole ───────────────────────────────────────────────────────────────
// Must be used AFTER protect (depends on req.user being set).
// Pass one or more allowed roles: requireRole("admin") or requireRole("lawyer","admin")
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Not authenticated." });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Required role: ${roles.join(" or ")}.`,
      });
    }

    next();
  };
}

module.exports = { protect, requireRole };
