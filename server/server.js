require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { body, validationResult } = require("express-validator");
const mongoose = require("mongoose");
const crypto = require("crypto");

const app = express();
// Render terminates public traffic at its proxy before forwarding it here.
app.set("trust proxy", 1);
const PORT = process.env.PORT || 5000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:3000";
const allowedOrigins = CLIENT_ORIGIN.split(",").map((origin) => origin.trim()).filter(Boolean);
const CASE_STATUSES = ["New", "Under Review", "Confirmed", "Rejected", "Closed"];
const CASE_PRIORITIES = ["Low", "Medium", "High"];
const AGE_GROUPS = ["Unknown", "0-4", "5-17", "18-49", "50-64", "65+"];
const SEX_OPTIONS = ["Unknown", "Female", "Male", "Other"];
const LOCATION_SOURCES = ["GPS captured", "Manually entered", "Admin corrected", "Imported report"];
const LOCATION_VERIFICATIONS = ["GPS verified", "Needs location review", "Admin corrected", "Reported remotely"];
const USER_ROLES = ["System Administrator", "Epidemiology Reviewer", "Field Reporter", "Institution Viewer", "Data Manager"];
const ADMIN_ROLES = ["Admin", "System Administrator"];
const REVIEWER_ROLES = ["Admin", "System Administrator", "Epidemiology Reviewer", "Data Manager"];
const REPORTER_ROLES = ["Admin", "System Administrator", "Epidemiology Reviewer", "Field Reporter", "Data Manager"];
const DELETE_ROLES = ["Admin", "System Administrator"];
const IMPORT_ROLES = ["Admin", "System Administrator", "Data Manager"];
const IMPORT_ALLOWED_FIELDS = [
  "external_id",
  "disease",
  "location",
  "latitude",
  "longitude",
  "cases",
  "report_date",
  "age_group",
  "sex",
  "facility",
  "report_source",
  "notes",
];
const IMPORT_REQUIRED_FIELDS = ["disease", "location", "latitude", "longitude", "report_date"];
const MAX_IMPORT_ROWS = 500;
const RETENTION_BATCH_LIMIT = 500;
const RETENTION_PREVIEW_TTL_MS = 15 * 60 * 1000;
const BACKUP_MAX_AGE_DAYS = 7;
const RESTORE_TEST_MAX_AGE_DAYS = 90;
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
const DEFAULT_SESSION_DURATION_HOURS = 8;
const MIN_SESSION_DURATION_HOURS = 1;
const MAX_SESSION_DURATION_HOURS = 24;
const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;
const EMAIL_LOGIN_LINK_TTL_MS = 15 * 60 * 1000;
const ADMIN_ACCESS_CODE = process.env.ADMIN_ACCESS_CODE;
const SESSION_SECRET = process.env.SESSION_SECRET || process.env.MONGODB_URI || "geohealth-dev-session-secret";
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const EMAIL_FROM = process.env.EMAIL_FROM || "";
const PUBLIC_APP_URL = (
  process.env.PUBLIC_APP_URL
  || allowedOrigins.find((origin) => origin.startsWith("https://"))
  || allowedOrigins[0]
  || "http://localhost:3000"
).replace(/\/$/, "");
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
    methods: ["GET", "POST", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.use("/api/admin/imports", express.json({ limit: "1mb" }));
app.use(express.json({ limit: "10kb" }));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
});
app.use("/api", limiter);

const emailLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many sign-in link requests. Please try again later." },
});

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

function normalizeSessionDurationHours(durationHours = DEFAULT_SESSION_DURATION_HOURS) {
  const hours = Number(durationHours);
  return Math.min(
    MAX_SESSION_DURATION_HOURS,
    Math.max(MIN_SESSION_DURATION_HOURS, Number.isFinite(hours) ? hours : DEFAULT_SESSION_DURATION_HOURS)
  );
}

function getSessionDurationMs(durationHours = DEFAULT_SESSION_DURATION_HOURS) {
  return normalizeSessionDurationHours(durationHours) * 60 * 60 * 1000;
}

function createSessionToken(user, durationMs = SESSION_TTL_MS) {
  const sessionDurationHours = normalizeSessionDurationHours(user.sessionDurationHours);
  const payload = base64UrlEncode({
    sub: user.id,
    name: user.name,
    email: user.email || "",
    role: user.role,
    facility: user.facility || "",
    jurisdiction: user.jurisdiction || "",
    sessionDurationHours,
    exp: Date.now() + durationMs,
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
  const session = readSessionToken(req);
  if (!session || !REVIEWER_ROLES.includes(session.role)) {
    return res.status(401).json({ error: "Reviewer access is required." });
  }

  req.user = session;
  next();
}

function requireReporterSession(req, res, next) {
  const session = readSessionToken(req);
  if (!session || !REPORTER_ROLES.includes(session.role)) {
    return res.status(401).json({ error: "Reporter access is required to submit cases." });
  }

  req.user = session;
  next();
}

function requireSignedInSession(req, res, next) {
  const session = readSessionToken(req);
  if (!session || !session.role) {
    return res.status(401).json({ error: "Signed-in organization access is required." });
  }

  req.user = session;
  next();
}

function requireAdminSession(req, res, next) {
  const session = readSessionToken(req);
  if (!session || !ADMIN_ROLES.includes(session.role)) {
    return res.status(401).json({ error: "Administrator access is required." });
  }

  req.user = session;
  next();
}

function requireDeleteSession(req, res, next) {
  const session = readSessionToken(req);
  if (!session || !DELETE_ROLES.includes(session.role)) {
    return res.status(401).json({ error: "Administrator access is required to delete cases." });
  }

  req.user = session;
  next();
}

function requireImportSession(req, res, next) {
  const session = readSessionToken(req);
  if (!session || !IMPORT_ROLES.includes(session.role)) {
    return res.status(401).json({ error: "Administrator or Data Manager access is required to import cases." });
  }

  req.user = session;
  next();
}

function buildSessionUser(session) {
  const role = session.role || "";
  return {
    name: session.name,
    email: session.email || "",
    role,
    facility: session.facility || "",
    jurisdiction: session.jurisdiction || "",
    expiresAt: new Date(session.exp).toISOString(),
    sessionDurationHours: normalizeSessionDurationHours(session.sessionDurationHours),
    canAdmin: ADMIN_ROLES.includes(role),
    canReview: REVIEWER_ROLES.includes(role),
    canReport: REPORTER_ROLES.includes(role),
    canDelete: DELETE_ROLES.includes(role),
    canImport: IMPORT_ROLES.includes(role),
    canView: Boolean(role),
  };
}

function hashAccessCode(accessCode) {
  const salt = crypto.randomBytes(16).toString("base64url");
  const hash = crypto.scryptSync(accessCode, salt, 64).toString("base64url");
  return `${salt}:${hash}`;
}

function verifyAccessCode(accessCode, storedHash) {
  if (!accessCode || !storedHash || !storedHash.includes(":")) return false;
  const [salt, hash] = storedHash.split(":");
  const submittedHash = crypto.scryptSync(accessCode, salt, 64).toString("base64url");
  const expectedBuffer = Buffer.from(hash);
  const submittedBuffer = Buffer.from(submittedHash);
  return expectedBuffer.length === submittedBuffer.length && crypto.timingSafeEqual(expectedBuffer, submittedBuffer);
}

function locationMatchesJurisdiction(location = "", jurisdiction = "") {
  if (!jurisdiction) return true;
  const normalizedLocation = String(location).toLowerCase();
  return String(jurisdiction)
    .toLowerCase()
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 2)
    .some((part) => normalizedLocation.includes(part));
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
    enteredLocation: { type: String, default: "", trim: true },
    capturedLat: { type: Number },
    capturedLng: { type: Number },
    locationSource: { type: String, enum: LOCATION_SOURCES, default: "GPS captured" },
    locationVerification: { type: String, enum: LOCATION_VERIFICATIONS, default: "GPS verified" },
    locationReviewReason: { type: String, default: "", trim: true },
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
    submittedBy: { type: String, default: "Unknown reporter", trim: true },
    submittedByEmail: { type: String, default: "", trim: true },
    submittedByRole: { type: String, default: "", trim: true },
    submittedByFacility: { type: String, default: "", trim: true },
    submittedByJurisdiction: { type: String, default: "", trim: true },
    importBatchId: { type: mongoose.Schema.Types.ObjectId, ref: "CaseImportBatch" },
    externalRecordId: { type: String, default: "", trim: true },
    importFingerprint: { type: String, trim: true },
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
        location: { type: String, default: "", trim: true },
        lat: { type: Number },
        lng: { type: Number },
        locationSource: { type: String, enum: LOCATION_SOURCES },
        locationVerification: { type: String, enum: LOCATION_VERIFICATIONS },
        locationReviewReason: { type: String, default: "", trim: true },
        suspectedExposure: { type: String, default: "", trim: true, maxlength: 1000 },
        reportSource: { type: String, trim: true },
        notes: { type: String, default: "", trim: true, maxlength: 1000 },
        changedFields: [{ type: String, trim: true }],
      },
    ],
  },
  { timestamps: true }
);
caseSchema.index({ importFingerprint: 1 }, { unique: true, sparse: true });
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
    sessionDurationHours: { type: Number, default: DEFAULT_SESSION_DURATION_HOURS, min: MIN_SESSION_DURATION_HOURS, max: MAX_SESSION_DURATION_HOURS },
    accessCodeHash: { type: String, required: true, select: false },
    accessCodeUpdatedAt: { type: Date },
    invitedAt: { type: Date },
    inviteDeliveryMethod: { type: String, enum: ["manual", "email"], default: "manual" },
    resetRequestedAt: { type: Date },
    resetHandoffAt: { type: Date },
    resetHandoffDeliveryMethod: { type: String, enum: ["manual", "email"], default: "manual" },
    lastLoginAt: { type: Date },
    failedLoginAttempts: { type: Number, default: 0, min: 0 },
    lockedUntil: { type: Date },
    notes: { type: String, default: "", trim: true, maxlength: 500 },
  },
  { timestamps: true }
);
organizationUserSchema.index({ email: 1 }, { unique: true });
const OrganizationUser = mongoose.model("OrganizationUser", organizationUserSchema);

const emailLoginLinkSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "OrganizationUser", required: true, index: true },
    tokenHash: { type: String, required: true, unique: true, index: true },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
    usedAt: { type: Date },
  },
  { timestamps: true }
);
const EmailLoginLink = mongoose.model("EmailLoginLink", emailLoginLinkSchema);

const importRowSchema = new mongoose.Schema(
  {
    rowNumber: { type: Number, required: true },
    externalId: { type: String, default: "", trim: true },
    disease: { type: String, default: "", trim: true },
    location: { type: String, default: "", trim: true },
    lat: { type: Number },
    lng: { type: Number },
    cases: { type: Number, default: 1 },
    date: { type: String, default: "" },
    ageGroup: { type: String, default: "Unknown" },
    sex: { type: String, default: "Unknown" },
    facility: { type: String, default: "", trim: true },
    reportSource: { type: String, default: "Imported report", trim: true },
    notes: { type: String, default: "", trim: true },
    fingerprint: { type: String, default: "", trim: true },
    errors: [{ type: String, trim: true }],
    duplicate: { type: Boolean, default: false },
  },
  { _id: false }
);

const caseImportBatchSchema = new mongoose.Schema(
  {
    filename: { type: String, required: true, trim: true },
    uploadedBy: { type: String, required: true, trim: true },
    uploadedByEmail: { type: String, default: "", trim: true },
    uploadedByRole: { type: String, required: true, trim: true },
    status: { type: String, enum: ["Staged", "Publishing", "Imported", "Rejected"], default: "Staged" },
    totalRows: { type: Number, required: true },
    validRows: { type: Number, required: true },
    invalidRows: { type: Number, required: true },
    duplicateRows: { type: Number, required: true },
    importedRows: { type: Number, default: 0 },
    rows: [importRowSchema],
    publishedAt: { type: Date },
    publishedBy: { type: String, default: "", trim: true },
    rejectedAt: { type: Date },
    rejectedBy: { type: String, default: "", trim: true },
  },
  { timestamps: true }
);
const CaseImportBatch = mongoose.model("CaseImportBatch", caseImportBatchSchema);

const retentionRunSchema = new mongoose.Schema(
  {
    status: { type: String, enum: ["Previewed", "Executing", "Executed", "Expired"], default: "Previewed" },
    policyDays: { type: Number, required: true },
    cutoffDate: { type: Date, required: true },
    eligibleCount: { type: Number, required: true },
    plannedCount: { type: Number, required: true },
    deletedCount: { type: Number, default: 0 },
    statusBreakdown: { type: Object, default: {} },
    targetCaseIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Case" }],
    targetHashes: [{ type: String, trim: true }],
    previewedBy: { type: String, required: true, trim: true },
    previewedByRole: { type: String, required: true, trim: true },
    expiresAt: { type: Date, required: true },
    executedAt: { type: Date },
    executedBy: { type: String, default: "", trim: true },
  },
  { timestamps: true }
);
const RetentionRun = mongoose.model("RetentionRun", retentionRunSchema);

