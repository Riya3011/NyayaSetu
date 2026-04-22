// seed.js
// ─────────────────────────────────────────────────────────────────────────────
// NyayaSetu — Database Seeder
// Run this to populate your database with sample lawyers and data.
// Usage: node seed.js
// ─────────────────────────────────────────────────────────────────────────────

require("dotenv").config();
const mongoose = require("mongoose");
const User     = require("./models/User");

const sampleAdmin = [
  {
    name: "Admin NyayaSetu",
    email: "admin@nyayasetu.com",
    password: "admin123",
    role: "admin",
    phone: "9000000000"
  }
];

const sampleLawyers = [
  {
    name: "Adv. Rajesh Sharma",
    email: "rajesh.sharma@legal.com",
    password: "password123",
    role: "lawyer",
    specialization: "Criminal Law",
    experience: 15,
    barCouncilId: "MAH/1234/2008",
    phone: "9876543210"
  },
  {
    name: "Adv. Priya Deshmukh",
    email: "priya.d@justice.org",
    password: "password123",
    role: "lawyer",
    specialization: "Family Law",
    experience: 8,
    barCouncilId: "MAH/5566/2015",
    phone: "9822334455"
  },
  {
    name: "Adv. Vikram Mehra",
    email: "v.mehra@propertylaw.in",
    password: "password123",
    role: "lawyer",
    specialization: "Property Law",
    experience: 12,
    barCouncilId: "DEL/9988/2011",
    phone: "9911223344"
  },
  {
    name: "Adv. Ananya Iyer",
    email: "ananya.iyer@cybercell.com",
    password: "password123",
    role: "lawyer",
    specialization: "Cyber Law",
    experience: 5,
    barCouncilId: "KA/7788/2019",
    phone: "9122334455"
  },
  {
    name: "Adv. Rohan Gupta",
    email: "rohan.g@labourlegal.com",
    password: "password123",
    role: "lawyer",
    specialization: "Labour Law",
    experience: 10,
    barCouncilId: "WB/3322/2013",
    phone: "9833009988"
  },
  {
    name: "Adv. Sanya Malhotra",
    email: "sanya.m@civilrights.com",
    password: "password123",
    role: "lawyer",
    specialization: "Civil Law",
    experience: 20,
    barCouncilId: "MAH/1122/2004",
    phone: "9822001122"
  },
  {
    name: "Adv. Kabir Khan",
    email: "kabir.k@consumerhelp.in",
    password: "password123",
    role: "lawyer",
    specialization: "Consumer Law",
    experience: 7,
    barCouncilId: "UP/4455/2016",
    phone: "9766554433"
  }
];

async function seed() {
  try {
    console.log("Connecting to MongoDB...");
    await mongoose.connect(process.env.MONGO_URI || "mongodb://localhost:27017/nyayasetu");
    console.log("✅ Connected.");

    // Seed Admin
    console.log("\nSeeding admin account...");
    await User.deleteMany({ role: "admin" });
    for (const admin of sampleAdmin) {
      await User.create(admin);
      console.log(` - Created Admin: ${admin.email} / password: ${admin.password}`);
    }

    // Seed Lawyers
    console.log("\nSeeding lawyers...");
    await User.deleteMany({ role: "lawyer" });
    for (const lawyer of sampleLawyers) {
      await User.create(lawyer);
      console.log(` - Created: ${lawyer.name} (${lawyer.specialization})`);
    }

    console.log("\n🚀 Seeding complete!");
    console.log("─────────────────────────────────────");
    console.log("Admin Login:");
    console.log("  Email   : admin@nyayasetu.com");
    console.log("  Password: admin123");
    console.log("  Role    : admin");
    console.log("\nLawyer Default Password: password123");
    console.log("─────────────────────────────────────");
    process.exit(0);
  } catch (err) {
    console.error("❌ Seeding failed:", err.message);
    process.exit(1);
  }
}

seed();
