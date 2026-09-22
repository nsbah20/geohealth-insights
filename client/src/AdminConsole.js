import React, { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  LinearProgress,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import AdminPanelSettingsIcon from "@mui/icons-material/AdminPanelSettings";
import CloudDoneIcon from "@mui/icons-material/CloudDone";
import FactCheckIcon from "@mui/icons-material/FactCheck";
import ManageAccountsIcon from "@mui/icons-material/ManageAccounts";
import RuleIcon from "@mui/icons-material/Rule";
import SecurityIcon from "@mui/icons-material/Security";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import LoginIcon from "@mui/icons-material/Login";
import LogoutIcon from "@mui/icons-material/Logout";
import EmailOutlinedIcon from "@mui/icons-material/EmailOutlined";
import DriveFolderUploadIcon from "@mui/icons-material/DriveFolderUpload";
import DeleteSweepIcon from "@mui/icons-material/DeleteSweep";
import BackupIcon from "@mui/icons-material/Backup";
import MonitorHeartIcon from "@mui/icons-material/MonitorHeart";
import {
  authHeaders,
  clearAdminToken,
  formatSessionExpiry,
  formatSessionTimeRemaining,
  getAdminToken,
  isSessionExpiringSoon,
  isSessionExpired,
  setAdminToken,
} from "./auth";
import OrganizationSettingsPanel from "./OrganizationSettingsPanel";
import { useOrganizationSettings } from "./OrganizationSettingsContext";
import AdminUsersPanel from "./AdminUsersPanel";
import CaseImportPanel from "./CaseImportPanel";
import RetentionEnforcementPanel from "./RetentionEnforcementPanel";
import BackupRecoveryPanel from "./BackupRecoveryPanel";
import OperationalStatusPanel from "./OperationalStatusPanel";
import surveillanceOperationsBackground from "./assets/surveillance-operations-background.webp";

const API_URL = process.env.REACT_APP_API_URL || "http://localhost:5000";

const rolePlan = [
  {
    role: "System Administrator",
    access: "Manage users, facilities, disease lists, audit settings, and deployment configuration.",
    status: "Directory ready",
  },
  {
    role: "Epidemiology Reviewer",
    access: "Review submitted cases, confirm signals, update priority, and document follow-up actions.",
    status: "Directory ready",
  },
  {
    role: "Field Reporter",
    access: "Submit new case reports and update assigned field follow-up details.",
    status: "Directory ready",
  },
  {
    role: "Institution Viewer",
    access: "View dashboards, trends, and exports for approved facilities or jurisdictions.",
    status: "Directory ready",
  },
  {
    role: "Data Manager",
    access: "Stage and publish validated institutional case imports and support data-quality review.",
    status: "Import ready",
  },
];

const baseReadinessItems = [
  { label: "Live database connection", state: "Active", tone: "success" },
  { label: "Case review workflow", state: "Active", tone: "success" },
  { label: "Review history trail", state: "Active", tone: "success" },
  { label: "Audit activity log", state: "Active", tone: "success" },
  { label: "CSV/PDF reporting", state: "Active", tone: "success" },
  { label: "Admin access gate", state: "Active", tone: "success" },
  { label: "Organization settings", state: "Active", tone: "success" },
  { label: "User and role directory", state: "Active", tone: "success" },
  { label: "Invite handoff tracking", state: "Active", tone: "success" },
  { label: "Access reset requests", state: "Active", tone: "success" },
  { label: "Reset handoff tracking", state: "Active", tone: "success" },
  { label: "Privacy and retention summary", state: "Active", tone: "success" },
  { label: "Retention enforcement and disposal evidence", state: "Active", tone: "success" },
  { label: "Backup and recovery evidence", state: "Active", tone: "success" },
  { label: "Operational readiness monitoring", state: "Active", tone: "success" },
  { label: "Transactional email delivery", state: "Needs setup", tone: "warning" },
  { label: "Passwordless email sign-in", state: "Needs setup", tone: "warning" },
  { label: "Controlled CSV import staging", state: "Active", tone: "success" },
];

const governanceItems = [
  "Define who can submit, review, approve, export, and administer records.",
  "Require authenticated users before real institutional health data is entered.",
  "Expand audit logs to include exports and administrative setting changes.",
  "Keep privacy notices and retention rules visible before any production rollout.",
];

const publicDataBoundaries = [
  "Disease name",
  "Approximate location",
  "Reported case count",
  "Report date",
  "Status and priority summary",
];

const protectedDataBoundaries = [
  "Exact coordinates",
  "Facility and reporter identity",
  "Age, sex, onset, and exposure details",
  "Clinical notes and review history",
  "CSV and PDF exports",
];

function formatDateTime(value) {
  if (!value) return "Unknown";
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatRetentionDays(days) {
  const value = Number(days) || 365;
  return `${value.toLocaleString()} days`;
}

function formatAction(action) {
  if (action === "admin_login") return "Admin sign-in";
  if (action === "organization_user_login") return "Organization user sign-in";
  if (action === "organization_user_login_failed") return "Organization user sign-in failed";
  if (action === "organization_user_email_link_requested") return "Email sign-in link requested";
  if (action === "organization_user_email_link_login") return "Email link sign-in";
  if (action === "case_created") return "Case submitted";
  if (action === "case_review_updated") return "Case review updated";
  if (action === "case_deleted") return "Case deleted";
  if (action === "case_csv_exported") return "CSV exported";
  if (action === "case_pdf_printed") return "PDF report printed";
  if (action === "case_import_staged") return "Case import staged";
  if (action === "case_import_published") return "Case import published";
  if (action === "case_import_rejected") return "Case import rejected";
  if (action === "retention_preview_created") return "Retention preview created";
  if (action === "retention_disposal_executed") return "Retention disposal executed";
  if (action === "backup_verification_recorded") return "Backup verification recorded";
  if (action === "restore_test_recorded") return "Restore test recorded";
  if (action === "organization_settings_updated") return "Organization settings updated";
  if (action === "organization_user_created") return "Organization user created";
  if (action === "organization_user_updated") return "Organization user updated";
  if (action === "organization_user_invite_prepared") return "User invite prepared";
  if (action === "organization_user_invite_sent") return "User invite emailed";
  if (action === "organization_user_reset_requested") return "Access reset requested";
  if (action === "organization_user_reset_handoff_prepared") return "Reset handoff prepared";
  if (action === "organization_user_reset_notice_sent") return "Reset notice emailed";
  return String(action || "Activity").replace(/_/g, " ");
}

function StatusPill({ label, color = "default" }) {
  return <Chip label={label} color={color} size="small" sx={{ fontWeight: 900 }} />;
}

function AdminMetric({ icon, label, value, helper, color }) {
  return (
    <Card
      elevation={0}
      sx={{
        borderRadius: 2,
        border: "1px solid rgba(15, 23, 42, 0.08)",
        boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)",
      }}
    >
      <CardContent sx={{ display: "flex", alignItems: "center", gap: 2, minHeight: 116 }}>
        <Box
          sx={{
            width: 48,
            height: 48,
            borderRadius: 2,
            display: "grid",
            placeItems: "center",
            bgcolor: color,
            color: "white",
            flexShrink: 0,
          }}
        >
          {icon}
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="caption" color="text.secondary" fontWeight={900} textTransform="uppercase">
            {label}
          </Typography>
          <Typography variant="h4" fontWeight={900} color="#102a2c" sx={{ lineHeight: 1 }}>
            {value}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {helper}
          </Typography>
        </Box>
      </CardContent>
    </Card>
  );
}

function AdminPanel({ title, icon, children }) {
  return (
    <Card
      elevation={0}
      sx={{
        height: "100%",
        borderRadius: 2,
        border: "1px solid rgba(15, 23, 42, 0.08)",
        boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)",
      }}
    >
      <CardContent sx={{ p: 2.5 }}>
        <Stack direction="row" alignItems="center" spacing={1.2} sx={{ mb: 2 }}>
          <Box
            sx={{
              width: 36,
              height: 36,
              borderRadius: 2,
              display: "grid",
              placeItems: "center",
              bgcolor: "#e0f2f1",
              color: "#0f766e",
              flexShrink: 0,
            }}
          >
            {icon}
          </Box>
          <Typography variant="h6" fontWeight={900} color="#102a2c">
            {title}
          </Typography>
        </Stack>
        {children}
      </CardContent>
    </Card>
  );
}

