import React, { useEffect, useState } from "react";
import axios from "axios";
import {
  Box,
  TextField,
  Button,
  Alert,
  CircularProgress,
  MenuItem,
  Stack,
  Divider,
  Typography,
} from "@mui/material";
import AddLocationAltIcon from "@mui/icons-material/AddLocationAlt";

const API_URL = process.env.REACT_APP_API_URL || "http://localhost:5000";
const DISEASE_OPTIONS = ["COVID-19", "Influenza", "Measles", "Norovirus", "Malaria", "Cholera", "Dengue"];
const STATUS_OPTIONS = ["New", "Under Review", "Confirmed", "Rejected", "Closed"];
const PRIORITY_OPTIONS = ["Low", "Medium", "High"];
const REPORT_SOURCE_OPTIONS = ["Field report", "Clinic report", "Hospital report", "Laboratory report", "Community report", "School report", "Facility report", "Self report"];
const AGE_GROUP_OPTIONS = ["Unknown", "0-4", "5-17", "18-49", "50-64", "65+"];
const SEX_OPTIONS = ["Unknown", "Female", "Male", "Other"];

export default function AddCaseForm({ onCaseAdded }) {
  const [form, setForm] = useState({
    disease: "",
    location: "",
    cases: 1,
    latitude: "",
    longitude: "",
    date: "",
    status: "New",
    priority: "Medium",
    ageGroup: "Unknown",
    sex: "Unknown",
    symptomOnsetDate: "",
    facility: "",
    suspectedExposure: "",
    reportSource: "Field report",
    notes: "",
  });
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(null);

  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setForm((prev) => ({
          ...prev,
          latitude: position.coords.latitude.toFixed(6),
          longitude: position.coords.longitude.toFixed(6),
        }));
      },
      (error) => console.warn("Geolocation error:", error)
    );
  }, []);

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setStatus(null);

    const getCurrentPosition = () =>
      new Promise((resolve, reject) =>
        navigator.geolocation
          ? navigator.geolocation.getCurrentPosition(resolve, reject)
          : reject(new Error("Geolocation not supported"))
      );

    try {
      let lat = parseFloat(form.latitude);
      let lng = parseFloat(form.longitude);

      if (navigator.geolocation) {
        try {
          const position = await getCurrentPosition();
          lat = position.coords.latitude;
          lng = position.coords.longitude;
        } catch {
          // fall back to manually entered values
        }
      }

      await axios.post(`${API_URL}/api/cases`, {
        ...form,
        latitude: lat,
        longitude: lng,
        cases: Number(form.cases),
      });

      setStatus({ type: "success", message: "Case reported successfully!" });
      setForm((prev) => ({
        ...prev,
        disease: "",
        location: "",
        cases: 1,
        date: "",
        status: "New",
        priority: "Medium",
        ageGroup: "Unknown",
        sex: "Unknown",
        symptomOnsetDate: "",
        facility: "",
        suspectedExposure: "",
        reportSource: "Field report",
        notes: "",
      }));
      if (onCaseAdded) onCaseAdded();
    } catch (err) {
      const msg =
        err.response?.data?.errors?.[0]?.msg ||
        err.response?.data?.error ||
        "Failed to add case. Please try again.";
      setStatus({ type: "error", message: msg });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box
      component="form"
      onSubmit={handleSubmit}
      sx={{
        display: "flex",
        flexDirection: "column",
        gap: 1.5,
        mt: 1,
        "& .MuiOutlinedInput-root": {
          borderRadius: 2,
          bgcolor: "white",
        },
      }}
    >
      {status && (
        <Alert severity={status.type} onClose={() => setStatus(null)} sx={{ fontSize: "0.8rem" }}>
          {status.message}
        </Alert>
      )}

      <TextField
        select
        label="Disease"
        name="disease"
        value={form.disease}
        onChange={handleChange}
        size="small"
        required
        fullWidth
      >
        {DISEASE_OPTIONS.map((disease) => (
          <MenuItem key={disease} value={disease}>{disease}</MenuItem>
        ))}
      </TextField>
      <TextField
        label="Location"
        name="location"
        value={form.location}
        onChange={handleChange}
        size="small"
        required
        fullWidth
        placeholder="City, state or facility name"
        helperText="Use a clear place name, for example Madison, WI or Banjul, The Gambia"
      />
      <TextField
        label="Case Count"
        name="cases"
        type="number"
        value={form.cases}
        onChange={handleChange}
        size="small"
        required
        fullWidth
        inputProps={{ min: 1 }}
      />
      <Divider sx={{ my: 0.5 }} />
      <Typography variant="subtitle2" fontWeight={900} color="#102a2c" sx={{ textTransform: "uppercase" }}>
        Epidemiology Details
      </Typography>
      <Stack direction="row" spacing={1.2}>
        <TextField
          select
          label="Age Group"
          name="ageGroup"
          value={form.ageGroup}
          onChange={handleChange}
          size="small"
          fullWidth
        >
          {AGE_GROUP_OPTIONS.map((ageGroup) => (
            <MenuItem key={ageGroup} value={ageGroup}>{ageGroup}</MenuItem>
          ))}
        </TextField>
        <TextField
          select
          label="Sex"
          name="sex"
          value={form.sex}
          onChange={handleChange}
          size="small"
          fullWidth
        >
          {SEX_OPTIONS.map((sex) => (
            <MenuItem key={sex} value={sex}>{sex}</MenuItem>
          ))}
        </TextField>
      </Stack>
      <Stack direction="row" spacing={1.2}>
        <TextField
          label="Symptom Onset"
          name="symptomOnsetDate"
          type="date"
          value={form.symptomOnsetDate}
          onChange={handleChange}
          size="small"
          fullWidth
          InputLabelProps={{ shrink: true }}
        />
        <TextField
          label="Facility"
          name="facility"
          value={form.facility}
          onChange={handleChange}
          size="small"
          fullWidth
          placeholder="Clinic, school, hospital"
        />
      </Stack>
      <Stack direction="row" spacing={1.2}>
        <TextField
          select
          label="Status"
          name="status"
          value={form.status}
          onChange={handleChange}
          size="small"
          required
          fullWidth
        >
          {STATUS_OPTIONS.map((status) => (
            <MenuItem key={status} value={status}>{status}</MenuItem>
          ))}
        </TextField>
        <TextField
          select
          label="Priority"
          name="priority"
          value={form.priority}
          onChange={handleChange}
          size="small"
          required
          fullWidth
        >
          {PRIORITY_OPTIONS.map((priority) => (
            <MenuItem key={priority} value={priority}>{priority}</MenuItem>
          ))}
        </TextField>
      </Stack>
      <TextField
        select
        label="Source"
        name="reportSource"
        value={form.reportSource}
        onChange={handleChange}
        size="small"
        required
        fullWidth
      >
        {REPORT_SOURCE_OPTIONS.map((source) => (
          <MenuItem key={source} value={source}>{source}</MenuItem>
        ))}
      </TextField>
      <TextField
        label="Suspected Exposure"
        name="suspectedExposure"
        value={form.suspectedExposure}
        onChange={handleChange}
        size="small"
        fullWidth
        multiline
        minRows={2}
        inputProps={{ maxLength: 1000 }}
        placeholder="Possible event, travel, facility exposure, or known contact"
      />
      <Divider sx={{ my: 0.5 }} />
      <Typography variant="subtitle2" fontWeight={900} color="#102a2c" sx={{ textTransform: "uppercase" }}>
        Location and Report Date
      </Typography>
      <Stack direction="row" spacing={1.2}>
        <TextField
          label="Latitude"
          name="latitude"
          value={form.latitude}
          onChange={handleChange}
          size="small"
          required
          fullWidth
        />
        <TextField
          label="Longitude"
          name="longitude"
          value={form.longitude}
          onChange={handleChange}
          size="small"
          required
          fullWidth
        />
      </Stack>
      <TextField
        label="Date"
        name="date"
        type="date"
        value={form.date}
        onChange={handleChange}
        size="small"
        required
        fullWidth
        InputLabelProps={{ shrink: true }}
      />
      <TextField
        label="Notes"
        name="notes"
        value={form.notes}
        onChange={handleChange}
        size="small"
        fullWidth
        multiline
        minRows={2}
        inputProps={{ maxLength: 1000 }}
        placeholder="Brief context, verification notes, or response action"
      />

      <Button
        type="submit"
        variant="contained"
        color="primary"
        disabled={loading}
        startIcon={loading ? <CircularProgress size={16} color="inherit" /> : <AddLocationAltIcon />}
        fullWidth
        sx={{
          py: 1.2,
          borderRadius: 2,
          fontWeight: 900,
          boxShadow: "0 12px 24px rgba(15, 118, 110, 0.24)",
          bgcolor: "#0f766e",
          "&:hover": { bgcolor: "#115e59" },
        }}
      >
        {loading ? "Submitting…" : "Report Case"}
      </Button>
    </Box>
  );
}
