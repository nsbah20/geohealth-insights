require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { body, validationResult } = require("express-validator");
const mongoose = require("mongoose");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 5000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:3000";
const allowedOrigins = CLIENT_ORIGIN.split(",").map((origin) => origin.trim()).filter(Boolean);
const CASE_STATUSES = ["New", "Under Review", "Confirmed", "Rejected", "Closed"];
const CASE_PRIORITIES = ["Low", "Medium", "High"];
const AGE_GROUPS = ["Unknown", "0-4", "5-17", "18-49", "50-64", "65+"];
const SEX_OPTIONS = ["Unknown", "Female", "Male", "Other"];
const USER_ROLES = ["System Administrator", "Epidemiology Reviewer", "Field Reporter", "Institution Viewer", "Data Manager"];
const DEFAULT_ORGANIZATION_SETTINGS = {
  organizationName: "GeoHealth Insights",
  defaultRegion: "Madison, WI",
  surveillanceScope: "Institutional disease surveillance and geospatial reporting",
  contactEmail: "",
  retentionDays: 365,
  lowPriorityMaxCases: 19,
  mediumPriorityMaxCases: 49,
  diseaseList: ["COVID-19", "Influenza", "Measles", "Norovirus", "Malaria", "Cholera", "Dengue"],
  facilityList: ["Hospital", "Clinic", "Laboratory", "School health office", "Community reporting line"],
  reportSourceList: ["Field report", "Clinic report", "Hospital report", "Laboratory report", "Community report", "School report", "Facility report", "Self report"],
};
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const ADMIN_ACCESS_CODE = process.env.ADMIN_ACCESS_CODE;
const SESSION_SECRET = process.env.SESSION_SECRET || process.env.MONGODB_URI || "geohealth-dev-session-secret";
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
    allowedHeaders: ["Content-Type", "Authorization"],
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

// ── Lightweight reviewer sessions ───────────────────────────────────────────
function base64UrlEncode(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function signPayload(payload) {
  return crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(payload)
    .digest("base64url");
}

function createSessionToken(user) {
  const payload = base64UrlEncode({
    sub: user.id,
    name: user.name,
    role: user.role,
    exp: Date.now() + SESSION_TTL_MS,
  });
  return `${payload}.${signPayload(payload)}`;
}

function readSessionToken(req) {
  const header = req.get("authorization") || "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) return null;

  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;

  const expectedSignature = signPayload(payload);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (signatureBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
    return null;
  }

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!session.exp || session.exp < Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

function requireReviewerSession(req, res, next) {
  if (!ADMIN_ACCESS_CODE && process.env.NODE_ENV === "production") {
    return res.status(503).json({ error: "Admin access is not configured yet." });
  }

  const session = readSessionToken(req);
  if (!session || !["Admin", "Reviewer"].includes(session.role)) {
    return res.status(401).json({ error: "Reviewer access is required." });
  }

  req.user = session;
  next();
}

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
    ageGroup: { type: String, enum: AGE_GROUPS, default: "Unknown" },
    sex: { type: String, enum: SEX_OPTIONS, default: "Unknown" },
    symptomOnsetDate: { type: String, default: "" },
    facility: { type: String, default: "", trim: true },
    suspectedExposure: { type: String, default: "", trim: true, maxlength: 1000 },
    reportSource: { type: String, default: "Field report", trim: true },
    notes: { type: String, default: "", trim: true, maxlength: 1000 },
    reviewHistory: [
      {
        reviewedAt: { type: Date, default: Date.now },
        reviewer: { type: String, default: "System reviewer", trim: true },
        status: { type: String, enum: CASE_STATUSES },
        priority: { type: String, enum: CASE_PRIORITIES },
        ageGroup: { type: String, enum: AGE_GROUPS },
        sex: { type: String, enum: SEX_OPTIONS },
        symptomOnsetDate: { type: String, default: "" },
        facility: { type: String, default: "", trim: true },
        suspectedExposure: { type: String, default: "", trim: true, maxlength: 1000 },
        reportSource: { type: String, trim: true },
        notes: { type: String, default: "", trim: true, maxlength: 1000 },
        changedFields: [{ type: String, trim: true }],
      },
    ],
  },
  { timestamps: true }
);
const Case = mongoose.model("Case", caseSchema);

