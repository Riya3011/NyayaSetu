// config/db.js
// ─────────────────────────────────────────────────────────────────────────────
// Handles the Mongoose connection to MongoDB.
// Called once at server startup — all routes share the same connection pool.
// ─────────────────────────────────────────────────────────────────────────────

const mongoose = require("mongoose");

async function connectDB() {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI);
    console.log(`✅  MongoDB connected: ${conn.connection.host}`);
  } catch (err) {
    console.error("❌  MongoDB connection failed:", err.message);
    // Exit process so the server doesn't run without a database
    process.exit(1);
  }
}

module.exports = connectDB;