const backupVerificationSchema = new mongoose.Schema(
  {
    provider: { type: String, required: true, trim: true, maxlength: 100 },
    reference: { type: String, required: true, trim: true, maxlength: 200 },
    completedAt: { type: Date, required: true },
    status: { type: String, enum: ["Verified", "Failed"], required: true },
    notes: { type: String, default: "", trim: true, maxlength: 1000 },
    verifiedBy: { type: String, required: true, trim: true },
    verifiedByRole: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);
backupVerificationSchema.index({ completedAt: -1 });
const BackupVerification = mongoose.model("BackupVerification", backupVerificationSchema);

const restoreTestSchema = new mongoose.Schema(
  {
    backupVerificationId: { type: mongoose.Schema.Types.ObjectId, ref: "BackupVerification", required: true },
    outcome: { type: String, enum: ["Passed", "Failed"], required: true },
    testedAt: { type: Date, required: true },
    notes: { type: String, required: true, trim: true, maxlength: 1000 },
    testedBy: { type: String, required: true, trim: true },
    testedByRole: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);
restoreTestSchema.index({ testedAt: -1 });
const RestoreTest = mongoose.model("RestoreTest", restoreTestSchema);

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

function isEmailDeliveryConfigured() {
  return Boolean(RESEND_API_KEY && EMAIL_FROM);
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatSessionWindow(hours) {
  const value = normalizeSessionDurationHours(hours);
  return `${value} ${value === 1 ? "hour" : "hours"}`;
}

function buildStaffEmail({ user, settings, kind }) {
  const signInUrl = `${PUBLIC_APP_URL}/admin`;
  const organizationName = settings.organizationName || DEFAULT_ORGANIZATION_SETTINGS.organizationName;
  const isReset = kind === "reset";
  const subject = isReset
    ? `${organizationName} access reset notice`
    : `Your ${organizationName} staff access`;
  const introduction = isReset
    ? `Your ${organizationName} access has been reset by an administrator.`
    : `You have been added to ${organizationName} as ${user.role}.`;
  const codeLine = isReset
    ? "Your new access code will be provided separately by your administrator."
    : "Your access code will be provided separately by your administrator.";
  const details = [
    `Sign-in type: Organization user`,
    `Email: ${user.email}`,
    `Approved session window: ${formatSessionWindow(user.sessionDurationHours)}`,
    `Jurisdiction: ${user.jurisdiction || settings.defaultRegion}`,
    user.facility ? `Facility: ${user.facility}` : "",
  ].filter(Boolean);
  const text = [
    `Hello ${user.fullName},`,
    "",
    introduction,
    `Sign in here: ${signInUrl}`,
    "",
    ...details,
    codeLine,
    "",
    "For security, do not share your access code.",
  ].join("\n");
  const detailRows = details.map((detail) => `<li style="margin:0 0 8px;">${escapeHtml(detail)}</li>`).join("");
  const html = `
    <div style="margin:0;background:#eef4f2;padding:32px 16px;font-family:Arial,sans-serif;color:#102a2c;">
      <div style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #dbe7e4;border-radius:8px;overflow:hidden;">
        <div style="background:#083b3b;padding:24px 28px;color:#ffffff;">
          <div style="font-size:12px;font-weight:700;text-transform:uppercase;color:#99f6e4;">Secure staff access</div>
          <h1 style="margin:8px 0 0;font-size:24px;line-height:1.2;">${escapeHtml(organizationName)}</h1>
        </div>
        <div style="padding:28px;">
          <p style="margin:0 0 16px;">Hello ${escapeHtml(user.fullName)},</p>
          <p style="margin:0 0 20px;line-height:1.6;">${escapeHtml(introduction)}</p>
          <a href="${escapeHtml(signInUrl)}" style="display:inline-block;background:#0f766e;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:6px;">Open secure sign-in</a>
          <ul style="margin:24px 0 20px;padding-left:20px;line-height:1.5;">${detailRows}</ul>
          <p style="margin:0 0 12px;padding:12px;background:#fff7ed;border-left:4px solid #f59e0b;line-height:1.5;">${escapeHtml(codeLine)}</p>
          <p style="margin:0;color:#64748b;font-size:13px;line-height:1.5;">For security, do not share your access code.</p>
        </div>
      </div>
    </div>`;

  return { subject, text, html };
}

function buildEmailLoginEmail({ user, settings, token }) {
  const organizationName = settings.organizationName || DEFAULT_ORGANIZATION_SETTINGS.organizationName;
  const signInUrl = `${PUBLIC_APP_URL}/admin#login_token=${encodeURIComponent(token)}`;
  const subject = `Your ${organizationName} secure sign-in link`;
  const text = [
    `Hello ${user.fullName},`,
    "",
    `Use this single-use link to sign in to ${organizationName}:`,
    signInUrl,
    "",
    "This link expires in 15 minutes. If you did not request it, you can ignore this email.",
  ].join("\n");
  const html = `
    <div style="margin:0;background:#eef4f2;padding:32px 16px;font-family:Arial,sans-serif;color:#102a2c;">
      <div style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #dbe7e4;border-radius:8px;overflow:hidden;">
        <div style="background:#083b3b;padding:24px 28px;color:#ffffff;">
          <div style="font-size:12px;font-weight:700;text-transform:uppercase;color:#99f6e4;">One-time staff sign-in</div>
          <h1 style="margin:8px 0 0;font-size:24px;line-height:1.2;">${escapeHtml(organizationName)}</h1>
        </div>
        <div style="padding:28px;">
          <p style="margin:0 0 16px;">Hello ${escapeHtml(user.fullName)},</p>
          <p style="margin:0 0 20px;line-height:1.6;">Use the button below to open your approved staff workspace.</p>
          <a href="${escapeHtml(signInUrl)}" style="display:inline-block;background:#0f766e;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:6px;">Sign in securely</a>
          <p style="margin:24px 0 0;padding:12px;background:#fff7ed;border-left:4px solid #f59e0b;line-height:1.5;">This link can be used once and expires in 15 minutes.</p>
          <p style="margin:16px 0 0;color:#64748b;font-size:13px;line-height:1.5;">If you did not request this email, no action is required.</p>
        </div>
      </div>
    </div>`;

  return { subject, text, html };
}

async function sendTransactionalEmail({ to, subject, text, html, idempotencyKey }) {
  if (!isEmailDeliveryConfigured()) {
    return { status: "manual", provider: null };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: [to],
        subject,
        text,
        html,
      }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.message || `Email provider returned ${response.status}`);
    }
    return { status: "sent", provider: "resend", messageId: payload.id || "" };
  } catch (err) {
    err.code = "EMAIL_DELIVERY_FAILED";
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

function serializePublicCase(caseRecord) {
  const roundPublicCoordinate = (value) => Number(Number(value).toFixed(2));
  const needsLocationReview = caseRecord.locationVerification === "Needs location review";

  return {
    _id: caseRecord._id,
    disease: caseRecord.disease,
    location: needsLocationReview ? "Location pending verification" : caseRecord.location,
    lat: roundPublicCoordinate(caseRecord.lat),
    lng: roundPublicCoordinate(caseRecord.lng),
    cases: caseRecord.cases,
    date: caseRecord.date,
    status: caseRecord.status,
    priority: caseRecord.priority,
    locationPrecision: "approximate",
    locationSource: caseRecord.locationSource || "GPS captured",
    locationVerification: caseRecord.locationVerification || "GPS verified",
    source: "live",
  };
}

function cleanImportText(value, maxLength = 300) {
  return String(value ?? "").replace(/\0/g, "").trim().slice(0, maxLength);
}

function findCanonicalOption(value, options) {
  const normalized = cleanImportText(value).toLowerCase();
  return options.find((option) => option.toLowerCase() === normalized) || "";
}

function hasSpreadsheetFormula(value) {
  return /^[=+@\t\r]/.test(cleanImportText(value));
}

function buildImportFingerprint(row) {
  const identity = row.externalId
    ? `external:${row.externalId.toLowerCase()}`
    : [row.disease, row.location, row.lat, row.lng, row.cases, row.date]
      .map((value) => String(value).trim().toLowerCase())
      .join("|");
  return crypto.createHash("sha256").update(identity).digest("hex");
}

function buildRetentionCaseHash(caseId) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(`retention:${caseId}`).digest("hex");
}

function buildRetentionFilter(cutoffDate, caseIds) {
  const filter = {
    status: { $in: ["Closed", "Rejected"] },
    updatedAt: { $lt: cutoffDate },
  };
  if (caseIds) filter._id = { $in: caseIds };
  return filter;
}

function serializeRetentionRun(run) {
  return {
    _id: run._id,
    status: run.status,
    policyDays: run.policyDays,
    cutoffDate: run.cutoffDate,
    eligibleCount: run.eligibleCount,
    plannedCount: run.plannedCount,
    deferredCount: Math.max(0, run.eligibleCount - run.plannedCount),
    deletedCount: run.deletedCount,
    statusBreakdown: run.statusBreakdown || {},
    previewedBy: run.previewedBy,
    expiresAt: run.expiresAt,
    executedAt: run.executedAt,
    executedBy: run.executedBy,
    createdAt: run.createdAt,
  };
}

async function getRecoveryReadiness() {
  const [latestBackup, latestRestoreTest] = await Promise.all([
    BackupVerification.findOne({ status: "Verified" }).sort({ completedAt: -1 }).lean(),
    RestoreTest.findOne({ outcome: "Passed" }).sort({ testedAt: -1 }).lean(),
  ]);
  const backupCutoff = new Date(Date.now() - BACKUP_MAX_AGE_DAYS * 24 * 60 * 60 * 1000);
  const restoreCutoff = new Date(Date.now() - RESTORE_TEST_MAX_AGE_DAYS * 24 * 60 * 60 * 1000);
  const backupCurrent = Boolean(latestBackup && latestBackup.completedAt >= backupCutoff);
  const restoreTestCurrent = Boolean(latestRestoreTest && latestRestoreTest.testedAt >= restoreCutoff);

  return {
    backupCurrent,
    restoreTestCurrent,
    retentionDisposalAllowed: backupCurrent && restoreTestCurrent,
    backupMaxAgeDays: BACKUP_MAX_AGE_DAYS,
    restoreTestMaxAgeDays: RESTORE_TEST_MAX_AGE_DAYS,
    latestBackup,
    latestRestoreTest,
  };
}

function serializeBackupVerification(record) {
  if (!record) return null;
  return {
    _id: record._id,
    provider: record.provider,
    reference: record.reference,
    completedAt: record.completedAt,
    status: record.status,
    notes: record.notes,
    verifiedBy: record.verifiedBy,
    createdAt: record.createdAt,
  };
}

function serializeRestoreTest(record) {
  if (!record) return null;
  return {
    _id: record._id,
    backupVerificationId: record.backupVerificationId,
    outcome: record.outcome,
    testedAt: record.testedAt,
    notes: record.notes,
    testedBy: record.testedBy,
    createdAt: record.createdAt,
  };
}

function isValidIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function normalizeImportDate(value) {
  const cleaned = cleanImportText(value, 30);
  if (isValidIsoDate(cleaned)) return cleaned;

  const localized = cleaned.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!localized) return "";

  const first = Number(localized[1]);
  const second = Number(localized[2]);
  const year = Number(localized[3]);
  if (first <= 12 && second <= 12) return "";

  const day = first > 12 ? first : second;
  const month = first > 12 ? second : first;
  const normalized = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return isValidIsoDate(normalized) ? normalized : "";
}

