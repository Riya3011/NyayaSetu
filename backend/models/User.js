// models/User.js
// ─────────────────────────────────────────────────────────────────────────────
// NyayaSetu — User Account Schema
//
// Roles: "user" (default citizen), "lawyer", "admin"
// Passwords stored as bcrypt hashes — never plain text.
// ─────────────────────────────────────────────────────────────────────────────

const mongoose = require("mongoose");
const bcrypt   = require("bcryptjs");

const UserSchema = new mongoose.Schema(
  {
    // Full display name
    name: {
      type:     String,
      required: [true, "Name is required"],
      trim:     true,
      minlength: [2, "Name must be at least 2 characters"],
      maxlength: [100, "Name cannot exceed 100 characters"],
    },

    // Unique login email
    email: {
      type:     String,
      required: [true, "Email is required"],
      unique:   true,
      trim:     true,
      lowercase: true,
      match: [/^\S+@\S+\.\S+$/, "Please enter a valid email address"],
    },

    // Hashed password — never store plain text
    password: {
      type:     String,
      required: [true, "Password is required"],
      minlength: [6, "Password must be at least 6 characters"],
    },

    // Role governs which dashboard the user sees after login
    role: {
      type:    String,
      enum:    ["user", "lawyer", "admin"],
      default: "user",
    },

    // Extra profile fields (optional — lawyers can populate these)
    phone: {
      type:    String,
      default: "",
      trim:    true,
    },

    specialization: {
      // Relevant for lawyers: "Criminal Law", "Family Law", etc.
      type:    String,
      default: "",
      trim:    true,
    },

    barCouncilId: {
      // Bar Council registration number — lawyers only
      type:    String,
      default: "",
      trim:    true,
    },

    experience: {
      // Years of practice — lawyers only
      type:    Number,
      default: 0,
    },

    isActive: {
      type:    Boolean,
      default: true,
    },
  },
  {
    timestamps: true, // createdAt, updatedAt
  }
);

// ── Pre-save hook: hash password before storing ───────────────────────────────
UserSchema.pre("save", async function (next) {
  // Only hash if password field was modified (avoids re-hashing on profile updates)
  if (!this.isModified("password")) return next();

  try {
    const salt     = await bcrypt.genSalt(12);
    this.password  = await bcrypt.hash(this.password, salt);
    next();
  } catch (err) {
    next(err);
  }
});

// ── Instance method: compare a plain-text password against the stored hash ────
UserSchema.methods.comparePassword = async function (plainPassword) {
  return bcrypt.compare(plainPassword, this.password);
};

// ── toJSON transform: strip password from any JSON serialization ──────────────
UserSchema.set("toJSON", {
  transform: function (_doc, ret) {
    delete ret.password;
    return ret;
  },
});

module.exports = mongoose.model("User", UserSchema);
