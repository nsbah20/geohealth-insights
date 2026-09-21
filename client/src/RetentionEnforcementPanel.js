import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  LinearProgress,
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
import DeleteSweepIcon from "@mui/icons-material/DeleteSweep";
import PolicyIcon from "@mui/icons-material/Policy";
import { authHeaders, getAdminToken } from "./auth";

const API_URL = process.env.REACT_APP_API_URL || "http://localhost:5000";

function formatDate(value) {
  if (!value) return "Not recorded";
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function RunStatus({ status }) {
  const color = status === "Executed" ? "success" : status === "Previewed" ? "warning" : "default";
  return <Chip size="small" label={status} color={color} sx={{ fontWeight: 900 }} />;
}

export default function RetentionEnforcementPanel({ authUser, onChanged }) {
  const [preview, setPreview] = useState(null);
  const [history, setHistory] = useState([]);
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(false);
  const canAdmin = Boolean(authUser?.canAdmin);

  const loadHistory = useCallback(async () => {
    if (!canAdmin) {
      setHistory([]);
      return;
    }
    try {
      const res = await axios.get(`${API_URL}/api/admin/retention/runs`, {
        headers: authHeaders(getAdminToken()),
      });
      setHistory(res.data);
    } catch (err) {
      setMessage({ type: "error", text: err.response?.data?.error || "Unable to load retention history." });
    }
  }, [canAdmin]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const createPreview = async () => {
    setLoading(true);
    setMessage(null);
    setConfirmation("");
    try {
      const res = await axios.post(
        `${API_URL}/api/admin/retention/preview`,
        {},
        { headers: authHeaders(getAdminToken()) }
      );
      setPreview(res.data);
      setMessage({
        type: res.data.plannedCount > 0 ? "warning" : "success",
        text: res.data.plannedCount > 0
          ? `${res.data.plannedCount} closed or rejected records are eligible for this disposal batch.`
          : "No records currently meet the retention policy criteria.",
      });
      await loadHistory();
      onChanged?.();
    } catch (err) {
      setMessage({ type: "error", text: err.response?.data?.error || "Unable to create a retention preview." });
    } finally {
      setLoading(false);
    }
  };

  const executeDisposal = async () => {
    if (!preview?._id) return;
    setLoading(true);
    setMessage(null);
    try {
      const res = await axios.post(
        `${API_URL}/api/admin/retention/${preview._id}/execute`,
        { confirmation },
        { headers: authHeaders(getAdminToken()) }
      );
      setPreview(res.data);
      setConfirmation("");
      setMessage({
        type: "success",
        text: `${res.data.deletedCount} records were disposed and the evidence was added to the audit trail.`,
      });
      await loadHistory();
      onChanged?.();
    } catch (err) {
      setMessage({ type: "error", text: err.response?.data?.error || "Unable to execute this disposal." });
    } finally {
      setLoading(false);
    }
  };

  if (!canAdmin) {
    return <Alert severity="warning">Administrator access is required to manage retention disposal.</Alert>;
  }

  const confirmationMatches = preview?.confirmationText && confirmation === preview.confirmationText;

  return (
    <Stack spacing={2}>
      {message && <Alert severity={message.type}>{message.text}</Alert>}
      {loading && <LinearProgress />}

      <Alert severity="info">
        Only Closed or Rejected records older than the configured retention period qualify. Each preview expires after 15 minutes and can dispose of at most 500 records.
      </Alert>

      <Box>
        <Button
          variant="contained"
          startIcon={<PolicyIcon />}
          onClick={createPreview}
          disabled={loading}
          sx={{ bgcolor: "#0f766e", fontWeight: 900 }}
        >
          Check Eligible Records
        </Button>
      </Box>

      {preview && (
        <Box>
          <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" alignItems={{ xs: "flex-start", md: "center" }} spacing={1}>
            <Box>
              <Typography variant="subtitle1" fontWeight={900} color="#102a2c">
                Retention preview
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {preview.policyDays} day policy | cutoff {formatDate(preview.cutoffDate)} | expires {formatDate(preview.expiresAt)}
              </Typography>
            </Box>
            <RunStatus status={preview.status} />
          </Stack>

          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ my: 1.5 }}>
            <Chip label={`${preview.eligibleCount} eligible`} />
            <Chip label={`${preview.plannedCount} in this batch`} color={preview.plannedCount ? "warning" : "success"} />
            {preview.deferredCount > 0 && <Chip label={`${preview.deferredCount} deferred`} />}
            <Chip label={`${preview.statusBreakdown?.Closed || 0} closed`} />
            <Chip label={`${preview.statusBreakdown?.Rejected || 0} rejected`} />
          </Stack>

          {preview.sample?.length > 0 && (
            <TableContainer sx={{ border: "1px solid rgba(15, 23, 42, 0.1)", maxHeight: 320 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell>Disease</TableCell>
                    <TableCell>Location</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Report Date</TableCell>
                    <TableCell>Last Updated</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {preview.sample.map((item) => (
                    <TableRow key={item._id}>
                      <TableCell>{item.disease}</TableCell>
                      <TableCell>{item.location}</TableCell>
                      <TableCell>{item.status}</TableCell>
                      <TableCell>{item.reportDate}</TableCell>
                      <TableCell>{formatDate(item.lastUpdated)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}

          {preview.status === "Previewed" && preview.plannedCount > 0 && (
            <Stack spacing={1.2} sx={{ mt: 1.5, maxWidth: 560 }}>
              <TextField
                label={`Type ${preview.confirmationText} to confirm`}
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                size="small"
                fullWidth
              />
              <Box>
                <Button
                  variant="contained"
                  color="error"
                  startIcon={<DeleteSweepIcon />}
                  onClick={executeDisposal}
                  disabled={loading || !confirmationMatches}
                  sx={{ fontWeight: 900 }}
                >
                  Dispose Previewed Records
                </Button>
              </Box>
            </Stack>
          )}
        </Box>
      )}

      {history.length > 0 && (
        <Box>
          <Divider sx={{ mb: 1.5 }} />
          <Typography variant="subtitle2" fontWeight={900} color="#102a2c" sx={{ mb: 1 }}>
            Recent Retention Activity
          </Typography>
          <Stack spacing={0.8}>
            {history.slice(0, 5).map((run) => (
              <Stack key={run._id} direction={{ xs: "column", sm: "row" }} justifyContent="space-between" alignItems={{ xs: "flex-start", sm: "center" }} spacing={1} sx={{ py: 0.8, borderBottom: "1px solid rgba(15, 23, 42, 0.08)" }}>
                <Box>
                  <Typography variant="body2" fontWeight={800}>
                    {run.status === "Executed" ? `${run.deletedCount} records disposed` : `${run.plannedCount} records previewed`}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {run.previewedBy} | {run.policyDays} day policy | {formatDate(run.executedAt || run.createdAt)}
                  </Typography>
                </Box>
                <RunStatus status={run.status} />
              </Stack>
            ))}
          </Stack>
        </Box>
      )}
    </Stack>
  );
}
