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
const allowedOrigins = CLIENT_ORIGIN.split(",").map((origin) => origin.trim()).filter(Boolean);
const CASE_STATUSES = ["New", "Under Review", "Confirmed", "Rejected", "Closed"];
const CASE_PRIORITIES = ["Low", "Medium", "High"];
mongoose.set("bufferCommands", false);

// ── Security middleware ──────────────────────────────────────────────────────
app.use(helmet());
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "POST", "PATCH"],
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
  .connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 })
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err.message);
  });

// ── Case schema & model ──────────────────────────────────────────────────────
const caseSchema = new mongoose.Schema(
  {
    disease: { type: String, required: true, trim: true },
    location: { type: String, required: true, trim: true },
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    cases: { type: Number, default: 1, min: 1 },
    date: { type: String, required: true },
    status: {
      type: String,
      enum: CASE_STATUSES,
      default: "New",
    },
    priority: {
      type: String,
      enum: CASE_PRIORITIES,
      default: "Medium",
    },
    reportSource: { type: String, default: "Field report", trim: true },
    notes: { type: String, default: "", trim: true, maxlength: 1000 },
    reviewHistory: [
      {
        reviewedAt: { type: Date, default: Date.now },
        reviewer: { type: String, default: "System reviewer", trim: true },
        status: { type: String, enum: CASE_STATUSES },
        priority: { type: String, enum: CASE_PRIORITIES },
        reportSource: { type: String, trim: true },
        notes: { type: String, default: "", trim: true, maxlength: 1000 },
        changedFields: [{ type: String, trim: true }],
      },
    ],
  },
  { timestamps: true }
);
const Case = mongoose.model("Case", caseSchema);

// ── Routes ───────────────────────────────────────────────────────────────────
app.get("/api/health-data", async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: "Database is not connected" });
  }

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
    body("location").notEmpty().withMessage("Location is required").trim().escape(),
    body("latitude").isFloat({ min: -90, max: 90 }).withMessage("Invalid latitude"),
    body("longitude").isFloat({ min: -180, max: 180 }).withMessage("Invalid longitude"),
    body("cases").optional().isInt({ min: 1, max: 100000 }).withMessage("Cases must be a positive number"),
    body("date").notEmpty().withMessage("Date is required"),
    body("status").optional().isIn(CASE_STATUSES).withMessage("Invalid status"),
    body("priority").optional().isIn(CASE_PRIORITIES).withMessage("Invalid priority"),
    body("reportSource").optional().trim().escape(),
    body("notes").optional().trim().isLength({ max: 1000 }).withMessage("Notes must be 1000 characters or fewer").escape(),
  ],
  async (req, res) => {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: "Database is not connected" });
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { disease, latitude, longitude, location, cases, date, status, priority, reportSource, notes } = req.body;

    try {
      const newCase = await Case.create({
        disease,
        lat: Number(latitude),
        lng: Number(longitude),
        location,
        cases: Number(cases) || 1,
        date,
        status: status || "New",
        priority: priority || "Medium",
        reportSource: reportSource || "Field report",
        notes: notes || "",
      });
      res.status(201).json(newCase);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to save case" });
    }
  }
);

app.patch(
  "/api/cases/:id",
  [
    body("status").optional().isIn(CASE_STATUSES).withMessage("Invalid status"),
    body("priority").optional().isIn(CASE_PRIORITIES).withMessage("Invalid priority"),
    body("reportSource").optional().trim().escape(),
    body("notes").optional().trim().isLength({ max: 1000 }).withMessage("Notes must be 1000 characters or fewer").escape(),
  ],
  async (req, res) => {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: "Database is not connected" });
    }

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: "Invalid case id" });
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const reviewFields = ["status", "priority", "reportSource", "notes"];

    try {
      const caseRecord = await Case.findById(req.params.id);

      if (!caseRecord) {
        return res.status(404).json({ error: "Case not found" });
      }

      const changedFields = reviewFields.filter((field) => {
        if (!Object.prototype.hasOwnProperty.call(req.body, field)) return false;
        return String(caseRecord[field] ?? "") !== String(req.body[field] ?? "");
      });

      reviewFields.forEach((field) => {
        if (Object.prototype.hasOwnProperty.call(req.body, field)) {
          caseRecord[field] = req.body[field];
        }
      });

      if (changedFields.length > 0) {
        caseRecord.reviewHistory.push({
          reviewer: "System reviewer",
          status: caseRecord.status,
          priority: caseRecord.priority,
          reportSource: caseRecord.reportSource,
          notes: caseRecord.notes,
          changedFields,
        });
      }

      const updatedCase = await caseRecord.save();
      res.json(updatedCase);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to update case" });
    }
  }
);

// ── Health check ─────────────────────────────────────────────────────────────
app.get("/api/ping", (req, res) => res.json({ status: "ok" }));

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
