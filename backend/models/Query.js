// models/Query.js
// ─────────────────────────────────────────────────────────────────────────────
// NyayaSetu — Legal Query / Case Schema
//
// Extended with:
//   - user_id        : who submitted the query
//   - lawyer_id      : assigned lawyer (nullable)
//   - title          : short case title
//   - description    : full description (maps to user_input for legacy)
//   - status         : pending | in_progress | resolved  (+ legacy aliases)
//   - responses      : array of lawyer/admin replies
// ─────────────────────────────────────────────────────────────────────────────

const mongoose = require("mongoose");

// Sub-schema for lawyer/admin responses on a case
const ResponseSchema = new mongoose.Schema(
  {
    author_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    author_name: { type: String, required: true },
    author_role: { type: String, enum: ["user", "lawyer", "admin"], required: true },
    message: { type: String, required: true, trim: true, minlength: 1 },
  },
  { timestamps: true }
);

const QuerySchema = new mongoose.Schema(
  {
    // ── Ownership ──────────────────────────────────────────────────────────────
    // The citizen who submitted this query
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,         // null for legacy queries submitted before auth
    },

    // Lawyer assigned by admin (null = unassigned)
    lawyer_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    // ── Identity ───────────────────────────────────────────────────────────────
    // Human-readable unique ID generated on the frontend (e.g. "Q1712345678901")
    query_id: {
      type:     String,
      required: true,
      unique:   true,
      trim:     true,
    },

    // Short case title (generated from first 80 chars of input if not provided)
    title: {
      type:    String,
      trim:    true,
      default: "",
    },

    // Full description / raw user input
    user_input: {
      type:      String,
      required:  [true, "user_input is required"],
      minlength: [10, "Query must be at least 10 characters"],
      trim:      true,
    },

    // ── Classification ─────────────────────────────────────────────────────────
    detected_category: { type: String, default: "Other" },

    confidence_score: {
      type: String,
      enum: ["High", "Medium", "Low"],
      default: "Low",
    },

    urgency_level: {
      type: String,
      enum: ["high", "medium", "low"],
      default: "low",
    },

    suggested_lawyer_type: { type: String, default: "General Lawyer" },

    // ── Status ─────────────────────────────────────────────────────────────────
    // pending   = newly submitted, not yet picked up
    // in_progress = lawyer is working on it
    // resolved  = lawyer marked as done
    // (submitted / analyzed / completed kept for legacy API compatibility)
    status: {
      type: String,
      enum: ["pending", "in_progress", "resolved", "submitted", "analyzed", "completed"],
      default: "pending",
    },

    // ── Document ───────────────────────────────────────────────────────────────
    document_uploaded: { type: Boolean, default: false },

    // ── Lawyer responses ───────────────────────────────────────────────────────
    responses: {
      type:    [ResponseSchema],
      default: [],
    },
  },
  {
    timestamps: true, // createdAt, updatedAt
  }
);

// Virtual: derive title from user_input if not explicitly set
QuerySchema.pre("save", function (next) {
  if (!this.title && this.user_input) {
    this.title = this.user_input.slice(0, 80).trim();
  }
  next();
});

// Populate helpers — call .populate("user_id", "name email") etc. on queries
QuerySchema.index({ user_id: 1 });
QuerySchema.index({ lawyer_id: 1 });
QuerySchema.index({ status: 1 });

module.exports = mongoose.model("Query", QuerySchema);
