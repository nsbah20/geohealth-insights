require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { body, validationResult } = require("express-validator");
const mongoose = require("mongoose");

const app = express();
const PORT = process.env.PORT || 5000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:3000";

// ── Security middleware ──────────────────────────────────────────────────────
app.use(helmet());
app.use(
  cors({
    origin: CLIENT_ORIGIN,
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"],
  })
);
app.use(express.json({ limit: "10kb" }));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
});
app.use("/api", limiter);

// ── MongoDB connection ───────────────────────────────────────────────────────
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err.message);
    process.exit(1);
  });

// ── Case schema & model ──────────────────────────────────────────────────────
const caseSchema = new mongoose.Schema(
  {
    disease: { type: String, required: true, trim: true },
    location: { type: String, default: "Auto-Captured", trim: true },
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    cases: { type: Number, default: 1, min: 1 },
    date: { type: String, required: true },
  },
  { timestamps: true }
);
const Case = mongoose.model("Case", caseSchema);

// ── Routes ───────────────────────────────────────────────────────────────────
app.get("/api/health-data", async (req, res) => {
  try {
    const cases = await Case.find().sort({ createdAt: -1 });
    res.json(cases);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch cases" });
  }
});

app.post(
  "/api/cases",
  [
    body("disease").notEmpty().withMessage("Disease is required").trim().escape(),
    body("latitude").isFloat({ min: -90, max: 90 }).withMessage("Invalid latitude"),
    body("longitude").isFloat({ min: -180, max: 180 }).withMessage("Invalid longitude"),
    body("date").notEmpty().withMessage("Date is required"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { disease, latitude, longitude, location, date } = req.body;

    try {
      const newCase = await Case.create({
        disease,
        lat: Number(latitude),
        lng: Number(longitude),
        location: location || "Auto-Captured",
        cases: 1,
        date,
      });
      res.status(201).json(newCase);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to save case" });
    }
  }
);

// ── Health check ─────────────────────────────────────────────────────────────
app.get("/api/ping", (req, res) => res.json({ status: "ok" }));

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});