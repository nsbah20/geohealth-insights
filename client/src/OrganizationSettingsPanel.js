import React, { useEffect, useState } from "react";
import axios from "axios";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import SaveIcon from "@mui/icons-material/Save";
import { authHeaders, clearAdminToken, getAdminToken } from "./auth";

const API_URL = process.env.REACT_APP_API_URL || "http://localhost:5000";

const emptySettings = {
  organizationName: "",
  defaultRegion: "",
  surveillanceScope: "",
  contactEmail: "",
  retentionDays: 365,
  lowPriorityMaxCases: 19,
  mediumPriorityMaxCases: 49,
  diseaseList: "",
  facilityList: "",
  reportSourceList: "",
};

function listToText(value) {
  return Array.isArray(value) ? value.join("\n") : value || "";
}

function textToList(value) {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export default function OrganizationSettingsPanel({ authUser, onUnauthorized, onSaved }) {
  const [form, setForm] = useState(emptySettings);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    const token = getAdminToken();
    if (!authUser || !token) return;

    setLoading(true);
    axios
      .get(`${API_URL}/api/admin/settings`, { headers: authHeaders(token) })
      .then((res) => {
        const settings = res.data;
        setForm({
          organizationName: settings.organizationName || "",
          defaultRegion: settings.defaultRegion || "",
          surveillanceScope: settings.surveillanceScope || "",
          contactEmail: settings.contactEmail || "",
          retentionDays: settings.retentionDays || 365,
          lowPriorityMaxCases: settings.lowPriorityMaxCases || 19,
          mediumPriorityMaxCases: settings.mediumPriorityMaxCases || 49,
          diseaseList: listToText(settings.diseaseList),
          facilityList: listToText(settings.facilityList),
          reportSourceList: listToText(settings.reportSourceList),
        });
        setMessage(null);
      })
      .catch((err) => {
        if (err.response?.status === 401) {
          clearAdminToken();
          onUnauthorized?.();
        }
        setMessage({ type: "error", text: err.response?.data?.error || "Unable to load organization settings." });
      })
      .finally(() => setLoading(false));
  }, [authUser, onUnauthorized]);

  const handleChange = (event) => {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  };

  const handleSave = async (event) => {
    event.preventDefault();
    const token = getAdminToken();
    if (!authUser || !token) {
      setMessage({ type: "warning", text: "Sign in before saving organization settings." });
      return;
    }

    setSaving(true);
    setMessage(null);

    try {
      const payload = {
        organizationName: form.organizationName,
        defaultRegion: form.defaultRegion,
        surveillanceScope: form.surveillanceScope,
        contactEmail: form.contactEmail,
        retentionDays: Number(form.retentionDays),
        lowPriorityMaxCases: Number(form.lowPriorityMaxCases),
        mediumPriorityMaxCases: Number(form.mediumPriorityMaxCases),
        diseaseList: textToList(form.diseaseList),
        facilityList: textToList(form.facilityList),
        reportSourceList: textToList(form.reportSourceList),
      };
      await axios.patch(`${API_URL}/api/admin/settings`, payload, { headers: authHeaders(token) });
      setMessage({ type: "success", text: "Organization settings saved." });
      onSaved?.();
    } catch (err) {
      if (err.response?.status === 401) {
        clearAdminToken();
        onUnauthorized?.();
      }
      const text = err.response?.data?.errors?.[0]?.msg || err.response?.data?.error || "Unable to save organization settings.";
      setMessage({ type: "error", text });
    } finally {
      setSaving(false);
    }
  };

  if (!authUser) {
    return (
      <Alert severity="warning">
        Sign in with the admin access code to edit organization settings.
      </Alert>
    );
  }

  if (loading) {
    return (
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
        <CircularProgress size={22} />
        <Typography variant="body2" color="text.secondary">
          Loading organization settings...
        </Typography>
      </Box>
    );
  }

  return (
    <Box component="form" onSubmit={handleSave}>
      {message && (
        <Alert severity={message.type} sx={{ mb: 2 }}>
          {message.text}
        </Alert>
      )}

      <Stack spacing={2}>
        <Stack direction={{ xs: "column", md: "row" }} spacing={1.5}>
          <TextField
            label="Organization Name"
            name="organizationName"
            value={form.organizationName}
            onChange={handleChange}
            size="small"
            fullWidth
            required
          />
          <TextField
            label="Default Surveillance Region"
            name="defaultRegion"
            value={form.defaultRegion}
            onChange={handleChange}
            size="small"
            fullWidth
            required
          />
        </Stack>

        <TextField
          label="Surveillance Scope"
          name="surveillanceScope"
          value={form.surveillanceScope}
          onChange={handleChange}
          size="small"
          fullWidth
          required
          multiline
          minRows={2}
          inputProps={{ maxLength: 300 }}
        />

        <Stack direction={{ xs: "column", md: "row" }} spacing={1.5}>
          <TextField
            label="Contact Email"
            name="contactEmail"
            type="email"
            value={form.contactEmail}
            onChange={handleChange}
            size="small"
            fullWidth
          />
          <TextField
            label="Retention Days"
            name="retentionDays"
            type="number"
            value={form.retentionDays}
            onChange={handleChange}
            size="small"
            fullWidth
            inputProps={{ min: 30, max: 3650 }}
            required
          />
        </Stack>

        <Stack direction={{ xs: "column", md: "row" }} spacing={1.5}>
          <TextField
            label="Low Priority Max Cases"
            name="lowPriorityMaxCases"
            type="number"
            value={form.lowPriorityMaxCases}
            onChange={handleChange}
            size="small"
            fullWidth
            inputProps={{ min: 1 }}
            required
          />
          <TextField
            label="Medium Priority Max Cases"
            name="mediumPriorityMaxCases"
            type="number"
            value={form.mediumPriorityMaxCases}
            onChange={handleChange}
            size="small"
            fullWidth
            inputProps={{ min: 1 }}
            required
          />
        </Stack>

        <Stack direction={{ xs: "column", lg: "row" }} spacing={1.5}>
          <TextField
            label="Diseases"
            name="diseaseList"
            value={form.diseaseList}
            onChange={handleChange}
            size="small"
            fullWidth
            required
            multiline
            minRows={6}
            helperText="One disease per line"
          />
          <TextField
            label="Facilities"
            name="facilityList"
            value={form.facilityList}
            onChange={handleChange}
            size="small"
            fullWidth
            required
            multiline
            minRows={6}
            helperText="One facility per line"
          />
          <TextField
            label="Report Sources"
            name="reportSourceList"
            value={form.reportSourceList}
            onChange={handleChange}
            size="small"
            fullWidth
            required
            multiline
            minRows={6}
            helperText="One source per line"
          />
        </Stack>

        <Button
          type="submit"
          variant="contained"
          startIcon={<SaveIcon />}
          disabled={saving}
          sx={{ alignSelf: "flex-start", bgcolor: "#0f766e", fontWeight: 900, "&:hover": { bgcolor: "#115e59" } }}
        >
          {saving ? "Saving Settings..." : "Save Organization Settings"}
        </Button>
      </Stack>
    </Box>
  );
}
