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
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  TextField,
  InputAdornment,
  MenuItem,
  Stack,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import EditIcon from "@mui/icons-material/Edit";
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
const STATUS_OPTIONS = ["New", "Under Review", "Confirmed", "Rejected", "Closed"];
const PRIORITY_OPTIONS = ["Low", "Medium", "High"];
const REPORT_SOURCE_OPTIONS = ["Field report", "Clinic report", "Hospital report", "Laboratory report", "Community report", "School report", "Facility report", "Self report"];

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

function formatDateTime(value) {
  if (!value) return "Unknown";
  return parseDateValue(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
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
  const [selectedCase, setSelectedCase] = useState(null);
  const [editForm, setEditForm] = useState({
    status: "New",
    priority: "Medium",
    reportSource: "Field report",
    notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState(null);

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

  const openReview = (caseRecord) => {
    setSelectedCase(caseRecord);
    setEditForm({
      status: caseRecord.status || "New",
      priority: getPriority(caseRecord),
      reportSource: caseRecord.reportSource || "Field report",
      notes: caseRecord.notes || "",
    });
    setSaveMessage(null);
  };

  const closeReview = () => {
    if (saving) return;
    setSelectedCase(null);
    setSaveMessage(null);
  };

  const handleEditChange = (event) => {
    setEditForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  };

  const saveReview = async () => {
    if (!selectedCase?._id || String(selectedCase._id).startsWith("demo-")) return;
    setSaving(true);
    setSaveMessage(null);

    try {
      const res = await axios.patch(`${API_URL}/api/cases/${selectedCase._id}`, editForm);
      setCases((current) => current.map((item) => (item._id === selectedCase._id ? res.data : item)));
      setSelectedCase(res.data);
      setSaveMessage({ type: "success", text: "Case review updated." });
    } catch (err) {
      const text = err.response?.data?.errors?.[0]?.msg || err.response?.data?.error || "Unable to update this case.";
      setSaveMessage({ type: "error", text });
    } finally {
      setSaving(false);
    }
  };

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
          placeholder="Search by disease, location, status, source..."
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
              <TableCell align="right">Review</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={12} align="center">
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
                    <TableCell align="right">
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<EditIcon />}
                        onClick={() => openReview(c)}
                        disabled={String(c._id || "").startsWith("demo-")}
                        sx={{ fontWeight: 800, whiteSpace: "nowrap" }}
                      >
                        Review
                      </Button>
                    </TableCell>
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

      <Dialog open={Boolean(selectedCase)} onClose={closeReview} fullWidth maxWidth="sm">
        <DialogTitle sx={{ fontWeight: 900, color: "#102a2c" }}>
          Review Case
        </DialogTitle>
        <DialogContent dividers>
          {selectedCase && (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <Box>
                <Typography variant="subtitle1" fontWeight={900} color="#102a2c">
                  {selectedCase.disease}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {selectedCase.location} · {selectedCase.cases} reported cases · {formatDate(selectedCase.date)}
                </Typography>
              </Box>
              {saveMessage && (
                <Alert severity={saveMessage.type} sx={{ fontSize: "0.85rem" }}>
                  {saveMessage.text}
                </Alert>
              )}
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1.2}>
                <TextField
                  select
                  label="Status"
                  name="status"
                  value={editForm.status}
                  onChange={handleEditChange}
                  size="small"
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
                  value={editForm.priority}
                  onChange={handleEditChange}
                  size="small"
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
                value={editForm.reportSource}
                onChange={handleEditChange}
                size="small"
                fullWidth
              >
                {REPORT_SOURCE_OPTIONS.map((source) => (
                  <MenuItem key={source} value={source}>{source}</MenuItem>
                ))}
              </TextField>
              <TextField
                label="Review Notes"
                name="notes"
                value={editForm.notes}
                onChange={handleEditChange}
                size="small"
                fullWidth
                multiline
                minRows={4}
                inputProps={{ maxLength: 1000 }}
                placeholder="Add verification notes, follow-up action, or response context"
              />
              <Divider />
              <Box>
                <Typography variant="subtitle2" fontWeight={900} color="#102a2c" sx={{ mb: 1 }}>
                  Review History
                </Typography>
                {selectedCase.reviewHistory?.length ? (
                  <Stack spacing={1.2}>
                    {[...selectedCase.reviewHistory].reverse().map((entry, index) => (
                      <Box
                        key={entry._id || `${entry.reviewedAt}-${index}`}
                        sx={{
                          border: "1px solid rgba(15, 23, 42, 0.08)",
                          borderRadius: 2,
                          p: 1.5,
                          bgcolor: "#f8fbfa",
                        }}
                      >
                        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
                          <Typography variant="body2" fontWeight={900} color="#102a2c">
                            {entry.status || "Review update"}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {formatDateTime(entry.reviewedAt)}
                          </Typography>
                        </Stack>
                        <Typography variant="caption" color="text.secondary" display="block">
                          Priority: {entry.priority || "Unknown"} · Source: {entry.reportSource || "Field report"}
                        </Typography>
                        {entry.changedFields?.length > 0 && (
                          <Typography variant="caption" color="text.secondary" display="block">
                            Changed: {entry.changedFields.join(", ")}
                          </Typography>
                        )}
                        {entry.notes && (
                          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                            {entry.notes}
                          </Typography>
                        )}
                      </Box>
                    ))}
                  </Stack>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    No review history has been recorded yet. The first saved review will appear here.
                  </Typography>
                )}
              </Box>
            </Stack>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={closeReview} disabled={saving} sx={{ fontWeight: 800 }}>
            Close
          </Button>
          <Button
            onClick={saveReview}
            disabled={saving || !selectedCase || String(selectedCase._id || "").startsWith("demo-")}
            variant="contained"
            sx={{ bgcolor: "#0f766e", fontWeight: 900, "&:hover": { bgcolor: "#115e59" } }}
          >
            {saving ? "Saving..." : "Save Review"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