function normalizeImportAgeGroup(value) {
  const cleaned = cleanImportText(value, 30);
  const canonical = findCanonicalOption(cleaned, AGE_GROUPS);
  if (canonical) return canonical;

  const rangeMatch = cleaned.toLowerCase().match(/^(0|5|18|50)\s*(?:to|through|-)\s*(4|17|49|64)$/);
  if (rangeMatch) {
    const candidate = `${rangeMatch[1]}-${rangeMatch[2]}`;
    if (AGE_GROUPS.includes(candidate)) return candidate;
  }

  if (/^(?:may[-/ ]?17|17[-/ ]?may|5\/17(?:\/\d{2,4})?|17\/5(?:\/\d{2,4})?)$/i.test(cleaned)) {
    return "5-17";
  }
  return cleaned;
}

function normalizeImportRow(rawRow, index, settings) {
  const normalizedDate = normalizeImportDate(rawRow.report_date);
  const row = {
    rowNumber: index + 2,
    externalId: cleanImportText(rawRow.external_id, 100),
    disease: findCanonicalOption(rawRow.disease, settings.diseaseList || []),
    location: cleanImportText(rawRow.location, 200),
    lat: Number(rawRow.latitude),
    lng: Number(rawRow.longitude),
    cases: rawRow.cases === "" || rawRow.cases === undefined ? 1 : Number(rawRow.cases),
    date: normalizedDate || cleanImportText(rawRow.report_date, 30),
    ageGroup: normalizeImportAgeGroup(rawRow.age_group) || "Unknown",
    sex: cleanImportText(rawRow.sex, 20) || "Unknown",
    facility: cleanImportText(rawRow.facility, 150),
    reportSource: cleanImportText(rawRow.report_source, 150) || "Imported report",
    notes: cleanImportText(rawRow.notes, 1000),
    errors: [],
    duplicate: false,
  };

  IMPORT_REQUIRED_FIELDS.forEach((field) => {
    if (cleanImportText(rawRow[field]) === "") row.errors.push(`${field} is required`);
  });
  if (!row.disease) row.errors.push("disease is not in the organization disease list");
  if (!Number.isFinite(row.lat) || row.lat < -90 || row.lat > 90) row.errors.push("latitude must be between -90 and 90");
  if (!Number.isFinite(row.lng) || row.lng < -180 || row.lng > 180) row.errors.push("longitude must be between -180 and 180");
  if (!Number.isInteger(row.cases) || row.cases < 1 || row.cases > 100000) row.errors.push("cases must be a whole number from 1 to 100000");
  if (!normalizedDate) {
    row.errors.push("report_date must use YYYY-MM-DD; unambiguous DD/MM/YYYY or MM/DD/YYYY is also accepted");
  }
  if (!AGE_GROUPS.includes(row.ageGroup)) row.errors.push(`age_group must be one of: ${AGE_GROUPS.join(", ")}`);
  if (!SEX_OPTIONS.includes(row.sex)) row.errors.push(`sex must be one of: ${SEX_OPTIONS.join(", ")}`);
  if (row.facility && !findCanonicalOption(row.facility, settings.facilityList || [])) {
    row.errors.push("facility is not in the organization facility list");
  } else if (row.facility) {
    row.facility = findCanonicalOption(row.facility, settings.facilityList || []);
  }

  [row.externalId, row.disease, row.location, row.facility, row.reportSource, row.notes].forEach((value) => {
    if (hasSpreadsheetFormula(value)) row.errors.push("text values cannot begin with spreadsheet formula characters");
  });
  row.errors = [...new Set(row.errors)];
  row.fingerprint = row.errors.length === 0 ? buildImportFingerprint(row) : "";
  return row;
}

// ── Routes ───────────────────────────────────────────────────────────────────
app.get("/api/auth/session", (req, res) => {
  const session = readSessionToken(req);
  if (!session) {
    return res.status(401).json({ authenticated: false });
  }
  res.json({
    authenticated: true,
    user: buildSessionUser(session),
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
      email: "",
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
      user: buildSessionUser({ ...user, exp: Date.now() + SESSION_TTL_MS }),
    });
  }
);

app.post(
  "/api/auth/user-login",
  [
    body("email").isEmail().withMessage("A valid email is required").normalizeEmail(),
    body("accessCode").notEmpty().withMessage("Access code is required").trim(),
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
      const user = await OrganizationUser.findOne({ email: req.body.email }).select("+accessCodeHash");
      if (!user || user.status !== "Active") {
        return res.status(401).json({ error: "Invalid email or access code." });
      }

      if (user.lockedUntil && user.lockedUntil > new Date()) {
        return res.status(423).json({ error: "This account is temporarily locked after repeated failed sign-in attempts. Contact an administrator or try again later." });
      }

      if (!verifyAccessCode(req.body.accessCode, user.accessCodeHash)) {
        user.failedLoginAttempts = (Number(user.failedLoginAttempts) || 0) + 1;
        if (user.failedLoginAttempts >= MAX_FAILED_LOGIN_ATTEMPTS) {
          user.lockedUntil = new Date(Date.now() + LOGIN_LOCKOUT_MS);
        }
        await user.save();

        writeAuditLog({
          action: "organization_user_login_failed",
          actor: user.fullName,
          role: user.role,
          changedFields: user.lockedUntil ? ["failedLoginAttempts", "lockedUntil"] : ["failedLoginAttempts"],
          metadata: {
            userEmail: user.email,
            failedLoginAttempts: user.failedLoginAttempts,
            lockedUntil: user.lockedUntil,
          },
        });

        return res.status(401).json({ error: "Invalid email or access code." });
      }

      const sessionUser = {
        id: String(user._id),
        name: user.fullName,
        email: user.email,
        role: user.role,
        facility: user.facility,
        jurisdiction: user.jurisdiction,
        sessionDurationHours: normalizeSessionDurationHours(user.sessionDurationHours),
      };
      const sessionDurationMs = getSessionDurationMs(sessionUser.sessionDurationHours);
      user.lastLoginAt = new Date();
      user.failedLoginAttempts = 0;
      user.lockedUntil = undefined;
      await user.save();

      writeAuditLog({
        action: "organization_user_login",
        actor: user.fullName,
        role: user.role,
        metadata: {
          userEmail: user.email,
          userRole: user.role,
          sessionDurationHours: sessionUser.sessionDurationHours,
          source: "organization_user_login",
        },
      });

      res.json({
        token: createSessionToken(sessionUser, sessionDurationMs),
        user: buildSessionUser({ ...sessionUser, exp: Date.now() + sessionDurationMs }),
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to sign in organization user" });
    }
  }
);

app.post(
  "/api/auth/reset-request",
  [
    body("email").isEmail().withMessage("A valid email is required").normalizeEmail(),
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
      const user = await OrganizationUser.findOne({ email: req.body.email });
      if (user && user.status === "Active") {
        user.resetRequestedAt = new Date();
        await user.save();

        writeAuditLog({
          action: "organization_user_reset_requested",
          actor: user.fullName,
          role: user.role,
          changedFields: ["resetRequestedAt"],
          metadata: {
            userEmail: user.email,
            userRole: user.role,
          },
        });
      }

      res.json({
        requested: true,
        message: "If this email belongs to an active organization user, an administrator will see the reset request.",
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to request access reset" });
    }
  }
);

app.post(
  "/api/auth/email-link",
  emailLoginLimiter,
  [body("email").isEmail().withMessage("A valid email is required").normalizeEmail()],
  async (req, res) => {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: "Database is not connected" });
    }
    if (!isEmailDeliveryConfigured()) {
      return res.status(503).json({ error: "Email sign-in is not configured yet." });
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const genericResponse = {
      requested: true,
      message: "If this email belongs to an active organization user, a sign-in link is on its way.",
    };

    try {
      const user = await OrganizationUser.findOne({ email: req.body.email });
      if (!user || user.status !== "Active") {
        return res.json(genericResponse);
      }

      await EmailLoginLink.deleteMany({ userId: user._id, usedAt: null });
      const token = crypto.randomBytes(32).toString("base64url");
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      const loginLink = await EmailLoginLink.create({
        userId: user._id,
        tokenHash,
        expiresAt: new Date(Date.now() + EMAIL_LOGIN_LINK_TTL_MS),
      });
      const settings = await getOrganizationSettings();
      const email = buildEmailLoginEmail({ user, settings, token });

      try {
        await sendTransactionalEmail({
          to: user.email,
          ...email,
          idempotencyKey: `email-login/${user.id}/${loginLink.createdAt.getTime()}`,
        });
      } catch (err) {
        await EmailLoginLink.deleteOne({ _id: loginLink._id });
        throw err;
      }

      writeAuditLog({
        action: "organization_user_email_link_requested",
        actor: user.fullName,
        role: user.role,
        metadata: { userEmail: user.email, expiresAt: loginLink.expiresAt },
      });
      return res.json(genericResponse);
    } catch (err) {
      console.error(err);
      return res.status(502).json({ error: "Unable to send a sign-in link right now. Please try again later." });
    }
  }
);