const auditLogSchema = new mongoose.Schema(
  {
    action: { type: String, required: true, trim: true },
    actor: { type: String, default: "System", trim: true },
    role: { type: String, default: "System", trim: true },
    caseId: { type: mongoose.Schema.Types.ObjectId, ref: "Case" },
    caseDisease: { type: String, default: "", trim: true },
    caseLocation: { type: String, default: "", trim: true },
    changedFields: [{ type: String, trim: true }],
    metadata: { type: Object, default: {} },
  },
  { timestamps: true }
);
const AuditLog = mongoose.model("AuditLog", auditLogSchema);

const organizationSettingsSchema = new mongoose.Schema(
  {
    organizationName: { type: String, required: true, trim: true },
    defaultRegion: { type: String, required: true, trim: true },
    surveillanceScope: { type: String, required: true, trim: true, maxlength: 300 },
    contactEmail: { type: String, default: "", trim: true },
    retentionDays: { type: Number, default: 365, min: 30, max: 3650 },
    lowPriorityMaxCases: { type: Number, default: 19, min: 1, max: 100000 },
    mediumPriorityMaxCases: { type: Number, default: 49, min: 1, max: 100000 },
    diseaseList: [{ type: String, trim: true }],
    facilityList: [{ type: String, trim: true }],
    reportSourceList: [{ type: String, trim: true }],
  },
  { timestamps: true }
);
const OrganizationSettings = mongoose.model("OrganizationSettings", organizationSettingsSchema);

const organizationUserSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    role: { type: String, enum: USER_ROLES, required: true },
    facility: { type: String, default: "", trim: true },
    jurisdiction: { type: String, default: "", trim: true },
    status: { type: String, enum: ["Active", "Inactive"], default: "Active" },
    notes: { type: String, default: "", trim: true, maxlength: 500 },
  },
  { timestamps: true }
);
organizationUserSchema.index({ email: 1 }, { unique: true });
const OrganizationUser = mongoose.model("OrganizationUser", organizationUserSchema);

async function writeAuditLog(entry) {
  try {
    await AuditLog.create(entry);
  } catch (err) {
    console.error("Audit log write failed:", err.message);
  }
}

async function getOrganizationSettings() {
  let settings = await OrganizationSettings.findOne();
  if (!settings) {
    settings = await OrganizationSettings.create(DEFAULT_ORGANIZATION_SETTINGS);
  }
  return settings;
}

// ── Routes ───────────────────────────────────────────────────────────────────
app.get("/api/auth/session", (req, res) => {
  const session = readSessionToken(req);
  if (!session) {
    return res.status(401).json({ authenticated: false });
  }
  res.json({
    authenticated: true,
    user: {
      name: session.name,
      role: session.role,
      expiresAt: new Date(session.exp).toISOString(),
    },
  });
});

app.post(
  "/api/auth/login",
  [
    body("accessCode").notEmpty().withMessage("Access code is required").trim(),
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    if (!ADMIN_ACCESS_CODE && process.env.NODE_ENV === "production") {
      return res.status(503).json({ error: "Admin access is not configured yet." });
    }

    const expectedCode = ADMIN_ACCESS_CODE || "dev-admin";
    const submittedCode = req.body.accessCode;
    const expectedBuffer = Buffer.from(expectedCode);
    const submittedBuffer = Buffer.from(submittedCode);
    const isValid =
      expectedBuffer.length === submittedBuffer.length &&
      crypto.timingSafeEqual(expectedBuffer, submittedBuffer);

    if (!isValid) {
      return res.status(401).json({ error: "Invalid admin access code." });
    }

    const user = {
      id: "geohealth-admin",
      name: "GeoHealth Administrator",
      role: "Admin",
    };

    writeAuditLog({
      action: "admin_login",
      actor: user.name,
      role: user.role,
      metadata: {
        source: "admin_console",
      },
    });

    res.json({
      token: createSessionToken(user),
      user: {
        name: user.name,
        role: user.role,
      },
    });
  }
);

app.get("/api/admin/audit-logs", requireReviewerSession, async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: "Database is not connected" });
  }

  try {
    const logs = await AuditLog.find().sort({ createdAt: -1 }).limit(25);
    res.json(logs);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch audit logs" });
  }
});

app.get("/api/admin/users", requireReviewerSession, async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: "Database is not connected" });
  }

  try {
    const users = await OrganizationUser.find().sort({ role: 1, fullName: 1 });
    res.json(users);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch organization users" });
  }
});

