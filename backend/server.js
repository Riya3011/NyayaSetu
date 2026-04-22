// server.js
// ─────────────────────────────────────────────────────────────────────────────
// NyayaSetu Backend — Entry Point
// Start:   node server.js
// Dev:     npx nodemon server.js
// ─────────────────────────────────────────────────────────────────────────────

require("dotenv").config();

const express         = require("express");
const cors            = require("cors");
const connectDB       = require("./config/db");
const queryRoutes     = require("./routes/queryRoutes");
const analyticsRoutes = require("./routes/analyticsRoutes");
const chatRoutes      = require("./routes/chatRoutes");
const authRoutes      = require("./routes/authRoutes");
const adminRoutes     = require("./routes/adminRoutes");
const lawyerRoutes    = require("./routes/lawyerRoutes");

const app  = express();
const PORT = process.env.PORT || 5050;

connectDB();

// ── Middleware ──────────────────────────────────────────────────────────────
app.use(cors({ origin: "*" }));
app.use(express.json());

// ── Routes ──────────────────────────────────────────────────────────────────

// Auth (register, login with role check, me, profile, password)
app.use("/api/auth", authRoutes);

// Core query/case routes (classification, submit, list, respond)
app.use("/api", queryRoutes);

// Analytics (category/urgency stats + recommendations)
app.use("/api", analyticsRoutes);

// Chat (NyayaBot AI proxy)
app.use("/api", chatRoutes);

// Admin portal (user mgmt, case assignment, platform stats) — admin only
app.use("/api/admin", adminRoutes);

// Lawyer portal (assigned cases, responses, clients) — lawyer/admin
// Also exposes public GET /api/lawyers (no auth needed)
app.use("/api/lawyer", lawyerRoutes);
app.use("/api",        lawyerRoutes);   // mounts /api/lawyers (public)

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", message: "NyayaSetu backend is running ✅" });
});

// 404 fallback
app.use((req, res) => {
  res.status(404).json({ success: false, message: "Route not found." });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err.message);
  res.status(500).json({ success: false, message: "Internal server error." });
});

app.listen(PORT, () => {
  console.log(`🚀  NyayaSetu server running at http://localhost:${PORT}`);
});