app.post(
  "/api/auth/email-link/exchange",
  [body("token").notEmpty().withMessage("A sign-in token is required").trim()],
  async (req, res) => {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: "Database is not connected" });
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const tokenHash = crypto.createHash("sha256").update(req.body.token).digest("hex");
      const loginLink = await EmailLoginLink.findOneAndUpdate(
        { tokenHash, usedAt: null, expiresAt: { $gt: new Date() } },
        { $set: { usedAt: new Date() } },
        { new: true }
      );
      if (!loginLink) {
        return res.status(401).json({ error: "This sign-in link is invalid, expired, or has already been used." });
      }

      const user = await OrganizationUser.findById(loginLink.userId);
      if (!user || user.status !== "Active") {
        return res.status(401).json({ error: "This organization account is no longer active." });
      }

      const sessionUser = {
        id: String(user._id),
        name: user.fullName,
        email: user.email,
        role: user.role,
        facility: user.facility,
        jurisdiction: user.jurisdiction,
        sessionDurationHours: normalizeSessionDurationHours(user.sessionDurationHours),
      };
      const sessionDurationMs = getSessionDurationMs(sessionUser.sessionDurationHours);
      user.lastLoginAt = new Date();
      user.failedLoginAttempts = 0;
      user.lockedUntil = undefined;
      await user.save();

      writeAuditLog({
        action: "organization_user_email_link_login",
        actor: user.fullName,
        role: user.role,
        metadata: {
          userEmail: user.email,
          userRole: user.role,
          sessionDurationHours: sessionUser.sessionDurationHours,
          source: "email_login_link",
        },
      });

      return res.json({
        token: createSessionToken(sessionUser, sessionDurationMs),
        user: buildSessionUser({ ...sessionUser, exp: Date.now() + sessionDurationMs }),
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Unable to complete email sign-in." });
    }
  }
);

app.get("/api/admin/imports", requireImportSession, async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: "Database is not connected" });
  }

  try {
    const batches = await CaseImportBatch.find().select("-rows").sort({ createdAt: -1 }).limit(12);
    res.json(batches);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Unable to load import batches." });
  }
});

app.post("/api/admin/imports/preview", requireImportSession, async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: "Database is not connected" });
  }

  const filename = cleanImportText(req.body.filename, 160);
  const rows = req.body.rows;
  if (!filename.toLowerCase().endsWith(".csv")) {
    return res.status(400).json({ error: "Only CSV files are supported." });
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: "The CSV file does not contain any data rows." });
  }
  if (rows.length > MAX_IMPORT_ROWS) {
    return res.status(400).json({ error: `A single import can contain at most ${MAX_IMPORT_ROWS} rows.` });
  }

  const suppliedFields = new Set(rows.flatMap((row) => Object.keys(row || {})));
  const unsupportedFields = [...suppliedFields].filter((field) => field && !IMPORT_ALLOWED_FIELDS.includes(field));
  if (unsupportedFields.length > 0) {
    return res.status(400).json({
      error: `Unsupported columns: ${unsupportedFields.join(", ")}. Use the approved CSV template; personal identifiers are not accepted.`,
    });
  }

  try {
    const settings = await getOrganizationSettings();
    const normalizedRows = rows.map((row, index) => normalizeImportRow(row || {}, index, settings));
    const candidateFingerprints = normalizedRows.filter((row) => row.fingerprint).map((row) => row.fingerprint);
    const existingCases = candidateFingerprints.length > 0
      ? await Case.find({ importFingerprint: { $in: candidateFingerprints } }).select("importFingerprint").lean()
      : [];
    const existingFingerprints = new Set(existingCases.map((item) => item.importFingerprint));
    const seenFingerprints = new Set();

    normalizedRows.forEach((row) => {
      if (!row.fingerprint) return;
      row.duplicate = existingFingerprints.has(row.fingerprint) || seenFingerprints.has(row.fingerprint);
      seenFingerprints.add(row.fingerprint);
    });

    const validRows = normalizedRows.filter((row) => row.errors.length === 0 && !row.duplicate).length;
    const invalidRows = normalizedRows.filter((row) => row.errors.length > 0).length;
    const duplicateRows = normalizedRows.filter((row) => row.duplicate).length;
    const batch = await CaseImportBatch.create({
      filename,
      uploadedBy: req.user.name || "Importer",
      uploadedByEmail: req.user.email || "",
      uploadedByRole: req.user.role || "",
      totalRows: normalizedRows.length,
      validRows,
      invalidRows,
      duplicateRows,
      rows: normalizedRows,
    });

    writeAuditLog({
      action: "case_import_staged",
      actor: req.user.name || "Importer",
      role: req.user.role || "",
      changedFields: ["importBatch"],
      metadata: { batchId: batch.id, filename, totalRows: batch.totalRows, validRows, invalidRows, duplicateRows },
    });
    res.status(201).json(batch);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Unable to stage this CSV import." });
  }
});

app.post("/api/admin/imports/:id/publish", requireImportSession, async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: "Database is not connected" });
  }
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ error: "Invalid import batch." });
  }

  const batch = await CaseImportBatch.findOneAndUpdate(
    { _id: req.params.id, status: "Staged" },
    { $set: { status: "Publishing" } },
    { new: true }
  );
  if (!batch) {
    return res.status(409).json({ error: "This import batch is no longer available for publishing." });
  }

  const publishableRows = batch.rows.filter((row) => row.errors.length === 0 && !row.duplicate && row.fingerprint);
  if (publishableRows.length === 0) {
    batch.status = "Staged";
    await batch.save();
    return res.status(400).json({ error: "This batch has no valid, non-duplicate rows to publish." });
  }

  try {
    const operations = publishableRows.map((row) => ({
      updateOne: {
        filter: { importFingerprint: row.fingerprint },
        update: {
          $setOnInsert: {
            disease: row.disease,
            location: row.location,
            lat: row.lat,
            lng: row.lng,
            enteredLocation: row.location,
            locationSource: "Imported report",
            locationVerification: "Needs location review",
            locationReviewReason: "Imported coordinates require authorized verification before confirmation.",
            cases: row.cases,
            date: row.date,
            status: "New",
            priority: "Medium",
            ageGroup: row.ageGroup,
            sex: row.sex,
            facility: row.facility,
            reportSource: row.reportSource,
            notes: row.notes,
            submittedBy: req.user.name || "Institutional importer",
            submittedByEmail: req.user.email || "",
            submittedByRole: req.user.role || "",
            submittedByFacility: req.user.facility || "",
            submittedByJurisdiction: req.user.jurisdiction || "",
            importBatchId: batch._id,
            externalRecordId: row.externalId,
            importFingerprint: row.fingerprint,
          },
        },
        upsert: true,
      },
    }));
    const result = await Case.bulkWrite(operations, { ordered: false });
    const importedRows = result.upsertedCount || 0;
    batch.status = "Imported";
    batch.importedRows = importedRows;
    batch.publishedAt = new Date();
    batch.publishedBy = req.user.name || "Importer";
    await batch.save();

    writeAuditLog({
      action: "case_import_published",
      actor: req.user.name || "Importer",
      role: req.user.role || "",
      changedFields: ["importBatch", "cases"],
      metadata: { batchId: batch.id, filename: batch.filename, requestedRows: publishableRows.length, importedRows },
    });
    res.json(batch);
  } catch (err) {
    batch.status = "Staged";
    await batch.save().catch(() => {});
    console.error(err);
    res.status(500).json({ error: "Unable to publish this import batch." });
  }
});