app.post(
  "/api/admin/users",
  requireReviewerSession,
  [
    body("fullName").notEmpty().withMessage("Full name is required").trim().escape(),
    body("email").isEmail().withMessage("A valid email is required").normalizeEmail(),
    body("role").isIn(USER_ROLES).withMessage("Invalid role"),
    body("facility").optional({ checkFalsy: true }).trim().escape(),
    body("jurisdiction").optional({ checkFalsy: true }).trim().escape(),
    body("notes").optional({ checkFalsy: true }).trim().isLength({ max: 500 }).withMessage("Notes must be 500 characters or fewer").escape(),
  ],
  async (req, res) => {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: "Database is not connected" });
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const user = await OrganizationUser.create({
        fullName: req.body.fullName,
        email: req.body.email,
        role: req.body.role,
        facility: req.body.facility || "",
        jurisdiction: req.body.jurisdiction || "",
        notes: req.body.notes || "",
      });

      writeAuditLog({
        action: "organization_user_created",
        actor: req.user.name || "Admin",
        role: req.user.role || "Admin",
        changedFields: ["fullName", "email", "role", "facility", "jurisdiction"],
        metadata: {
          userEmail: user.email,
          userRole: user.role,
          userStatus: user.status,
        },
      });

      res.status(201).json(user);
    } catch (err) {
      if (err.code === 11000) {
        return res.status(409).json({ error: "A user with this email already exists." });
      }
      console.error(err);
      res.status(500).json({ error: "Failed to create organization user" });
    }
  }
);

app.patch(
  "/api/admin/users/:id",
  requireReviewerSession,
  [
    body("status").isIn(["Active", "Inactive"]).withMessage("Invalid user status"),
  ],
  async (req, res) => {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: "Database is not connected" });
    }

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: "Invalid user id" });
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const user = await OrganizationUser.findById(req.params.id);
      if (!user) {
        return res.status(404).json({ error: "Organization user not found" });
      }

      const changedFields = user.status === req.body.status ? [] : ["status"];
      user.status = req.body.status;
      const updatedUser = await user.save();

      if (changedFields.length > 0) {
        writeAuditLog({
          action: "organization_user_updated",
          actor: req.user.name || "Admin",
          role: req.user.role || "Admin",
          changedFields,
          metadata: {
            userEmail: updatedUser.email,
            userRole: updatedUser.role,
            userStatus: updatedUser.status,
          },
        });
      }

      res.json(updatedUser);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to update organization user" });
    }
  }
);

app.get("/api/settings", async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: "Database is not connected" });
  }

  try {
    const settings = await getOrganizationSettings();
    res.json({
      organizationName: settings.organizationName,
      defaultRegion: settings.defaultRegion,
      surveillanceScope: settings.surveillanceScope,
      contactEmail: settings.contactEmail,
      lowPriorityMaxCases: settings.lowPriorityMaxCases,
      mediumPriorityMaxCases: settings.mediumPriorityMaxCases,
      diseaseList: settings.diseaseList,
      facilityList: settings.facilityList,
      reportSourceList: settings.reportSourceList,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch organization settings" });
  }
});

app.get("/api/admin/settings", requireReviewerSession, async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: "Database is not connected" });
  }

  try {
    const settings = await getOrganizationSettings();
    res.json(settings);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch organization settings" });
  }
});

