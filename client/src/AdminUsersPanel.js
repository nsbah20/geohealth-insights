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
import ToggleOffIcon from "@mui/icons-material/ToggleOff";
import ToggleOnIcon from "@mui/icons-material/ToggleOn";
import { authHeaders, clearAdminToken, getAdminToken } from "./auth";
import { useOrganizationSettings } from "./OrganizationSettingsContext";

const API_URL = process.env.REACT_APP_API_URL || "http://localhost:5000";
const USER_ROLES = ["System Administrator", "Epidemiology Reviewer", "Field Reporter", "Institution Viewer", "Data Manager"];

const emptyForm = {
  fullName: "",
  email: "",
  role: "Field Reporter",
  facility: "",
  jurisdiction: "",
  notes: "",
};

function formatDate(value) {
  if (!value) return "Not recorded";
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
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
          <TextField select label="Role" name="role" value={form.role} onChange={handleChange} size="small" required fullWidth>
            {USER_ROLES.map((role) => (
              <MenuItem key={role} value={role}>{role}</MenuItem>
            ))}
          </TextField>
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
                <TableCell>Status</TableCell>
                <TableCell>Added</TableCell>
                <TableCell align="right">Access</TableCell>
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
                  <TableCell>
                    <Chip label={user.status} size="small" color={user.status === "Active" ? "success" : "default"} sx={{ fontWeight: 900 }} />
                  </TableCell>
                  <TableCell>{formatDate(user.createdAt)}</TableCell>
                  <TableCell align="right">
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={user.status === "Active" ? <ToggleOffIcon /> : <ToggleOnIcon />}
                      onClick={() => toggleStatus(user)}
                      sx={{ fontWeight: 800, whiteSpace: "nowrap" }}
                    >
                      {user.status === "Active" ? "Deactivate" : "Activate"}
                    </Button>
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