app.post("/api/admin/imports/:id/reject", requireImportSession, async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: "Database is not connected" });
  }
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ error: "Invalid import batch." });
  }

  try {
    const batch = await CaseImportBatch.findOneAndUpdate(
      { _id: req.params.id, status: "Staged" },
      { $set: { status: "Rejected", rejectedAt: new Date(), rejectedBy: req.user.name || "Importer" } },
      { new: true }
    );
    if (!batch) {
      return res.status(409).json({ error: "This import batch is no longer available for rejection." });
    }
    writeAuditLog({
      action: "case_import_rejected",
      actor: req.user.name || "Importer",
      role: req.user.role || "",
      changedFields: ["importBatch"],
      metadata: { batchId: batch.id, filename: batch.filename, totalRows: batch.totalRows },
    });
    res.json(batch);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Unable to reject this import batch." });
  }
});

app.get("/api/admin/recovery/status", requireAdminSession, async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: "Database is not connected" });
  }

  try {
    const [readiness, backupHistory, restoreHistory] = await Promise.all([
      getRecoveryReadiness(),
      BackupVerification.find().sort({ completedAt: -1 }).limit(8).lean(),
      RestoreTest.find().sort({ testedAt: -1 }).limit(8).lean(),
    ]);
    res.json({
      backupCurrent: readiness.backupCurrent,
      restoreTestCurrent: readiness.restoreTestCurrent,
      retentionDisposalAllowed: readiness.retentionDisposalAllowed,
      backupMaxAgeDays: readiness.backupMaxAgeDays,
      restoreTestMaxAgeDays: readiness.restoreTestMaxAgeDays,
      latestBackup: serializeBackupVerification(readiness.latestBackup),
      latestRestoreTest: serializeRestoreTest(readiness.latestRestoreTest),
      backupHistory: backupHistory.map(serializeBackupVerification),
      restoreHistory: restoreHistory.map(serializeRestoreTest),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Unable to load backup and recovery status." });
  }
});

app.post(
  "/api/admin/recovery/backups",
  requireAdminSession,
  [
    body("provider").trim().notEmpty().isLength({ max: 100 }).withMessage("Backup provider is required."),
    body("reference").trim().notEmpty().isLength({ max: 200 }).withMessage("Backup reference is required."),
    body("completedAt").isISO8601().withMessage("Backup completion time must be valid."),
    body("status").isIn(["Verified", "Failed"]).withMessage("Backup status is invalid."),
    body("notes").optional().trim().isLength({ max: 1000 }).withMessage("Backup notes are too long."),
  ],
  async (req, res) => {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: "Database is not connected" });
    }
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const completedAt = new Date(req.body.completedAt);
    if (completedAt > new Date(Date.now() + 5 * 60 * 1000)) {
      return res.status(400).json({ error: "Backup completion time cannot be in the future." });
    }

    try {
      const verification = await BackupVerification.create({
        provider: req.body.provider,
        reference: req.body.reference,
        completedAt,
        status: req.body.status,
        notes: req.body.notes || "",
        verifiedBy: req.user.name || "Administrator",
        verifiedByRole: req.user.role || "Administrator",
      });
      writeAuditLog({
        action: "backup_verification_recorded",
        actor: req.user.name || "Administrator",
        role: req.user.role || "Administrator",
        changedFields: ["backupVerification"],
        metadata: {
          backupVerificationId: verification.id,
          provider: verification.provider,
          completedAt: verification.completedAt,
          status: verification.status,
        },
      });
      res.status(201).json(serializeBackupVerification(verification));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Unable to record backup evidence." });
    }
  }
);

app.post(
  "/api/admin/recovery/restore-tests",
  requireAdminSession,
  [
    body("backupVerificationId").isMongoId().withMessage("Choose a valid backup verification."),
    body("outcome").isIn(["Passed", "Failed"]).withMessage("Restore test outcome is invalid."),
    body("testedAt").isISO8601().withMessage("Restore test time must be valid."),
    body("notes").trim().notEmpty().isLength({ max: 1000 }).withMessage("Document the restore test procedure and result."),
  ],
  async (req, res) => {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: "Database is not connected" });
    }
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const testedAt = new Date(req.body.testedAt);
    if (testedAt > new Date(Date.now() + 5 * 60 * 1000)) {
      return res.status(400).json({ error: "Restore test time cannot be in the future." });
    }

    try {
      const backup = await BackupVerification.findById(req.body.backupVerificationId);
      if (!backup || backup.status !== "Verified") {
        return res.status(400).json({ error: "Restore tests must reference verified backup evidence." });
      }
      const restoreTest = await RestoreTest.create({
        backupVerificationId: backup._id,
        outcome: req.body.outcome,
        testedAt,
        notes: req.body.notes,
        testedBy: req.user.name || "Administrator",
        testedByRole: req.user.role || "Administrator",
      });
      writeAuditLog({
        action: "restore_test_recorded",
        actor: req.user.name || "Administrator",
        role: req.user.role || "Administrator",
        changedFields: ["restoreTest"],
        metadata: {
          restoreTestId: restoreTest.id,
          backupVerificationId: backup.id,
          testedAt: restoreTest.testedAt,
          outcome: restoreTest.outcome,
        },
      });
      res.status(201).json(serializeRestoreTest(restoreTest));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Unable to record the restore test." });
    }
  }
);

app.get("/api/admin/retention/runs", requireAdminSession, async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: "Database is not connected" });
  }

  try {
    await RetentionRun.updateMany(
      { status: "Previewed", expiresAt: { $lte: new Date() } },
      { $set: { status: "Expired" } }
    );
    const runs = await RetentionRun.find().sort({ createdAt: -1 }).limit(10);
    res.json(runs.map(serializeRetentionRun));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Unable to load retention history." });
  }
});

app.post("/api/admin/retention/preview", requireAdminSession, async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: "Database is not connected" });
  }

  try {
    const settings = await getOrganizationSettings();
    const policyDays = Number(settings.retentionDays) || DEFAULT_ORGANIZATION_SETTINGS.retentionDays;
    const cutoffDate = new Date(Date.now() - policyDays * 24 * 60 * 60 * 1000);
    const filter = buildRetentionFilter(cutoffDate);
    const [eligibleCount, targets] = await Promise.all([
      Case.countDocuments(filter),
      Case.find(filter)
        .select("disease location status date updatedAt")
        .sort({ updatedAt: 1 })
        .limit(RETENTION_BATCH_LIMIT)
        .lean(),
    ]);
    const statusBreakdown = targets.reduce((summary, item) => {
      summary[item.status] = (summary[item.status] || 0) + 1;
      return summary;
    }, {});
    const expiresAt = new Date(Date.now() + RETENTION_PREVIEW_TTL_MS);
    const run = await RetentionRun.create({
      policyDays,
      cutoffDate,
      eligibleCount,
      plannedCount: targets.length,
      statusBreakdown,
      targetCaseIds: targets.map((item) => item._id),
      targetHashes: targets.map((item) => buildRetentionCaseHash(item._id)),
      previewedBy: req.user.name || "Administrator",
      previewedByRole: req.user.role || "Administrator",
      expiresAt,
    });

    writeAuditLog({
      action: "retention_preview_created",
      actor: req.user.name || "Administrator",
      role: req.user.role || "Administrator",
      changedFields: ["retentionPreview"],
      metadata: {
        retentionRunId: run.id,
        policyDays,
        cutoffDate,
        eligibleCount,
        plannedCount: targets.length,
      },
    });

    const recoveryReadiness = await getRecoveryReadiness();
    res.status(201).json({
      ...serializeRetentionRun(run),
      sample: targets.slice(0, 10).map((item) => ({
        _id: item._id,
        disease: item.disease,
        location: item.location,
        status: item.status,
        reportDate: item.date,
        lastUpdated: item.updatedAt,
      })),
      confirmationText: `DELETE ${targets.length} RECORDS`,
      recoveryReadiness: {
        backupCurrent: recoveryReadiness.backupCurrent,
        restoreTestCurrent: recoveryReadiness.restoreTestCurrent,
        retentionDisposalAllowed: recoveryReadiness.retentionDisposalAllowed,
        backupMaxAgeDays: recoveryReadiness.backupMaxAgeDays,
        restoreTestMaxAgeDays: recoveryReadiness.restoreTestMaxAgeDays,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Unable to create a retention preview." });
  }
});

app.post("/api/admin/retention/:id/execute", requireAdminSession, async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: "Database is not connected" });
  }
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ error: "Invalid retention preview." });
  }

  let run;
  try {
    run = await RetentionRun.findById(req.params.id);
    if (!run || run.status !== "Previewed") {
      return res.status(409).json({ error: "This retention preview is no longer available." });
    }
    if (run.expiresAt <= new Date()) {
      run.status = "Expired";
      await run.save();
      return res.status(409).json({ error: "This retention preview expired. Create a fresh preview." });
    }
    if (run.plannedCount === 0) {
      return res.status(400).json({ error: "There are no eligible records to dispose." });
    }

    const recoveryReadiness = await getRecoveryReadiness();
    if (!recoveryReadiness.retentionDisposalAllowed) {
      return res.status(409).json({
        error: `Retention disposal requires a verified backup from the last ${BACKUP_MAX_AGE_DAYS} days and a passed restore test from the last ${RESTORE_TEST_MAX_AGE_DAYS} days.`,
      });
    }

    const expectedConfirmation = `DELETE ${run.plannedCount} RECORDS`;
    if (cleanImportText(req.body.confirmation, 80) !== expectedConfirmation) {
      return res.status(400).json({ error: `Type ${expectedConfirmation} to confirm this disposal.` });
    }

    const claimedRun = await RetentionRun.findOneAndUpdate(
      { _id: run._id, status: "Previewed", expiresAt: { $gt: new Date() } },
      { $set: { status: "Executing" } },
      { new: true }
    );
    if (!claimedRun) {
      return res.status(409).json({ error: "This retention preview is already being processed." });
    }
    run = claimedRun;

    const result = await Case.deleteMany(buildRetentionFilter(run.cutoffDate, run.targetCaseIds));
    run.status = "Executed";
    run.deletedCount = result.deletedCount || 0;
    run.executedAt = new Date();
    run.executedBy = req.user.name || "Administrator";
    await run.save();

    writeAuditLog({
      action: "retention_disposal_executed",
      actor: req.user.name || "Administrator",
      role: req.user.role || "Administrator",
      changedFields: ["retentionDisposal", "cases"],
      metadata: {
        retentionRunId: run.id,
        policyDays: run.policyDays,
        cutoffDate: run.cutoffDate,
        plannedCount: run.plannedCount,
        deletedCount: run.deletedCount,
        targetHashes: run.targetHashes,
      },
    });

    res.json(serializeRetentionRun(run));
  } catch (err) {
    if (run?.status === "Executing") {
      run.status = "Previewed";
      await run.save().catch(() => {});
    }
    console.error(err);
    res.status(500).json({ error: "Unable to execute this retention disposal." });
  }
});

