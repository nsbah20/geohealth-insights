import React, { useEffect, useState } from "react";
import axios from "axios";
import {
  Box,
  TextField,
  Button,
  Alert,
  CircularProgress,
} from "@mui/material";
import AddLocationAltIcon from "@mui/icons-material/AddLocationAlt";

const API_URL = process.env.REACT_APP_API_URL || "http://localhost:5000";

export default function AddCaseForm({ onCaseAdded }) {
  const [form, setForm] = useState({
    disease: "",
    latitude: "",
    longitude: "",
    date: "",
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
      });

      setStatus({ type: "success", message: "Case reported successfully!" });
      setForm((prev) => ({ ...prev, disease: "", date: "" }));
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
    <Box component="form" onSubmit={handleSubmit} sx={{ display: "flex", flexDirection: "column", gap: 1.5, mt: 1 }}>
      {status && (
        <Alert severity={status.type} onClose={() => setStatus(null)} sx={{ fontSize: "0.8rem" }}>
          {status.message}
        </Alert>
      )}

      <TextField
        label="Disease"
        name="disease"
        value={form.disease}
        onChange={handleChange}
        size="small"
        required
        fullWidth
      />
      <TextField
        label="Latitude"
        name="latitude"
        value={form.latitude}
        onChange={handleChange}
        size="small"
        required
        fullWidth
        helperText="Auto-detected or enter manually"
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

      <Button
        type="submit"
        variant="contained"
        color="primary"
        disabled={loading}
        startIcon={loading ? <CircularProgress size={16} color="inherit" /> : <AddLocationAltIcon />}
        fullWidth
      >
        {loading ? "Submitting…" : "Report Case"}
      </Button>
    </Box>
  );
}