app.patch(
  "/api/admin/settings",
  requireReviewerSession,
  [
    body("organizationName").notEmpty().withMessage("Organization name is required").trim().escape(),
    body("defaultRegion").notEmpty().withMessage("Default region is required").trim().escape(),
    body("surveillanceScope").notEmpty().withMessage("Surveillance scope is required").trim().isLength({ max: 300 }).withMessage("Surveillance scope must be 300 characters or fewer").escape(),
    body("contactEmail").optional({ checkFalsy: true }).isEmail().withMessage("Contact email must be valid").normalizeEmail(),
    body("retentionDays").isInt({ min: 30, max: 3650 }).withMessage("Retention days must be between 30 and 3650"),
    body("lowPriorityMaxCases").isInt({ min: 1, max: 100000 }).withMessage("Low priority threshold must be a positive number"),
    body("mediumPriorityMaxCases").isInt({ min: 1, max: 100000 }).withMessage("Medium priority threshold must be a positive number"),
    body("diseaseList").isArray({ min: 1 }).withMessage("At least one disease is required"),
    body("diseaseList.*").notEmpty().withMessage("Disease names cannot be empty").trim().escape(),
    body("facilityList").isArray({ min: 1 }).withMessage("At least one facility is required"),
    body("facilityList.*").notEmpty().withMessage("Facility names cannot be empty").trim().escape(),
    body("reportSourceList").isArray({ min: 1 }).withMessage("At least one report source is required"),
    body("reportSourceList.*").notEmpty().withMessage("Report source names cannot be empty").trim().escape(),
  ],
  async (req, res) => {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: "Database is not connected" });
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    if (Number(req.body.lowPriorityMaxCases) >= Number(req.body.mediumPriorityMaxCases)) {
      return res.status(400).json({ error: "Medium priority threshold must be higher than the low priority threshold." });
    }

    const settingsFields = [
      "organizationName",
      "defaultRegion",
      "surveillanceScope",
      "contactEmail",
      "retentionDays",
      "lowPriorityMaxCases",
      "mediumPriorityMaxCases",
      "diseaseList",
      "facilityList",
      "reportSourceList",
    ];

    try {
      const settings = await getOrganizationSettings();
      const changedFields = settingsFields.filter((field) => {
        const before = JSON.stringify(settings[field] ?? "");
        const after = JSON.stringify(req.body[field] ?? "");
        return before !== after;
      });

      settingsFields.forEach((field) => {
        settings[field] = req.body[field];
      });

      const updatedSettings = await settings.save();
      if (changedFields.length > 0) {
        writeAuditLog({
          action: "organization_settings_updated",
          actor: req.user.name || "Admin",
          role: req.user.role || "Admin",
          changedFields,
          metadata: {
            organizationName: updatedSettings.organizationName,
            defaultRegion: updatedSettings.defaultRegion,
          },
        });
      }

      res.json(updatedSettings);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to update organization settings" });
    }
  }
);

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
    body("ageGroup").optional().isIn(AGE_GROUPS).withMessage("Invalid age group"),
    body("sex").optional().isIn(SEX_OPTIONS).withMessage("Invalid sex"),
    body("symptomOnsetDate").optional().trim().escape(),
    body("facility").optional().trim().escape(),
    body("suspectedExposure").optional().trim().isLength({ max: 1000 }).withMessage("Suspected exposure must be 1000 characters or fewer").escape(),
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

    const {
      disease,
      latitude,
      longitude,
      location,
      cases,
      date,
      status,
      priority,
      ageGroup,
      sex,
      symptomOnsetDate,
      facility,
      suspectedExposure,
      reportSource,
      notes,
    } = req.body;

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
        ageGroup: ageGroup || "Unknown",
        sex: sex || "Unknown",
        symptomOnsetDate: symptomOnsetDate || "",
        facility: facility || "",
        suspectedExposure: suspectedExposure || "",
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
  requireReviewerSession,
  [
    body("status").optional().isIn(CASE_STATUSES).withMessage("Invalid status"),
    body("priority").optional().isIn(CASE_PRIORITIES).withMessage("Invalid priority"),
    body("ageGroup").optional().isIn(AGE_GROUPS).withMessage("Invalid age group"),
    body("sex").optional().isIn(SEX_OPTIONS).withMessage("Invalid sex"),
    body("symptomOnsetDate").optional().trim().escape(),
    body("facility").optional().trim().escape(),
    body("suspectedExposure").optional().trim().isLength({ max: 1000 }).withMessage("Suspected exposure must be 1000 characters or fewer").escape(),
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

    const reviewFields = [
      "status",
      "priority",
      "ageGroup",
      "sex",
      "symptomOnsetDate",
      "facility",
      "suspectedExposure",
      "reportSource",
      "notes",
    ];

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
          ageGroup: caseRecord.ageGroup,
          sex: caseRecord.sex,
          symptomOnsetDate: caseRecord.symptomOnsetDate,
          facility: caseRecord.facility,
          suspectedExposure: caseRecord.suspectedExposure,
          reportSource: caseRecord.reportSource,
          notes: caseRecord.notes,
          changedFields,
        });
      }

      const updatedCase = await caseRecord.save();
      if (changedFields.length > 0) {
        writeAuditLog({
          action: "case_review_updated",
          actor: req.user.name || "Reviewer",
          role: req.user.role || "Reviewer",
          caseId: caseRecord._id,
          caseDisease: caseRecord.disease,
          caseLocation: caseRecord.location,
          changedFields,
          metadata: {
            status: caseRecord.status,
            priority: caseRecord.priority,
          },
        });
      }
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