app.get("/api/admin/audit-logs", requireAdminSession, async (req, res) => {
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

app.post(
  "/api/admin/export-events",
  requireAdminSession,
  [
    body("exportType").isIn(["csv", "pdf"]).withMessage("Invalid export type"),
    body("recordCount").isInt({ min: 0, max: 1000000 }).withMessage("Record count must be a valid number"),
    body("totalCases").isInt({ min: 0, max: 100000000 }).withMessage("Total cases must be a valid number"),
    body("filters").optional().isObject().withMessage("Filters must be an object"),
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
      const exportType = req.body.exportType;
      await writeAuditLog({
        action: exportType === "csv" ? "case_csv_exported" : "case_pdf_printed",
        actor: req.user.name || "Administrator",
        role: req.user.role || "Administrator",
        changedFields: [exportType === "csv" ? "csv_export" : "pdf_print"],
        metadata: {
          recordCount: Number(req.body.recordCount) || 0,
          totalCases: Number(req.body.totalCases) || 0,
          filters: req.body.filters || {},
        },
      });
      res.json({ recorded: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to record export event" });
    }
  }
);

app.get("/api/admin/users", requireAdminSession, async (req, res) => {
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
  requireAdminSession,
  [
    body("fullName").notEmpty().withMessage("Full name is required").trim().escape(),
    body("email").isEmail().withMessage("A valid email is required").normalizeEmail(),
    body("accessCode").isLength({ min: 6, max: 80 }).withMessage("Access code must be at least 6 characters").trim(),
    body("role").isIn(USER_ROLES).withMessage("Invalid role"),
    body("sessionDurationHours")
      .optional({ checkFalsy: true })
      .isFloat({ min: MIN_SESSION_DURATION_HOURS, max: MAX_SESSION_DURATION_HOURS })
      .withMessage(`Session duration must be between ${MIN_SESSION_DURATION_HOURS} and ${MAX_SESSION_DURATION_HOURS} hours`),
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
        sessionDurationHours: Number(req.body.sessionDurationHours) || DEFAULT_SESSION_DURATION_HOURS,
        accessCodeHash: hashAccessCode(req.body.accessCode),
        accessCodeUpdatedAt: new Date(),
        notes: req.body.notes || "",
      });

      writeAuditLog({
        action: "organization_user_created",
        actor: req.user.name || "Admin",
        role: req.user.role || "Admin",
        changedFields: ["fullName", "email", "role", "facility", "jurisdiction", "sessionDurationHours"],
        metadata: {
          userEmail: user.email,
          userRole: user.role,
          userStatus: user.status,
          sessionDurationHours: user.sessionDurationHours,
          credential: "access_code_created",
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
  requireAdminSession,
  [
    body("status").optional().isIn(["Active", "Inactive"]).withMessage("Invalid user status"),
    body("accessCode").optional({ checkFalsy: true }).isLength({ min: 6, max: 80 }).withMessage("Access code must be at least 6 characters").trim(),
    body("sessionDurationHours")
      .optional()
      .isFloat({ min: MIN_SESSION_DURATION_HOURS, max: MAX_SESSION_DURATION_HOURS })
      .withMessage(`Session duration must be between ${MIN_SESSION_DURATION_HOURS} and ${MAX_SESSION_DURATION_HOURS} hours`),
    body("unlock").optional().isBoolean().withMessage("Unlock must be true or false"),
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
      const user = await OrganizationUser.findById(req.params.id).select("+accessCodeHash");
      if (!user) {
        return res.status(404).json({ error: "Organization user not found" });
      }

      const changedFields = [];
      if (req.body.status && user.status !== req.body.status) {
        changedFields.push("status");
        user.status = req.body.status;
      }
      if (req.body.accessCode) {
        changedFields.push("accessCode");
        user.accessCodeHash = hashAccessCode(req.body.accessCode);
        user.accessCodeUpdatedAt = new Date();
        user.resetRequestedAt = undefined;
        user.failedLoginAttempts = 0;
        user.lockedUntil = undefined;
      }
      if (req.body.sessionDurationHours !== undefined) {
        const nextDuration = Number(req.body.sessionDurationHours);
        if (user.sessionDurationHours !== nextDuration) {
          changedFields.push("sessionDurationHours");
          user.sessionDurationHours = nextDuration;
        }
      }
      if (req.body.unlock === true && (user.lockedUntil || user.failedLoginAttempts > 0)) {
        changedFields.push("accountUnlock");
        user.failedLoginAttempts = 0;
        user.lockedUntil = undefined;
      }
      if (!user.accessCodeHash) {
        return res.status(400).json({ error: "Set an access code for this user before changing access status." });
      }
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
            sessionDurationHours: updatedUser.sessionDurationHours,
            failedLoginAttempts: updatedUser.failedLoginAttempts,
            lockedUntil: updatedUser.lockedUntil,
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

app.post("/api/admin/users/:id/invite", requireAdminSession, async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: "Database is not connected" });
  }

  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ error: "Invalid user id" });
  }

  try {
    const user = await OrganizationUser.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ error: "Organization user not found" });
    }

    const settings = await getOrganizationSettings();
    const email = buildStaffEmail({ user, settings, kind: "invite" });
    const delivery = req.body.delivery === "manual"
      ? { status: "manual", provider: null }
      : await sendTransactionalEmail({
        to: user.email,
        ...email,
        idempotencyKey: `staff-invite/${user.id}/${user.updatedAt.getTime()}`,
      });
    user.invitedAt = new Date();
    user.inviteDeliveryMethod = delivery.status === "sent" ? "email" : "manual";
    const updatedUser = await user.save();

    writeAuditLog({
      action: delivery.status === "sent" ? "organization_user_invite_sent" : "organization_user_invite_prepared",
      actor: req.user.name || "Admin",
      role: req.user.role || "Admin",
      changedFields: ["invitedAt", "inviteDeliveryMethod"],
      metadata: {
        userEmail: updatedUser.email,
        userRole: updatedUser.role,
        userStatus: updatedUser.status,
        deliveryMethod: updatedUser.inviteDeliveryMethod,
        provider: delivery.provider || "manual",
      },
    });

    res.json({
      ...updatedUser.toObject(),
      notification: { status: delivery.status, provider: delivery.provider },
    });
  } catch (err) {
    console.error(err);
    if (err.code === "EMAIL_DELIVERY_FAILED") {
      return res.status(502).json({ error: "Email delivery failed. A manual invite can still be copied.", manualFallbackAllowed: true });
    }
    res.status(500).json({ error: "Failed to prepare user invite" });
  }
});

