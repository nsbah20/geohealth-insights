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
import { authHeaders, clearAdminToken, getAdminToken, setAdminToken } from "./auth";
import OrganizationSettingsPanel from "./OrganizationSettingsPanel";
import { useOrganizationSettings } from "./OrganizationSettingsContext";
import AdminUsersPanel from "./AdminUsersPanel";

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
];

const governanceItems = [
  "Define who can submit, review, approve, export, and administer records.",
  "Require authenticated users before real institutional health data is entered.",
  "Expand audit logs to include exports and administrative setting changes.",
  "Prepare privacy notices and data retention rules before any production rollout.",
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

function formatAction(action) {
  if (action === "admin_login") return "Admin sign-in";
  if (action === "organization_user_login") return "Organization user sign-in";
  if (action === "case_created") return "Case submitted";
  if (action === "case_review_updated") return "Case review updated";
  if (action === "case_deleted") return "Case deleted";
  if (action === "organization_settings_updated") return "Organization settings updated";
  if (action === "organization_user_created") return "Organization user created";
  if (action === "organization_user_updated") return "Organization user updated";
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
  const [auditLogs, setAuditLogs] = useState([]);
  const [auditError, setAuditError] = useState(null);

  useEffect(() => {
    let active = true;

    Promise.all([
      axios.get(`${API_URL}/api/ping`),
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

  const handleLogout = () => {
    clearAdminToken();
    setAuthUser(null);
    setAuthMessage({ type: "info", text: "Admin session ended." });
  };

  const readinessItems = useMemo(
    () => baseReadinessItems.map((item) => (
      item.label === "Admin access gate" && !authUser
        ? { ...item, state: "Configured", tone: "info" }
        : item
    )),
    [authUser]
  );

  const readinessScore = useMemo(() => {
    const complete = readinessItems.filter((item) => item.tone === "success" || item.tone === "info").length;
    return Math.round((complete / readinessItems.length) * 100);
  }, [readinessItems]);
  const canAdmin = Boolean(authUser?.canAdmin);

  const handleUnauthorized = useCallback(() => {
    setAuthUser(null);
    setAuthMessage({ type: "warning", text: "Admin session expired. Sign in again to continue." });
  }, []);

  const handleAdminDataChanged = useCallback(() => {
    fetchAuditLogs();
  }, [fetchAuditLogs]);

  const handleSettingsSaved = useCallback(() => {
    fetchAuditLogs();
    refreshSettings();
  }, [fetchAuditLogs, refreshSettings]);

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
            {organizationSettings.organizationName} can now track organization users and role assignments. Next we can connect those users to individual password or single sign-on login.
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
            This stage stores user assignments. Full individual sign-in comes next.
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

          {authUser ? (
            <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" spacing={2}>
              <Box>
                <Typography variant="body1" fontWeight={900} color="#102a2c">
                  {authUser.name}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Role: {authUser.role}. {authUser.canAdmin ? "This session can manage users and settings." : authUser.canReview ? "This session can save case review updates." : "This session can access assigned organization workflows."}
                </Typography>
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
          ) : (
            <Box component="form" onSubmit={handleLogin}>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1.2} alignItems={{ xs: "stretch", sm: "center" }}>
                <TextField
                  select
                  label="Sign In Type"
                  value={loginMode}
                  onChange={(event) => setLoginMode(event.target.value)}
                  size="small"
                  sx={{ maxWidth: { sm: 240 }, flex: 1 }}
                >
                  <MenuItem value="admin">Admin setup code</MenuItem>
                  <MenuItem value="user">Organization user</MenuItem>
                </TextField>
                {loginMode === "user" && (
                  <TextField
                    label="Email"
                    type="email"
                    value={userEmail}
                    onChange={(event) => setUserEmail(event.target.value)}
                    size="small"
                    required
                    sx={{ maxWidth: { sm: 320 }, flex: 1 }}
                  />
                )}
                <TextField
                  label={loginMode === "user" ? "User Access Code" : "Admin Access Code"}
                  type="password"
                  value={accessCode}
                  onChange={(event) => setAccessCode(event.target.value)}
                  size="small"
                  sx={{ maxWidth: { sm: 360 }, flex: 1 }}
                />
                <Button
                  type="submit"
                  variant="contained"
                  startIcon={<LoginIcon />}
                  disabled={signingIn || !accessCode.trim() || (loginMode === "user" && !userEmail.trim())}
                  sx={{ bgcolor: "#0f766e", fontWeight: 900, "&:hover": { bgcolor: "#115e59" } }}
                >
                  {signingIn ? "Signing In..." : "Sign In"}
                </Button>
              </Stack>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                Admin setup code manages the organization. Listed users can sign in with their email and assigned access code.
              </Typography>
            </Box>
          )}
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
