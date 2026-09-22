import React, { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
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
import PersonAddIcon from "@mui/icons-material/PersonAdd";
import VpnKeyIcon from "@mui/icons-material/VpnKey";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import LockOpenIcon from "@mui/icons-material/LockOpen";
import ToggleOffIcon from "@mui/icons-material/ToggleOff";
import ToggleOnIcon from "@mui/icons-material/ToggleOn";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import EmailOutlinedIcon from "@mui/icons-material/EmailOutlined";
import { authHeaders, clearAdminToken, getAdminToken } from "./auth";
import { useOrganizationSettings } from "./OrganizationSettingsContext";

const API_URL = import.meta.env.VITE_API_URL || import.meta.env.REACT_APP_API_URL || "http://localhost:5000";
const USER_ROLES = ["System Administrator", "Epidemiology Reviewer", "Field Reporter", "Institution Viewer", "Data Manager"];
const MIN_SESSION_DURATION_HOURS = 1;
const MAX_SESSION_DURATION_HOURS = 24;

const emptyForm = {
  fullName: "",
  email: "",
  accessCode: "",
  role: "Field Reporter",
  sessionDurationHours: 8,
  facility: "",
  jurisdiction: "",
  notes: "",
};

function formatDate(value) {
  if (!value) return "Not recorded";
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatDateTime(value) {
  if (!value) return "Not recorded";
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatSessionWindow(hours) {
  const value = Number(hours) || 8;
  return `${value} ${value === 1 ? "hour" : "hours"}`;
}

function isUserLocked(user) {
  return user.lockedUntil && new Date(user.lockedUntil) > new Date();
}

function buildInviteMessage(user, settings) {
  const signInUrl = `${window.location.origin}/admin`;
  return [
    `Hello ${user.fullName},`,
    "",
    `You have been added to ${settings.organizationName} as ${user.role}.`,
    `Sign in here: ${signInUrl}`,
    "",
    "Sign-in type: Organization user",
    `Email: ${user.email}`,
    "Access code: provided separately by your administrator",
    `Approved session window: ${formatSessionWindow(user.sessionDurationHours)}`,
    `Jurisdiction: ${user.jurisdiction || settings.defaultRegion}`,
    user.facility ? `Facility: ${user.facility}` : "",
    "",
    "For security, do not share your access code.",
  ].filter(Boolean).join("\n");
}

function buildResetHandoffMessage(user, settings) {
  const signInUrl = `${window.location.origin}/admin`;
  return [
    `Hello ${user.fullName},`,
    "",
    `Your ${settings.organizationName} access has been reset by an administrator.`,
    `Sign in here: ${signInUrl}`,
    "",
    "Sign-in type: Organization user",
    `Email: ${user.email}`,
    "New access code: provided separately by your administrator",
    `Approved session window: ${formatSessionWindow(user.sessionDurationHours)}`,
    "",
    "For security, do not share your access code.",
  ].join("\n");
}

async function copyHandoffMessage(message, promptTitle) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(message);
    return;
  }
  window.prompt(promptTitle, message);
}

export default function AdminUsersPanel({ authUser, onUnauthorized, onChanged }) {
  const { settings } = useOrganizationSettings();
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  const facilityOptions = useMemo(() => settings.facilityList || [], [settings.facilityList]);

  const fetchUsers = useCallback(async () => {
    const token = getAdminToken();
    if (!authUser || !token) {
      setUsers([]);
      return;
    }

    setLoading(true);
    try {
      const res = await axios.get(`${API_URL}/api/admin/users`, { headers: authHeaders(token) });
      setUsers(res.data);
      setMessage(null);
    } catch (err) {
      if (err.response?.status === 401) {
        clearAdminToken();
        onUnauthorized?.();
      }
      setMessage({ type: "error", text: err.response?.data?.error || "Unable to load organization users." });
    } finally {
      setLoading(false);
    }
  }, [authUser, onUnauthorized]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleChange = (event) => {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  };

  const handleCreate = async (event) => {
    event.preventDefault();
    const token = getAdminToken();
    if (!authUser || !token) {
      setMessage({ type: "warning", text: "Sign in before adding organization users." });
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      const res = await axios.post(`${API_URL}/api/admin/users`, form, { headers: authHeaders(token) });
      setUsers((current) => [...current, res.data].sort((a, b) => a.fullName.localeCompare(b.fullName)));
      setForm(emptyForm);
      setMessage({ type: "success", text: "Organization user added." });
      onChanged?.();
    } catch (err) {
      if (err.response?.status === 401) {
        clearAdminToken();
        onUnauthorized?.();
      }
      const text = err.response?.data?.errors?.[0]?.msg || err.response?.data?.error || "Unable to add organization user.";
      setMessage({ type: "error", text });
    } finally {
      setSaving(false);
    }
  };

  const resetAccessCode = async (user) => {
    const token = getAdminToken();
    if (!token) return;

    const nextCode = window.prompt(`Enter a new access code for ${user.fullName}. Use at least 6 characters.`);
    if (!nextCode) return;

    try {
      const res = await axios.patch(`${API_URL}/api/admin/users/${user._id}`, { accessCode: nextCode }, { headers: authHeaders(token) });
      setUsers((current) => current.map((item) => (item._id === user._id ? res.data : item)));
      setMessage({ type: "success", text: `Access code updated for ${user.fullName}.` });
      onChanged?.();
    } catch (err) {
      if (err.response?.status === 401) {
        clearAdminToken();
        onUnauthorized?.();
      }
      const text = err.response?.data?.errors?.[0]?.msg || err.response?.data?.error || "Unable to update access code.";
      setMessage({ type: "error", text });
    }
  };

  const updateSessionDuration = async (user) => {
    const token = getAdminToken();
    if (!token) return;

    const currentDuration = Number(user.sessionDurationHours) || 8;
    const nextDuration = window.prompt(
      `Set approved session duration for ${user.fullName} in hours (${MIN_SESSION_DURATION_HOURS}-${MAX_SESSION_DURATION_HOURS}).`,
      String(currentDuration)
    );
    if (!nextDuration) return;
    const nextDurationNumber = Number(nextDuration);
    if (
      !Number.isFinite(nextDurationNumber) ||
      nextDurationNumber < MIN_SESSION_DURATION_HOURS ||
      nextDurationNumber > MAX_SESSION_DURATION_HOURS
    ) {
      setMessage({ type: "warning", text: `Session time must be between ${MIN_SESSION_DURATION_HOURS} and ${MAX_SESSION_DURATION_HOURS} hours.` });
      return;
    }

    try {
      const res = await axios.patch(
        `${API_URL}/api/admin/users/${user._id}`,
        { sessionDurationHours: nextDurationNumber },
        { headers: authHeaders(token) }
      );
      setUsers((current) => current.map((item) => (item._id === user._id ? res.data : item)));
      setMessage({ type: "success", text: `Session time updated for ${user.fullName}.` });
      onChanged?.();
    } catch (err) {
      if (err.response?.status === 401) {
        clearAdminToken();
        onUnauthorized?.();
      }
      const text = err.response?.data?.errors?.[0]?.msg || err.response?.data?.error || "Unable to update session time.";
      setMessage({ type: "error", text });
    }
  };

  const toggleStatus = async (user) => {
    const token = getAdminToken();
    if (!token) return;

    const nextStatus = user.status === "Active" ? "Inactive" : "Active";
    try {
      const res = await axios.patch(`${API_URL}/api/admin/users/${user._id}`, { status: nextStatus }, { headers: authHeaders(token) });
      setUsers((current) => current.map((item) => (item._id === user._id ? res.data : item)));
      setMessage({ type: "success", text: `${user.fullName} marked ${nextStatus.toLowerCase()}.` });
      onChanged?.();
    } catch (err) {
      if (err.response?.status === 401) {
        clearAdminToken();
        onUnauthorized?.();
      }
      setMessage({ type: "error", text: err.response?.data?.error || "Unable to update user status." });
    }
  };

  const unlockUser = async (user) => {
    const token = getAdminToken();
    if (!token) return;

    try {
      const res = await axios.patch(`${API_URL}/api/admin/users/${user._id}`, { unlock: true }, { headers: authHeaders(token) });
      setUsers((current) => current.map((item) => (item._id === user._id ? res.data : item)));
      setMessage({ type: "success", text: `${user.fullName} is unlocked and failed attempts were cleared.` });
      onChanged?.();
    } catch (err) {
      if (err.response?.status === 401) {
        clearAdminToken();
        onUnauthorized?.();
      }
      const text = err.response?.data?.errors?.[0]?.msg || err.response?.data?.error || "Unable to unlock this user.";
      setMessage({ type: "error", text });
    }
  };

  const prepareInvite = async (user) => {
    const token = getAdminToken();
    if (!token) return;

    const inviteMessage = buildInviteMessage(user, settings);

    try {
      const res = await axios.post(`${API_URL}/api/admin/users/${user._id}/invite`, {}, { headers: authHeaders(token) });
      const { notification, ...updatedUser } = res.data;
      setUsers((current) => current.map((item) => (item._id === user._id ? updatedUser : item)));
      if (notification?.status === "sent") {
        setMessage({ type: "success", text: `Invite emailed to ${user.email}. Share the access code separately through a secure channel.` });
      } else {
        await copyHandoffMessage(inviteMessage, "Copy this invite message");
        setMessage({ type: "success", text: `Email delivery is not configured, so the invite was copied for ${user.fullName}. Share the access code separately.` });
      }
      onChanged?.();
    } catch (err) {
      if (err.response?.status === 401) {
        clearAdminToken();
        onUnauthorized?.();
      }
      if (err.response?.status === 502 && err.response?.data?.manualFallbackAllowed) {
        try {
          const fallback = await axios.post(
            `${API_URL}/api/admin/users/${user._id}/invite`,
            { delivery: "manual" },
            { headers: authHeaders(token) }
          );
          const updatedUser = { ...fallback.data };
          delete updatedUser.notification;
          setUsers((current) => current.map((item) => (item._id === user._id ? updatedUser : item)));
          await copyHandoffMessage(inviteMessage, "Copy this invite message");
          setMessage({ type: "warning", text: `Email delivery failed, so the invite was copied for ${user.fullName}. Share the access code separately.` });
          onChanged?.();
          return;
        } catch (fallbackError) {
          setMessage({ type: "error", text: fallbackError.response?.data?.error || "Email and manual invite delivery both failed." });
          return;
        }
      }
      const text = err.response?.data?.error || "Unable to deliver this invite.";
      setMessage({ type: "error", text });
    }
  };

  const prepareResetHandoff = async (user) => {
    const token = getAdminToken();
    if (!token) return;

    const resetMessage = buildResetHandoffMessage(user, settings);

    try {
      const res = await axios.post(`${API_URL}/api/admin/users/${user._id}/reset-handoff`, {}, { headers: authHeaders(token) });
      const { notification, ...updatedUser } = res.data;
      setUsers((current) => current.map((item) => (item._id === user._id ? updatedUser : item)));
      if (notification?.status === "sent") {
        setMessage({ type: "success", text: `Reset notice emailed to ${user.email}. Share the new access code separately through a secure channel.` });
      } else {
        await copyHandoffMessage(resetMessage, "Copy this reset message");
        setMessage({ type: "success", text: `Email delivery is not configured, so the reset notice was copied for ${user.fullName}. Share the new access code separately.` });
      }
      onChanged?.();
    } catch (err) {
      if (err.response?.status === 401) {
        clearAdminToken();
        onUnauthorized?.();
      }
      if (err.response?.status === 502 && err.response?.data?.manualFallbackAllowed) {
        try {
          const fallback = await axios.post(
            `${API_URL}/api/admin/users/${user._id}/reset-handoff`,
            { delivery: "manual" },
            { headers: authHeaders(token) }
          );
          const updatedUser = { ...fallback.data };
          delete updatedUser.notification;
          setUsers((current) => current.map((item) => (item._id === user._id ? updatedUser : item)));
          await copyHandoffMessage(resetMessage, "Copy this reset message");
          setMessage({ type: "warning", text: `Email delivery failed, so the reset notice was copied for ${user.fullName}. Share the new access code separately.` });
          onChanged?.();
          return;
        } catch (fallbackError) {
          setMessage({ type: "error", text: fallbackError.response?.data?.error || "Email and manual reset delivery both failed." });
          return;
        }
      }
      const text = err.response?.data?.error || "Unable to deliver this reset notice.";
      setMessage({ type: "error", text });
    }
  };

  if (!authUser) {
    return (
      <Alert severity="warning">
        Sign in with the admin access code to add and manage organization users.
      </Alert>
    );
  }

  return (
    <Stack spacing={2}>
      {message && (
        <Alert severity={message.type}>
          {message.text}
        </Alert>
      )}

      <Box component="form" onSubmit={handleCreate}>
        <Stack direction={{ xs: "column", lg: "row" }} spacing={1.2}>
          <TextField label="Full Name" name="fullName" value={form.fullName} onChange={handleChange} size="small" required fullWidth />
          <TextField label="Email" name="email" type="email" value={form.email} onChange={handleChange} size="small" required fullWidth />
          <TextField label="Access Code" name="accessCode" type="password" value={form.accessCode} onChange={handleChange} size="small" required fullWidth inputProps={{ minLength: 6 }} />
          <TextField select label="Role" name="role" value={form.role} onChange={handleChange} size="small" required fullWidth>
            {USER_ROLES.map((role) => (
              <MenuItem key={role} value={role}>{role}</MenuItem>
            ))}
          </TextField>
          <TextField
            label="Session Hours"
            name="sessionDurationHours"
            type="number"
            value={form.sessionDurationHours}
            onChange={handleChange}
            size="small"
            required
            fullWidth
            inputProps={{ min: MIN_SESSION_DURATION_HOURS, max: MAX_SESSION_DURATION_HOURS, step: 0.5 }}
          />
        </Stack>
        <Stack direction={{ xs: "column", lg: "row" }} spacing={1.2} sx={{ mt: 1.2 }}>
          <TextField
            label="Facility"
            name="facility"
            value={form.facility}
            onChange={handleChange}
            size="small"
            fullWidth
            inputProps={{ list: "admin-user-facilities" }}
          />
          <datalist id="admin-user-facilities">
            {facilityOptions.map((facility) => (
              <option key={facility} value={facility} />
            ))}
          </datalist>
          <TextField label="Jurisdiction" name="jurisdiction" value={form.jurisdiction} onChange={handleChange} size="small" fullWidth placeholder={settings.defaultRegion} />
          <TextField label="Notes" name="notes" value={form.notes} onChange={handleChange} size="small" fullWidth inputProps={{ maxLength: 500 }} />
        </Stack>
        <Button
          type="submit"
          variant="contained"
          startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <PersonAddIcon />}
          disabled={saving}
          sx={{ mt: 1.5, bgcolor: "#0f766e", fontWeight: 900, "&:hover": { bgcolor: "#115e59" } }}
        >
          {saving ? "Adding User..." : "Add Organization User"}
        </Button>
      </Box>

      {loading ? (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
          <CircularProgress size={22} />
          <Typography variant="body2" color="text.secondary">Loading users...</Typography>
        </Box>
      ) : users.length === 0 ? (
        <Alert severity="info">No organization users have been added yet.</Alert>
      ) : (
        <TableContainer sx={{ maxHeight: 360 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow sx={{ "& th": { fontWeight: 900, bgcolor: "#082f2f", color: "white" } }}>
                <TableCell>Name</TableCell>
                <TableCell>Email</TableCell>
                <TableCell>Role</TableCell>
                <TableCell>Facility</TableCell>
                <TableCell>Jurisdiction</TableCell>
                <TableCell>Session Window</TableCell>
                <TableCell>Last Sign-In</TableCell>
                <TableCell>Code Updated</TableCell>
                <TableCell>Invite</TableCell>
                <TableCell>Reset Request</TableCell>
                <TableCell>Security</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Added</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user._id} hover>
                  <TableCell>
                    <Typography variant="body2" fontWeight={900}>{user.fullName}</Typography>
                    {user.notes && <Typography variant="caption" color="text.secondary">{user.notes}</Typography>}
                  </TableCell>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>{user.role}</TableCell>
                  <TableCell>{user.facility || "All facilities"}</TableCell>
                  <TableCell>{user.jurisdiction || settings.defaultRegion}</TableCell>
                  <TableCell>{formatSessionWindow(user.sessionDurationHours)}</TableCell>
                  <TableCell>{formatDateTime(user.lastLoginAt)}</TableCell>
                  <TableCell>{formatDateTime(user.accessCodeUpdatedAt)}</TableCell>
                  <TableCell>
                    <Typography variant="caption" color="text.secondary" display="block">
                      {formatDateTime(user.invitedAt)}
                    </Typography>
                    {user.invitedAt && (
                      <Chip
                        label={user.inviteDeliveryMethod === "email" ? "Emailed" : "Copied"}
                        size="small"
                        color={user.inviteDeliveryMethod === "email" ? "success" : "default"}
                        sx={{ mt: 0.5, fontWeight: 800 }}
                      />
                    )}
                  </TableCell>
                  <TableCell>
                    {user.resetRequestedAt ? (
                      <Box>
                        <Chip label="Requested" size="small" color="warning" sx={{ fontWeight: 900, mb: 0.5 }} />
                        <Typography variant="caption" color="text.secondary" display="block">
                          {formatDateTime(user.resetRequestedAt)}
                        </Typography>
                        {user.resetHandoffAt && (
                          <Stack direction="row" spacing={0.7} alignItems="center" sx={{ mt: 0.5 }}>
                            <Typography variant="caption" color="text.secondary">
                              Handoff {formatDateTime(user.resetHandoffAt)}
                            </Typography>
                            <Chip
                              label={user.resetHandoffDeliveryMethod === "email" ? "Emailed" : "Copied"}
                              size="small"
                              color={user.resetHandoffDeliveryMethod === "email" ? "success" : "default"}
                              sx={{ fontWeight: 800 }}
                            />
                          </Stack>
                        )}
                      </Box>
                    ) : (
                      <Typography variant="caption" color="text.secondary">
                        {user.resetHandoffAt ? `Last handoff ${formatDateTime(user.resetHandoffAt)}` : "None"}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    {isUserLocked(user) ? (
                      <Box>
                        <Chip label="Locked" size="small" color="warning" sx={{ fontWeight: 900, mb: 0.5 }} />
                        <Typography variant="caption" color="text.secondary" display="block">
                          Until {formatDateTime(user.lockedUntil)}
                        </Typography>
                      </Box>
                    ) : (
                      <Typography variant="caption" color="text.secondary">
                        {Number(user.failedLoginAttempts) > 0 ? `${user.failedLoginAttempts} failed attempt${user.failedLoginAttempts === 1 ? "" : "s"}` : "No failed attempts"}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Chip label={user.status} size="small" color={user.status === "Active" ? "success" : "default"} sx={{ fontWeight: 900 }} />
                  </TableCell>
                  <TableCell>{formatDate(user.createdAt)}</TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={1} justifyContent="flex-end">
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<LockOpenIcon />}
                        onClick={() => unlockUser(user)}
                        disabled={!isUserLocked(user) && !Number(user.failedLoginAttempts)}
                        sx={{ fontWeight: 800, whiteSpace: "nowrap" }}
                      >
                        Unlock
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={settings.emailDeliveryConfigured ? <EmailOutlinedIcon /> : <ContentCopyIcon />}
                        onClick={() => prepareInvite(user)}
                        sx={{ fontWeight: 800, whiteSpace: "nowrap" }}
                      >
                        {settings.emailDeliveryConfigured ? "Send Invite" : "Copy Invite"}
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<AccessTimeIcon />}
                        onClick={() => updateSessionDuration(user)}
                        sx={{ fontWeight: 800, whiteSpace: "nowrap" }}
                      >
                        Set Time
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<VpnKeyIcon />}
                        onClick={() => resetAccessCode(user)}
                        sx={{ fontWeight: 800, whiteSpace: "nowrap" }}
                      >
                        Set Code
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={settings.emailDeliveryConfigured ? <EmailOutlinedIcon /> : <ContentCopyIcon />}
                        onClick={() => prepareResetHandoff(user)}
                        sx={{ fontWeight: 800, whiteSpace: "nowrap" }}
                      >
                        {settings.emailDeliveryConfigured ? "Send Reset" : "Copy Reset"}
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={user.status === "Active" ? <ToggleOffIcon /> : <ToggleOnIcon />}
                        onClick={() => toggleStatus(user)}
                        sx={{ fontWeight: 800, whiteSpace: "nowrap" }}
                      >
                        {user.status === "Active" ? "Deactivate" : "Activate"}
                      </Button>
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Stack>
  );
}
