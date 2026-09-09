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
  Stack,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import demoData from "./demoData";

const API_URL = process.env.REACT_APP_API_URL || "http://localhost:5000";
const SHOW_DEMO_BY_DEFAULT = process.env.NODE_ENV !== "production";

const PRIORITY_COLORS = {
  High: "error",
  Medium: "warning",
  Low: "success",
};

const STATUS_COLORS = {
  New: "warning",
  "Under Review": "info",
  Confirmed: "success",
  Rejected: "default",
  Closed: "default",
};

function getPriority(item) {
  if (item.priority) return item.priority;
  if (item.cases >= 50) return "High";
  if (item.cases >= 20) return "Medium";
  return "Low";
}

function formatDate(value) {
  if (!value) return "Unknown";
  return parseDateValue(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function parseDateValue(value) {
  if (value instanceof Date) return value;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    const [year, month, day] = value.slice(0, 10).split("-").map(Number);
    return new Date(year, month - 1, day);
  }
  return new Date(value);
}

export default function CasesTable() {
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    axios
      .get(`${API_URL}/api/health-data`)
      .then((res) => setCases(SHOW_DEMO_BY_DEFAULT ? [...res.data, ...demoData] : res.data))
      .catch(() => {
        setCases(demoData);
        setError(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const filtered = cases.filter(
    (c) =>
      c.disease?.toLowerCase().includes(search.toLowerCase()) ||
      c.location?.toLowerCase().includes(search.toLowerCase()) ||
      c.status?.toLowerCase().includes(search.toLowerCase()) ||
      c.priority?.toLowerCase().includes(search.toLowerCase()) ||
      c.reportSource?.toLowerCase().includes(search.toLowerCase()) ||
      c.notes?.toLowerCase().includes(search.toLowerCase())
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
    <Box sx={{ minHeight: "calc(100vh - 72px)", bgcolor: "#eef4f2", p: 3 }}>
      <Stack
        direction={{ xs: "column", md: "row" }}
        alignItems={{ xs: "stretch", md: "center" }}
        justifyContent="space-between"
        spacing={2}
        sx={{ mb: 2.5 }}
      >
        <Box>
          <Typography variant="h4" fontWeight={900} color="#102a2c">
            Disease Case Registry
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Search, review, and triage submitted surveillance records.
          </Typography>
        </Box>

        <TextField
          placeholder="Search by disease or location..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          size="small"
          sx={{
            width: { xs: "100%", md: 360 },
            "& .MuiOutlinedInput-root": {
              borderRadius: 2,
              bgcolor: "white",
              boxShadow: "0 10px 24px rgba(15, 23, 42, 0.06)",
            },
          }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
          }}
        />
      </Stack>

      <TableContainer
        component={Paper}
        elevation={0}
        sx={{
          borderRadius: 2,
          border: "1px solid rgba(15, 23, 42, 0.08)",
          boxShadow: "0 22px 55px rgba(15, 23, 42, 0.10)",
          overflow: "hidden",
        }}
      >
        <Table size="small">
          <TableHead>
            <TableRow sx={{ "& th": { fontWeight: 900, bgcolor: "#082f2f", color: "white", py: 1.5 } }}>
              <TableCell>#</TableCell>
              <TableCell>Disease</TableCell>
              <TableCell>Location</TableCell>
              <TableCell align="right">Cases</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Priority</TableCell>
              <TableCell>Source</TableCell>
              <TableCell>Notes</TableCell>
              <TableCell>Date</TableCell>
              <TableCell align="right">Lat</TableCell>
              <TableCell align="right">Lng</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={11} align="center">
                  No cases found.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((c, i) => {
                const priority = getPriority(c);
                const status = c.status || "New";
                return (
                  <TableRow
                    key={c._id || i}
                    hover
                    sx={{
                      "&:nth-of-type(even)": { bgcolor: "#f8fbfa" },
                      "& td": { borderColor: "rgba(15, 23, 42, 0.06)" },
                    }}
                  >
                    <TableCell>{i + 1}</TableCell>
                    <TableCell>
                      <Typography variant="body2" fontWeight={800}>
                        {c.disease}
                      </Typography>
                    </TableCell>
                    <TableCell>{c.location}</TableCell>
                    <TableCell align="right">{c.cases}</TableCell>
                    <TableCell>
                      <Chip
                        label={status}
                        color={STATUS_COLORS[status] || "default"}
                        size="small"
                        sx={{ fontWeight: 800 }}
                      />
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={priority}
                        color={PRIORITY_COLORS[priority] || "default"}
                        size="small"
                        sx={{ fontWeight: 800 }}
                      />
                    </TableCell>
                    <TableCell>{c.reportSource || "Field report"}</TableCell>
                    <TableCell sx={{ maxWidth: 280 }}>
                      <Typography variant="body2" color="text.secondary" noWrap>
                        {c.notes || "No notes"}
                      </Typography>
                    </TableCell>
                    <TableCell>{formatDate(c.date)}</TableCell>
                    <TableCell align="right">{Number(c.lat).toFixed(4)}</TableCell>
                    <TableCell align="right">{Number(c.lng).toFixed(4)}</TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5, fontWeight: 600 }}>
        Showing {filtered.length} of {cases.length} records
      </Typography>
    </Box>
  );
}
