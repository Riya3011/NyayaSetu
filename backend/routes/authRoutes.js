// routes/authRoutes.js
// ─────────────────────────────────────────────────────────────────────────────
// NyayaSetu — Authentication Endpoints
//
// POST /api/auth/register  – create new account (default role = "user")
// POST /api/auth/login     – email + password + role → JWT
//                           CRITICAL: role field is checked against DB role.
//                           Mismatch → "Invalid role selected" error.
// GET  /api/auth/me        – return current user profile
// PUT  /api/auth/profile   – update own name/phone/specialization
// PUT  /api/auth/password  – change own password
// ─────────────────────────────────────────────────────────────────────────────

const express     = require("express");
const router      = express.Router();
const jwt         = require("jsonwebtoken");
const User        = require("../models/User");
const { protect } = require("../middleware/auth");

// ── Helper ────────────────────────────────────────────────────────────────────
function signToken(userId) {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  });
}

// ── POST /api/auth/register ───────────────────────────────────────────────────
// Public signup — always creates a "user" role account.
// Body: { name, email, password }
router.post("/register", async (req, res) => {
  try {
    const { name, email, password, role, specialization, barCouncilId, experience } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Name, email, and password are required.",
      });
    }
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters.",
      });
    }

    // Validate role if provided
    const validRoles = ["user", "lawyer", "admin"];
    const assignedRole = validRoles.includes(role) ? role : "user";

    const existing = await User.findOne({ email: email.toLowerCase().trim() });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists.",
      });
    }

    const user = await User.create({
      name:           name.trim(),
      email:          email.toLowerCase().trim(),
      password,       // hashed by pre-save hook
      role:           assignedRole,
      specialization: specialization || "",
      barCouncilId:   barCouncilId   || "",
      experience:     Number(experience) || 0,
    });

    const token = signToken(user._id);

    return res.status(201).json({
      success: true,
      message: "Account created successfully.",
      token,
      user: {
        id:             user._id,
        name:           user.name,
        email:          user.email,
        role:           user.role,
        specialization: user.specialization,
        barCouncilId:   user.barCouncilId,
        experience:     user.experience,
      },
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists.",
      });
    }
    console.error("register error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Registration failed. Please try again.",
    });
  }
});

// ── POST /api/auth/login ──────────────────────────────────────────────────────
// CRITICAL REQUIREMENT:
//   Body must include { email, password, role }
//   If email+password correct but role !== user.role → 403 "Invalid role selected"
//   This enforces that users can only log in as their actual role.
router.post("/login", async (req, res) => {
  try {
    const { email, password, role } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required.",
      });
    }

    if (!role || !["user", "lawyer", "admin"].includes(role)) {
      return res.status(400).json({
        success: false,
        message: "Please select a valid role (user, lawyer, or admin).",
      });
    }

    // Find user including hashed password
    const user = await User.findOne({
      email: email.toLowerCase().trim(),
    }).select("+password");

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: "Account deactivated. Please contact support.",
      });
    }

    // Verify password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }

    // ── ROLE MISMATCH CHECK ──────────────────────────────────────────────────
    // This is the critical requirement: even if credentials are correct,
    // if the submitted role doesn't match the DB role → reject.
    if (user.role !== role) {
      return res.status(403).json({
        success: false,
        message: "Invalid role selected. Please choose your correct role.",
        hint: "Contact your administrator if you believe this is an error.",
      });
    }

    const token = signToken(user._id);

    return res.json({
      success: true,
      message: "Login successful.",
      token,
      user: {
        id:             user._id,
        name:           user.name,
        email:          user.email,
        role:           user.role,
        specialization: user.specialization,
        phone:          user.phone,
        barCouncilId:   user.barCouncilId,
        experience:     user.experience,
      },
    });
  } catch (err) {
    console.error("login error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Login failed. Please try again.",
    });
  }
});

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
router.get("/me", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }
    return res.json({ success: true, user });
  } catch (err) {
    console.error("me error:", err.message);
    return res.status(500).json({ success: false, message: "Could not fetch profile." });
  }
});

// ── PUT /api/auth/profile ─────────────────────────────────────────────────────
// Update own name, phone, specialization, barCouncilId, experience.
// Role and email changes not allowed here.
router.put("/profile", protect, async (req, res) => {
  try {
    const { name, phone, specialization, barCouncilId, experience } = req.body;
    const updates = {};
    if (name           !== undefined) updates.name           = name.trim();
    if (phone          !== undefined) updates.phone          = phone.trim();
    if (specialization !== undefined) updates.specialization = specialization.trim();
    if (barCouncilId   !== undefined) updates.barCouncilId   = barCouncilId.trim();
    if (experience     !== undefined) updates.experience     = Number(experience) || 0;

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $set: updates },
      { new: true, runValidators: true }
    );

    return res.json({ success: true, message: "Profile updated.", user });
  } catch (err) {
    console.error("profile update error:", err.message);
    return res.status(500).json({ success: false, message: "Could not update profile." });
  }
});

// ── PUT /api/auth/password ────────────────────────────────────────────────────
// Change own password. Requires currentPassword + newPassword.
router.put("/password", protect, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Current password and new password are required.",
      });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: "New password must be at least 6 characters.",
      });
    }

    const user = await User.findById(req.user._id).select("+password");
    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Current password is incorrect.",
      });
    }

    user.password = newPassword;
    await user.save(); // triggers bcrypt pre-save hook

    return res.json({ success: true, message: "Password changed successfully." });
  } catch (err) {
    console.error("password change error:", err.message);
    return res.status(500).json({ success: false, message: "Could not change password." });
  }
});

module.exports = router;
