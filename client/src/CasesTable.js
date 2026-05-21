import React, { useEffect, useState } from "react";
import axios from "axios";
import {
  Box,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  CircularProgress,
  Alert,
  TextField,
  InputAdornment,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";

const API_URL = process.env.REACT_APP_API_URL || "http://localhost:5000";

const SEVERITY_COLORS = {
  high: "error",
  medium: "warning",
  low: "success",
};

function getSeverity(count) {
  if (count > 100) return "high";
  if (count > 50) return "medium";
  return "low";
}

export default function CasesTable() {
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    axios
      .get(`${API_URL}/api/health-data`)
      .then((res) => setCases(res.data))
      .catch(() => setError("Failed to load cases."))
      .finally(() => setLoading(false));
  }, []);

  const filtered = cases.filter(
    (c) =>
      c.disease.toLowerCase().includes(search.toLowerCase()) ||
      c.location.toLowerCase().includes(search.toLowerCase())
  );

  if (loading)
    return (
      <Box sx={{ display: "flex", justifyContent: "center", mt: 8 }}>
        <CircularProgress />
      </Box>
    );

  if (error)
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{error}</Alert>
      </Box>
    );

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h5" fontWeight={700} gutterBottom>
        All Disease Cases
      </Typography>

      <TextField
        placeholder="Search by disease or location…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        size="small"
        sx={{ mb: 2, width: 320 }}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon fontSize="small" />
            </InputAdornment>
          ),
        }}
      />

      <TableContainer component={Paper} elevation={2}>
        <Table size="small">
          <TableHead>
            <TableRow sx={{ "& th": { fontWeight: 700, bgcolor: "primary.main", color: "white" } }}>
              <TableCell>#</TableCell>
              <TableCell>Disease</TableCell>
              <TableCell>Location</TableCell>
              <TableCell align="right">Cases</TableCell>
              <TableCell>Severity</TableCell>
              <TableCell>Date</TableCell>
              <TableCell align="right">Lat</TableCell>
              <TableCell align="right">Lng</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} align="center">
                  No cases found.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((c, i) => {
                const sev = getSeverity(c.cases);
                return (
                  <TableRow key={c._id || i} hover>
                    <TableCell>{i + 1}</TableCell>
                    <TableCell>{c.disease}</TableCell>
                    <TableCell>{c.location}</TableCell>
                    <TableCell align="right">{c.cases}</TableCell>
                    <TableCell>
                      <Chip
                        label={sev.charAt(0).toUpperCase() + sev.slice(1)}
                        color={SEVERITY_COLORS[sev]}
                        size="small"
                      />
                    </TableCell>
                    <TableCell>{c.date}</TableCell>
                    <TableCell align="right">{Number(c.lat).toFixed(4)}</TableCell>
                    <TableCell align="right">{Number(c.lng).toFixed(4)}</TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
        Showing {filtered.length} of {cases.length} records
      </Typography>
    </Box>
  );
}