app.post("/api/admin/users/:id/reset-handoff", requireAdminSession, async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: "Database is not connected" });
  }

  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ error: "Invalid user id" });
  }

  try {
    const user = await OrganizationUser.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ error: "Organization user not found" });
    }

    const settings = await getOrganizationSettings();
    const email = buildStaffEmail({ user, settings, kind: "reset" });
    const delivery = req.body.delivery === "manual"
      ? { status: "manual", provider: null }
      : await sendTransactionalEmail({
        to: user.email,
        ...email,
        idempotencyKey: `staff-reset/${user.id}/${user.accessCodeUpdatedAt?.getTime() || user.updatedAt.getTime()}`,
      });
    user.resetHandoffAt = new Date();
    user.resetHandoffDeliveryMethod = delivery.status === "sent" ? "email" : "manual";
    const updatedUser = await user.save();

    writeAuditLog({
      action: delivery.status === "sent" ? "organization_user_reset_notice_sent" : "organization_user_reset_handoff_prepared",
      actor: req.user.name || "Admin",
      role: req.user.role || "Admin",
      changedFields: ["resetHandoffAt", "resetHandoffDeliveryMethod"],
      metadata: {
        userEmail: updatedUser.email,
        userRole: updatedUser.role,
        userStatus: updatedUser.status,
        deliveryMethod: updatedUser.resetHandoffDeliveryMethod,
        provider: delivery.provider || "manual",
      },
    });

    res.json({
      ...updatedUser.toObject(),
      notification: { status: delivery.status, provider: delivery.provider },
    });
  } catch (err) {
    console.error(err);
    if (err.code === "EMAIL_DELIVERY_FAILED") {
      return res.status(502).json({ error: "Email delivery failed. A manual reset notice can still be copied.", manualFallbackAllowed: true });
    }
    res.status(500).json({ error: "Failed to prepare reset handoff" });
  }
});

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
      retentionDays: settings.retentionDays,
      lowPriorityMaxCases: settings.lowPriorityMaxCases,
      mediumPriorityMaxCases: settings.mediumPriorityMaxCases,
      diseaseList: settings.diseaseList,
      facilityList: settings.facilityList,
      reportSourceList: settings.reportSourceList,
      emailDeliveryConfigured: isEmailDeliveryConfigured(),
      emailProvider: isEmailDeliveryConfigured() ? "Resend" : "Manual copy",
      passwordlessSignInConfigured: isEmailDeliveryConfigured(),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch organization settings" });
  }
});

app.get("/api/admin/settings", requireAdminSession, async (req, res) => {
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
  requireAdminSession,
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
    res.json(cases.map(serializePublicCase));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch cases" });
  }
});

app.get("/api/registry-cases", requireSignedInSession, async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: "Database is not connected" });
  }

  try {
    const cases = await Case.find().sort({ createdAt: -1 });
    res.json(cases);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch case registry" });
  }
});

app.post(
  "/api/cases",
  requireReporterSession,
  [
    body("disease").notEmpty().withMessage("Disease is required").trim().escape(),
    body("location").notEmpty().withMessage("Location is required").trim().escape(),
    body("latitude").isFloat({ min: -90, max: 90 }).withMessage("Invalid latitude"),
    body("longitude").isFloat({ min: -180, max: 180 }).withMessage("Invalid longitude"),
    body("locationSource").optional().isIn(LOCATION_SOURCES).withMessage("Invalid location source"),
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
      const locationSource = LOCATION_SOURCES.includes(req.body.locationSource) ? req.body.locationSource : "GPS captured";
      const needsLocationReview =
        locationSource === "GPS captured" &&
        req.user.role === "Field Reporter" &&
        !locationMatchesJurisdiction(location, req.user.jurisdiction);
      const locationVerification = needsLocationReview ? "Needs location review" : "GPS verified";
      const locationReviewReason = needsLocationReview
        ? "Reported place does not match the reporter's assigned jurisdiction. Reviewer should verify the plotted location."
        : "";
      const newCase = await Case.create({
        disease,
        lat: Number(latitude),
        lng: Number(longitude),
        location,
        enteredLocation: location,
        capturedLat: Number(latitude),
        capturedLng: Number(longitude),
        locationSource,
        locationVerification,
        locationReviewReason,
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
        submittedBy: req.user.name || "Unknown reporter",
        submittedByEmail: req.user.email || "",
        submittedByRole: req.user.role || "",
        submittedByFacility: req.user.facility || "",
        submittedByJurisdiction: req.user.jurisdiction || "",
      });
      writeAuditLog({
        action: "case_created",
        actor: req.user.name || "Reporter",
        role: req.user.role || "Reporter",
        caseId: newCase._id,
        caseDisease: newCase.disease,
        caseLocation: newCase.location,
        changedFields: ["created"],
        metadata: {
          cases: newCase.cases,
          reportDate: newCase.date,
          reporterEmail: req.user.email || "",
          reporterFacility: req.user.facility || "",
          reporterJurisdiction: req.user.jurisdiction || "",
          locationSource: newCase.locationSource,
          locationVerification: newCase.locationVerification,
        },
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
    body("location").optional().notEmpty().withMessage("Location cannot be empty").trim().escape(),
    body("latitude").optional({ checkFalsy: true }).isFloat({ min: -90, max: 90 }).withMessage("Invalid latitude"),
    body("longitude").optional({ checkFalsy: true }).isFloat({ min: -180, max: 180 }).withMessage("Invalid longitude"),
    body("locationSource").optional().isIn(LOCATION_SOURCES).withMessage("Invalid location source"),
    body("locationVerification").optional().isIn(LOCATION_VERIFICATIONS).withMessage("Invalid location verification"),
    body("locationReviewReason").optional().trim().isLength({ max: 500 }).withMessage("Location review note must be 500 characters or fewer").escape(),
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
      "location",
      "lat",
      "lng",
      "locationSource",
      "locationVerification",
      "locationReviewReason",
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

      if (Object.prototype.hasOwnProperty.call(req.body, "latitude") && req.body.latitude !== "") {
        req.body.lat = Number(req.body.latitude);
      }
      if (Object.prototype.hasOwnProperty.call(req.body, "longitude") && req.body.longitude !== "") {
        req.body.lng = Number(req.body.longitude);
      }
      if (req.body.locationSource === "Admin corrected" && !req.body.locationVerification) {
        req.body.locationVerification = "Admin corrected";
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
          location: caseRecord.location,
          lat: caseRecord.lat,
          lng: caseRecord.lng,
          locationSource: caseRecord.locationSource,
          locationVerification: caseRecord.locationVerification,
          locationReviewReason: caseRecord.locationReviewReason,
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
            locationSource: caseRecord.locationSource,
            locationVerification: caseRecord.locationVerification,
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

app.delete("/api/cases/:id", requireDeleteSession, async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: "Database is not connected" });
  }

  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ error: "Invalid case id" });
  }

  try {
    const caseRecord = await Case.findById(req.params.id);
    if (!caseRecord) {
      return res.status(404).json({ error: "Case not found" });
    }

    await Case.deleteOne({ _id: caseRecord._id });
    writeAuditLog({
      action: "case_deleted",
      actor: req.user.name || "Administrator",
      role: req.user.role || "Administrator",
      caseId: caseRecord._id,
      caseDisease: caseRecord.disease,
      caseLocation: caseRecord.location,
      changedFields: ["deleted"],
      metadata: {
        cases: caseRecord.cases,
        reportDate: caseRecord.date,
        status: caseRecord.status,
        priority: caseRecord.priority,
      },
    });

    res.json({ deleted: true, id: String(caseRecord._id) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete case" });
  }
});

// ── Health check ─────────────────────────────────────────────────────────────
app.get("/api/ping", (req, res) => res.json({ status: "ok" }));

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