export default function AdminConsole() {
  const { settings: organizationSettings, refreshSettings } = useOrganizationSettings();
  const [apiHealth, setApiHealth] = useState({ status: "Checking", color: "warning" });
  const [caseCount, setCaseCount] = useState(null);
  const [loginMode, setLoginMode] = useState("admin");
  const [userEmail, setUserEmail] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const [authUser, setAuthUser] = useState(null);
  const [authMessage, setAuthMessage] = useState(null);
  const [signingIn, setSigningIn] = useState(false);
  const [requestingReset, setRequestingReset] = useState(false);
  const [exchangingEmailLink, setExchangingEmailLink] = useState(false);
  const [auditLogs, setAuditLogs] = useState([]);
  const [auditError, setAuditError] = useState(null);
  const [sessionTick, setSessionTick] = useState(0);

  useEffect(() => {
    let active = true;

    Promise.all([
      axios.get(`${API_URL}/api/health/ready`),
      axios.get(`${API_URL}/api/health-data`),
    ])
      .then(([, casesResponse]) => {
        if (!active) return;
        setApiHealth({ status: "Online", color: "success" });
        setCaseCount(casesResponse.data.length);
      })
      .catch(() => {
        if (!active) return;
        setApiHealth({ status: "Needs attention", color: "error" });
        setCaseCount(null);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const token = getAdminToken();
    if (!token) return;

    axios
      .get(`${API_URL}/api/auth/session`, { headers: authHeaders(token) })
      .then((res) => setAuthUser(res.data.user))
      .catch(() => {
        clearAdminToken();
        setAuthUser(null);
      });
  }, []);

  useEffect(() => {
    const queryParams = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const loginToken = hashParams.get("login_token") || queryParams.get("login_token");
    if (!loginToken) return;

    queryParams.delete("login_token");
    hashParams.delete("login_token");
    const cleanQuery = queryParams.toString();
    const cleanHash = hashParams.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${cleanQuery ? `?${cleanQuery}` : ""}${cleanHash ? `#${cleanHash}` : ""}`);
    setExchangingEmailLink(true);
    setAuthMessage({ type: "info", text: "Verifying your one-time sign-in link..." });

    axios
      .post(`${API_URL}/api/auth/email-link/exchange`, { token: loginToken })
      .then((res) => {
        setAdminToken(res.data.token);
        setAuthUser(res.data.user);
        setAuthMessage({ type: "success", text: `${res.data.user.role} session active for ${res.data.user.name}.` });
      })
      .catch((err) => {
        const text = err.response?.data?.error || "Unable to use this sign-in link.";
        setAuthMessage({ type: "error", text });
      })
      .finally(() => setExchangingEmailLink(false));
  }, []);

  const fetchAuditLogs = useCallback(async (token = getAdminToken()) => {
    if (!token) {
      setAuditLogs([]);
      return;
    }

    try {
      const res = await axios.get(`${API_URL}/api/admin/audit-logs`, { headers: authHeaders(token) });
      setAuditLogs(res.data);
      setAuditError(null);
    } catch (err) {
      setAuditLogs([]);
      setAuditError(err.response?.data?.error || "Unable to load audit logs.");
      if (err.response?.status === 401) {
        clearAdminToken();
        setAuthUser(null);
      }
    }
  }, []);

  useEffect(() => {
    if (authUser?.canAdmin) fetchAuditLogs();
    else setAuditLogs([]);
  }, [authUser, fetchAuditLogs]);

  const handleLogin = async (event) => {
    event.preventDefault();
    setSigningIn(true);
    setAuthMessage(null);

    try {
      if (loginMode === "email") {
        const res = await axios.post(`${API_URL}/api/auth/email-link`, { email: userEmail });
        setAuthMessage({ type: "success", text: res.data.message });
        return;
      }
      const endpoint = loginMode === "user" ? "/api/auth/user-login" : "/api/auth/login";
      const payload = loginMode === "user" ? { email: userEmail, accessCode } : { accessCode };
      const res = await axios.post(`${API_URL}${endpoint}`, payload);
      setAdminToken(res.data.token);
      setAuthUser(res.data.user);
      setAccessCode("");
      setUserEmail("");
      setAuthMessage({ type: "success", text: `${res.data.user.role} session active for ${res.data.user.name}.` });
      if (res.data.user.canAdmin) fetchAuditLogs(res.data.token);
    } catch (err) {
      const text = err.response?.data?.errors?.[0]?.msg || err.response?.data?.error || "Unable to sign in.";
      setAuthMessage({ type: "error", text });
    } finally {
      setSigningIn(false);
    }
  };

  const handleResetRequest = async () => {
    if (!userEmail.trim()) {
      setAuthMessage({ type: "warning", text: "Enter your organization email before requesting an access reset." });
      return;
    }

    setRequestingReset(true);
    setAuthMessage(null);

    try {
      const res = await axios.post(`${API_URL}/api/auth/reset-request`, { email: userEmail });
      setAuthMessage({ type: "info", text: res.data.message || "Your reset request was sent to an administrator." });
    } catch (err) {
      const text = err.response?.data?.errors?.[0]?.msg || err.response?.data?.error || "Unable to request an access reset.";
      setAuthMessage({ type: "error", text });
    } finally {
      setRequestingReset(false);
    }
  };

  const handleLogout = () => {
    clearAdminToken();
    setAuthUser(null);
    setAuthMessage({ type: "info", text: "Admin session ended." });
  };

  useEffect(() => {
    if (!authUser) return undefined;

    const checkSession = () => {
      if (!isSessionExpired(authUser)) return;
      clearAdminToken();
      setAuthUser(null);
      setAuthMessage({ type: "warning", text: "Session expired. Sign in again to continue." });
    };

    checkSession();
    const interval = window.setInterval(() => {
      setSessionTick((current) => current + 1);
      checkSession();
    }, 60000);

    return () => window.clearInterval(interval);
  }, [authUser]);

  const readinessItems = useMemo(
    () => baseReadinessItems.map((item) => {
      if (item.label === "Admin access gate" && !authUser) {
        return { ...item, state: "Configured", tone: "info" };
      }
      if (item.label === "Transactional email delivery" && organizationSettings.emailDeliveryConfigured) {
        return { ...item, state: "Active", tone: "success" };
      }
      if (item.label === "Passwordless email sign-in" && organizationSettings.passwordlessSignInConfigured) {
        return { ...item, state: "Active", tone: "success" };
      }
      return item;
    }),
    [authUser, organizationSettings.emailDeliveryConfigured, organizationSettings.passwordlessSignInConfigured]
  );

  const readinessScore = useMemo(() => {
    const complete = readinessItems.filter((item) => item.tone === "success" || item.tone === "info").length;
    return Math.round((complete / readinessItems.length) * 100);
  }, [readinessItems]);
  const canAdmin = Boolean(authUser?.canAdmin);
  const sessionTimeRemaining = sessionTick >= 0 && authUser ? formatSessionTimeRemaining(authUser) : "";
  const sessionExpiringSoon = authUser && isSessionExpiringSoon(authUser);

  const handleUnauthorized = useCallback(() => {
    setAuthUser(null);
    setAuthMessage({ type: "warning", text: "Admin session expired. Sign in again to continue." });
  }, []);

  const handleAdminDataChanged = useCallback(() => {
    fetchAuditLogs();
    axios
      .get(`${API_URL}/api/health-data`)
      .then((res) => setCaseCount(res.data.length))
      .catch(() => {});
  }, [fetchAuditLogs]);

  const handleSettingsSaved = useCallback(() => {
    fetchAuditLogs();
    refreshSettings();
  }, [fetchAuditLogs, refreshSettings]);

  const signInForm = (
    <Box component="form" onSubmit={handleLogin}>
      <Stack spacing={1.4}>
        <TextField
          select
          label="Sign In Type"
          value={loginMode}
          onChange={(event) => setLoginMode(event.target.value)}
          fullWidth
        >
          <MenuItem value="admin">Admin setup code</MenuItem>
          <MenuItem value="user">Organization user</MenuItem>
          <MenuItem value="email">Email sign-in link</MenuItem>
        </TextField>
        {(loginMode === "user" || loginMode === "email") && (
          <TextField
            label="Email"
            type="email"
            value={userEmail}
            onChange={(event) => setUserEmail(event.target.value)}
            required
            fullWidth
            autoComplete="email"
          />
        )}
        {loginMode !== "email" && (
          <TextField
            label={loginMode === "user" ? "User Access Code" : "Admin Access Code"}
            type="password"
            value={accessCode}
            onChange={(event) => setAccessCode(event.target.value)}
            fullWidth
            autoComplete="current-password"
          />
        )}
        <Button
          type="submit"
          variant="contained"
          size="large"
          startIcon={loginMode === "email" ? <EmailOutlinedIcon /> : <LoginIcon />}
          disabled={signingIn || exchangingEmailLink || (loginMode === "email" ? !userEmail.trim() : (!accessCode.trim() || (loginMode === "user" && !userEmail.trim())))}
          sx={{
            minHeight: 48,
            bgcolor: "#0f766e",
            fontWeight: 900,
            boxShadow: "none",
            "&:hover": { bgcolor: "#115e59", boxShadow: "none" },
          }}
        >
          {signingIn ? (loginMode === "email" ? "Sending Link..." : "Signing In...") : (loginMode === "email" ? "Email Sign-In Link" : "Sign In")}
        </Button>
      </Stack>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1.2 }}>
        {loginMode === "email"
          ? "A single-use link will be sent to active users already approved by an administrator. It expires after 15 minutes."
          : "Admin setup code manages the organization. Listed users can sign in with their email and assigned access code."}
      </Typography>
      {loginMode === "user" && (
        <Button
          type="button"
          variant="text"
          onClick={handleResetRequest}
          disabled={requestingReset || !userEmail.trim()}
          sx={{ mt: 0.75, px: 0, fontWeight: 800 }}
        >
          {requestingReset ? "Requesting reset..." : "Request access reset"}
        </Button>
      )}
    </Box>
  );

  if (!authUser) {
    return (
      <Box
        sx={{
          minHeight: "calc(100vh - 72px)",
          position: "relative",
          display: "grid",
          placeItems: "center",
          overflow: "hidden",
          p: { xs: 2, sm: 3, lg: 5 },
          backgroundImage: `url(${surveillanceOperationsBackground})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          "&::before": {
            content: '""',
            position: "absolute",
            inset: 0,
            bgcolor: "rgba(5, 30, 32, 0.72)",
          },
        }}
      >
        <Card
          elevation={0}
          sx={{
            position: "relative",
            width: "100%",
            maxWidth: 1120,
            borderRadius: 1,
            overflow: "hidden",
            border: "1px solid rgba(255, 255, 255, 0.32)",
            boxShadow: "0 30px 90px rgba(2, 15, 17, 0.38)",
            bgcolor: "rgba(255, 255, 255, 0.98)",
          }}
        >
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", md: "1.05fr 0.95fr" },
              minHeight: { md: 540 },
            }}
          >
            <Box
              sx={{
                bgcolor: "rgba(6, 48, 49, 0.98)",
                color: "white",
                p: { xs: 3, sm: 4, md: 5 },
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                gap: { xs: 3, md: 5 },
              }}
            >
              <Box>
                <Stack direction="row" spacing={1.2} alignItems="center" sx={{ mb: 3 }}>
                  <Box
                    sx={{
                      width: 44,
                      height: 44,
                      borderRadius: 1,
                      display: "grid",
                      placeItems: "center",
                      bgcolor: "#0f8a80",
                      color: "white",
                    }}
                  >
                    <SecurityIcon />
                  </Box>
                  <Box>
                    <Typography variant="caption" sx={{ display: "block", color: "#99f6e4", fontWeight: 900, textTransform: "uppercase" }}>
                      Protected workspace
                    </Typography>
                    <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.72)" }}>
                      Role-based institutional access
                    </Typography>
                  </Box>
                </Stack>
                <Typography component="h1" sx={{ fontSize: { xs: "2rem", md: "2.5rem" }, lineHeight: 1.08, fontWeight: 900, mb: 1.5 }}>
                  Secure staff access
                </Typography>
                <Typography variant="body1" sx={{ maxWidth: 500, color: "rgba(255,255,255,0.8)", lineHeight: 1.7 }}>
                  Enter the workspace used to verify reports, coordinate case review, and maintain an accountable record of every decision.
                </Typography>

                <Stack spacing={1.6} sx={{ mt: 4, display: { xs: "none", md: "flex" } }}>
                  {[
                    { icon: <RuleIcon fontSize="small" />, title: "Role-based permissions", detail: "Each user sees only the tools assigned to their role." },
                    { icon: <FactCheckIcon fontSize="small" />, title: "Audited activity", detail: "Reviews, exports, and administrative changes are recorded." },
                    { icon: <CloudDoneIcon fontSize="small" />, title: "Controlled sessions", detail: "Access follows organization-approved session windows." },
                  ].map((item) => (
                    <Stack key={item.title} direction="row" spacing={1.4} alignItems="flex-start">
                      <Box sx={{ mt: 0.2, color: "#fbbf24" }}>{item.icon}</Box>
                      <Box>
                        <Typography variant="body2" fontWeight={900}>{item.title}</Typography>
                        <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.68)" }}>{item.detail}</Typography>
                      </Box>
                    </Stack>
                  ))}
                </Stack>
              </Box>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1.2} alignItems={{ xs: "flex-start", sm: "center" }}>
                <StatusPill label={`API ${apiHealth.status}`} color={apiHealth.color} />
                <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.68)" }}>
                  Public surveillance remains available without staff access.
                </Typography>
              </Stack>
            </Box>

            <Box sx={{ p: { xs: 3, sm: 4, md: 5 }, display: "flex", flexDirection: "column", justifyContent: "center" }}>
              <Box sx={{ maxWidth: 460, width: "100%", mx: "auto" }}>
                <Typography variant="overline" color="#0f766e" fontWeight={900}>
                  {organizationSettings.organizationName}
                </Typography>
                <Typography variant="h5" color="#102a2c" fontWeight={900} sx={{ mt: 0.4, mb: 1 }}>
                  Sign in to your workspace
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                  Use the access method provided by your organization administrator.
                </Typography>
                {authMessage && (
                  <Alert severity={authMessage.type} sx={{ mb: 2 }}>
                    {authMessage.text}
                  </Alert>
                )}
                {signInForm}
                <Divider sx={{ my: 2.5 }} />
                <Stack direction="row" spacing={1} alignItems="flex-start">
                  <SecurityIcon sx={{ color: "#0f766e", fontSize: 18, mt: 0.1 }} />
                  <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.6 }}>
                    Authorized staff only. Access is limited by role, monitored through audit logs, and automatically ends when the approved session expires.
                  </Typography>
                </Stack>
              </Box>
            </Box>
          </Box>
        </Card>
      </Box>
    );
  }

  return (
    <Box sx={{ minHeight: "calc(100vh - 72px)", bgcolor: "#eef4f2", p: { xs: 2, md: 3 } }}>
      <Stack
        direction={{ xs: "column", md: "row" }}
        justifyContent="space-between"
        alignItems={{ xs: "stretch", md: "center" }}
        spacing={2}
        sx={{ mb: 2.5 }}
      >
        <Box>
          <Typography variant="h4" fontWeight={900} color="#102a2c">
            {organizationSettings.organizationName} Admin Console
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Manage readiness, access, audit logs, and surveillance settings for {organizationSettings.defaultRegion}.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center">
          <StatusPill label={`API ${apiHealth.status}`} color={apiHealth.color} />
          <StatusPill label={canAdmin ? "Organization admin active" : "Organization admin locked"} color={canAdmin ? "success" : "warning"} />
        </Stack>
      </Stack>

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "repeat(4, minmax(0, 1fr))" },
          gap: 2,
          mb: 2,
        }}
      >
        <AdminMetric
          icon={<CloudDoneIcon />}
          label="Backend"
          value={apiHealth.status}
          helper="Render API health check"
          color="#0f766e"
        />
        <AdminMetric
          icon={<FactCheckIcon />}
          label="Live Records"
          value={caseCount ?? "-"}
          helper="Stored in MongoDB"
          color="#2563eb"
        />
        <AdminMetric
          icon={<RuleIcon />}
          label="Readiness"
          value={`${readinessScore}%`}
          helper="Current operational setup"
          color="#f97316"
        />
        <AdminMetric
          icon={<SecurityIcon />}
          label="Access"
          value={authUser ? "Protected" : "Locked"}
          helper={authUser ? `${authUser.role} session active` : "Sign in required for reviews"}
          color={authUser ? "#0f766e" : "#dc2626"}
        />
      </Box>

      {canAdmin && (
        <Box sx={{ mb: 2 }}>
          <AdminPanel title="Production Operations" icon={<MonitorHeartIcon />}>
            <OperationalStatusPanel authUser={authUser} />
          </AdminPanel>
        </Box>
      )}

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", lg: "1.2fr 0.8fr" },
          gap: 2,
          mb: 2,
        }}
      >
        <AdminPanel title="Role Design" icon={<ManageAccountsIcon />}>
          <Stack spacing={1.4}>
            {rolePlan.map((item) => (
              <Box
                key={item.role}
                sx={{
                  border: "1px solid rgba(15, 23, 42, 0.08)",
                  borderRadius: 2,
                  p: 1.5,
                  bgcolor: "#f8fbfa",
                }}
              >
                <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" spacing={1}>
                  <Typography variant="body1" fontWeight={900} color="#102a2c">
                    {item.role}
                  </Typography>
                  <StatusPill label={item.status} color={item.status === "Directory ready" ? "success" : "warning"} />
                </Stack>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  {item.access}
                </Typography>
              </Box>
            ))}
          </Stack>
        </AdminPanel>

        <AdminPanel title="Production Readiness" icon={<AdminPanelSettingsIcon />}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Current foundation progress
          </Typography>
          <LinearProgress
            variant="determinate"
            value={readinessScore}
            sx={{
              height: 10,
              borderRadius: 2,
              mb: 2,
              bgcolor: "#dbe7e4",
              "& .MuiLinearProgress-bar": { bgcolor: "#0f766e" },
            }}
          />
          <Stack spacing={1}>
            {readinessItems.map((item) => (
              <Stack key={item.label} direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                <Typography variant="body2" color="#102a2c" fontWeight={700}>
                  {item.label}
                </Typography>
                <StatusPill label={item.state} color={item.tone} />
              </Stack>
            ))}
          </Stack>
        </AdminPanel>
      </Box>

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", lg: "0.9fr 1.1fr" },
          gap: 2,
        }}
      >
        <AdminPanel title="Governance Checklist" icon={<WarningAmberIcon />}>
          <Stack spacing={1.3}>
            {governanceItems.map((item) => (
              <Stack key={item} direction="row" spacing={1.2} alignItems="flex-start">
                <Box
                  sx={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    bgcolor: "#f97316",
                    mt: 0.7,
                    flexShrink: 0,
                  }}
                />
                <Typography variant="body2" color="text.secondary">
                  {item}
                </Typography>
              </Stack>
            ))}
          </Stack>
        </AdminPanel>

        <AdminPanel title="Next Build Queue" icon={<RuleIcon />}>
          <Alert severity="info" sx={{ mb: 2 }}>
            {`${organizationSettings.organizationName} now separates API liveness from database readiness and provides protected operational checks. Next we can modernize the client build toolchain to reduce inherited dependency advisories.`}
          </Alert>
          <Divider sx={{ mb: 2 }} />
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.2}>
            <Button variant="contained" disabled={!canAdmin} sx={{ bgcolor: "#0f766e", fontWeight: 900 }}>
              Add Users
            </Button>
            <Button variant="outlined" disabled={!canAdmin} sx={{ fontWeight: 900 }}>
              Assign Roles
            </Button>
            <Button variant="outlined" onClick={() => fetchAuditLogs()} disabled={!canAdmin} sx={{ fontWeight: 900 }}>
              Audit Logs
            </Button>
          </Stack>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1.5 }}>
            The application records evidence from the configured provider; it does not claim to create or restore database snapshots itself.
          </Typography>
        </AdminPanel>
      </Box>

      <Box sx={{ mt: 2 }}>
        <AdminPanel title="Organization Users" icon={<ManageAccountsIcon />}>
          <AdminUsersPanel
            authUser={canAdmin ? authUser : null}
            onUnauthorized={handleUnauthorized}
            onChanged={handleAdminDataChanged}
          />
        </AdminPanel>
      </Box>

      {authUser?.canImport && (
        <Box sx={{ mt: 2 }}>
          <AdminPanel title="Case Import Staging" icon={<DriveFolderUploadIcon />}>
            <CaseImportPanel authUser={authUser} onChanged={handleAdminDataChanged} />
          </AdminPanel>
        </Box>
      )}

      <Box sx={{ mt: 2 }}>
        <AdminPanel title="Privacy & Retention" icon={<SecurityIcon />}>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", md: "repeat(3, minmax(0, 1fr))" },
              gap: 1.5,
              mb: 2,
            }}
          >
            <Box sx={{ border: "1px solid rgba(15, 23, 42, 0.08)", borderRadius: 2, p: 1.5, bgcolor: "#f8fbfa" }}>
              <Typography variant="caption" color="text.secondary" fontWeight={900} textTransform="uppercase">
                Record Retention
              </Typography>
              <Typography variant="h5" color="#102a2c" fontWeight={900}>
                {formatRetentionDays(organizationSettings.retentionDays)}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Current organization policy window
              </Typography>
            </Box>
            <Box sx={{ border: "1px solid rgba(15, 23, 42, 0.08)", borderRadius: 2, p: 1.5, bgcolor: "#f8fbfa" }}>
              <Typography variant="caption" color="text.secondary" fontWeight={900} textTransform="uppercase">
                Privacy Contact
              </Typography>
              <Typography variant="h6" color="#102a2c" fontWeight={900} sx={{ wordBreak: "break-word" }}>
                {organizationSettings.contactEmail || "Not configured"}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Shown here for institutional governance
              </Typography>
            </Box>
            <Box sx={{ border: "1px solid rgba(15, 23, 42, 0.08)", borderRadius: 2, p: 1.5, bgcolor: "#f8fbfa" }}>
              <Typography variant="caption" color="text.secondary" fontWeight={900} textTransform="uppercase">
                Map Privacy
              </Typography>
              <Typography variant="h6" color="#102a2c" fontWeight={900}>
                Approximate public view
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Exact records stay behind staff access
              </Typography>
            </Box>
          </Box>

          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
              gap: 2,
            }}
          >
            <Box>
              <Typography variant="subtitle2" color="#102a2c" fontWeight={900} sx={{ mb: 1 }}>
                Public surveillance summary
              </Typography>
              <Stack spacing={0.8}>
                {publicDataBoundaries.map((item) => (
                  <Typography key={item} variant="body2" color="text.secondary">
                    {item}
                  </Typography>
                ))}
              </Stack>
            </Box>
            <Box>
              <Typography variant="subtitle2" color="#102a2c" fontWeight={900} sx={{ mb: 1 }}>
                Protected staff record
              </Typography>
              <Stack spacing={0.8}>
                {protectedDataBoundaries.map((item) => (
                  <Typography key={item} variant="body2" color="text.secondary">
                    {item}
                  </Typography>
                ))}
              </Stack>
            </Box>
          </Box>
        </AdminPanel>
      </Box>

      {canAdmin && (
        <Box sx={{ mt: 2 }}>
          <AdminPanel title="Backup & Recovery Readiness" icon={<BackupIcon />}>
            <BackupRecoveryPanel authUser={authUser} onChanged={handleAdminDataChanged} />
          </AdminPanel>
        </Box>
      )}

      {canAdmin && (
        <Box sx={{ mt: 2 }}>
          <AdminPanel title="Retention Enforcement" icon={<DeleteSweepIcon />}>
            <RetentionEnforcementPanel authUser={authUser} onChanged={handleAdminDataChanged} />
          </AdminPanel>
        </Box>
      )}

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", lg: "0.8fr 1.2fr" },
          gap: 2,
          mt: 2,
        }}
      >
        <AdminPanel title="Admin Access" icon={<SecurityIcon />}>
          {authMessage && (
            <Alert severity={authMessage.type} sx={{ mb: 2 }}>
              {authMessage.text}
            </Alert>
          )}

          <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" spacing={2}>
            <Box>
              <Typography variant="body1" fontWeight={900} color="#102a2c">
                {authUser.name}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Role: {authUser.role}. {authUser.canAdmin ? "This session can manage users and settings." : authUser.canReview ? "This session can save case review updates." : "This session can access assigned organization workflows."}
              </Typography>
              <Typography variant="caption" color={sessionExpiringSoon ? "warning.main" : "text.secondary"} display="block" sx={{ mt: 0.5, fontWeight: 700 }}>
                Session active until {formatSessionExpiry(authUser)}{sessionTimeRemaining ? ` · ${sessionTimeRemaining} remaining` : ""}
              </Typography>
              {sessionExpiringSoon && (
                <Alert severity="warning" sx={{ mt: 1.2, fontSize: "0.8rem", borderRadius: 2 }}>
                  Your session is almost up. Sign out and sign back in if you need more time.
                </Alert>
              )}
            </Box>
            <Button
              variant="outlined"
              color="inherit"
              startIcon={<LogoutIcon />}
              onClick={handleLogout}
              sx={{ fontWeight: 900, alignSelf: { xs: "flex-start", sm: "center" } }}
            >
              Sign Out
            </Button>
          </Stack>
        </AdminPanel>

        <AdminPanel title="Audit Logs" icon={<FactCheckIcon />}>
          {!canAdmin ? (
            <Alert severity="warning">
              Sign in as an administrator to view audit activity.
            </Alert>
          ) : auditError ? (
            <Alert severity="error">{auditError}</Alert>
          ) : auditLogs.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No audit activity has been recorded yet.
            </Typography>
          ) : (
            <TableContainer sx={{ maxHeight: 360 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow sx={{ "& th": { fontWeight: 900, bgcolor: "#082f2f", color: "white" } }}>
                    <TableCell>Time</TableCell>
                    <TableCell>Action</TableCell>
                    <TableCell>Actor</TableCell>
                    <TableCell>Case</TableCell>
                    <TableCell>Changes</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {auditLogs.map((log) => (
                    <TableRow key={log._id} hover>
                      <TableCell sx={{ whiteSpace: "nowrap" }}>{formatDateTime(log.createdAt)}</TableCell>
                      <TableCell>
                        <Typography variant="body2" fontWeight={800}>
                          {formatAction(log.action)}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">{log.actor || "System"}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {log.role || "System"}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        {log.caseDisease ? (
                          <Box>
                            <Typography variant="body2" fontWeight={800}>
                              {log.caseDisease}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {log.caseLocation || "Unknown location"}
                            </Typography>
                          </Box>
                        ) : (
                          <Typography variant="body2" color="text.secondary">
                            Not case-specific
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" color="text.secondary">
                          {log.changedFields?.length ? log.changedFields.join(", ") : "Session event"}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </AdminPanel>
      </Box>

      <Box sx={{ mt: 2 }}>
        <AdminPanel title="Organization Settings" icon={<AdminPanelSettingsIcon />}>
          <OrganizationSettingsPanel
            authUser={canAdmin ? authUser : null}
            onUnauthorized={handleUnauthorized}
            onSaved={handleSettingsSaved}
          />
        </AdminPanel>
      </Box>
    </Box>
  );
}
