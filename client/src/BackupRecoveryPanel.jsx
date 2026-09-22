import React, { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  Alert,
  Box,
  Button,
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
import BackupIcon from "@mui/icons-material/Backup";
import RestoreIcon from "@mui/icons-material/Restore";
import { authHeaders, getAdminToken } from "./auth";

const API_URL = import.meta.env.VITE_API_URL || import.meta.env.REACT_APP_API_URL || "http://localhost:5000";

function localDateTimeValue() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60 * 1000);
  return local.toISOString().slice(0, 16);
}

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

export default function BackupRecoveryPanel({ authUser, onChanged }) {
  const [status, setStatus] = useState(null);
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [backupForm, setBackupForm] = useState({
    provider: "MongoDB Atlas",
    reference: "",
    completedAt: localDateTimeValue(),
    status: "Verified",
    notes: "",
  });
  const [restoreForm, setRestoreForm] = useState({
    backupVerificationId: "",
    outcome: "Passed",
    testedAt: localDateTimeValue(),
    notes: "",
  });
  const canAdmin = Boolean(authUser?.canAdmin);

  const loadStatus = useCallback(async () => {
    if (!canAdmin) {
      setStatus(null);
      return;
    }
    try {
      const res = await axios.get(`${API_URL}/api/admin/recovery/status`, {
        headers: authHeaders(getAdminToken()),
      });
      setStatus(res.data);
      setRestoreForm((current) => ({
        ...current,
        backupVerificationId: current.backupVerificationId
          || res.data.latestBackup?._id
          || "",
      }));
    } catch (err) {
      setMessage({ type: "error", text: err.response?.data?.error || "Unable to load backup and recovery status." });
    }
  }, [canAdmin]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const verifiedBackups = useMemo(
    () => (status?.backupHistory || []).filter((item) => item.status === "Verified"),
    [status]
  );

  const submitBackup = async (event) => {
    event.preventDefault();
    setLoading(true);
    setMessage(null);
    try {
      await axios.post(
        `${API_URL}/api/admin/recovery/backups`,
        { ...backupForm, completedAt: new Date(backupForm.completedAt).toISOString() },
        { headers: authHeaders(getAdminToken()) }
      );
      setBackupForm((current) => ({
        ...current,
        reference: "",
        completedAt: localDateTimeValue(),
        notes: "",
      }));
      setMessage({ type: "success", text: "Backup evidence was recorded in the audit trail." });
      await loadStatus();
      onChanged?.();
    } catch (err) {
      const validationMessage = err.response?.data?.errors?.[0]?.msg;
      setMessage({ type: "error", text: err.response?.data?.error || validationMessage || "Unable to record backup evidence." });
    } finally {
      setLoading(false);
    }
  };

  const submitRestoreTest = async (event) => {
    event.preventDefault();
    setLoading(true);
    setMessage(null);
    try {
      await axios.post(
        `${API_URL}/api/admin/recovery/restore-tests`,
        { ...restoreForm, testedAt: new Date(restoreForm.testedAt).toISOString() },
        { headers: authHeaders(getAdminToken()) }
      );
      setRestoreForm((current) => ({
        ...current,
        testedAt: localDateTimeValue(),
        notes: "",
      }));
      setMessage({ type: "success", text: "Restore test evidence was recorded in the audit trail." });
      await loadStatus();
      onChanged?.();
    } catch (err) {
      const validationMessage = err.response?.data?.errors?.[0]?.msg;
      setMessage({ type: "error", text: err.response?.data?.error || validationMessage || "Unable to record the restore test." });
    } finally {
      setLoading(false);
    }
  };

  if (!canAdmin) {
    return <Alert severity="warning">Administrator access is required to manage backup and recovery evidence.</Alert>;
  }

  return (
    <Stack spacing={2}>
      {message && <Alert severity={message.type}>{message.text}</Alert>}
      {loading && <LinearProgress />}

      <Alert severity="warning">
        This workspace records evidence from your backup provider; it does not create a database snapshot. Record evidence only after confirming the backup or restore operation outside this app.
      </Alert>

      {status && (
        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
          <Chip
            label={status.backupCurrent ? "Backup current" : `Backup older than ${status.backupMaxAgeDays} days`}
            color={status.backupCurrent ? "success" : "warning"}
          />
          <Chip
            label={status.restoreTestCurrent ? "Restore test current" : `Restore test older than ${status.restoreTestMaxAgeDays} days`}
            color={status.restoreTestCurrent ? "success" : "warning"}
          />
          <Chip
            label={status.retentionDisposalAllowed ? "Retention safeguard satisfied" : "Retention disposal blocked"}
            color={status.retentionDisposalAllowed ? "success" : "error"}
          />
        </Stack>
      )}

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", lg: "1fr 1fr" },
          gap: 2,
        }}
      >
        <Box component="form" onSubmit={submitBackup}>
          <Typography variant="subtitle1" fontWeight={900} color="#102a2c" sx={{ mb: 1.2 }}>
            Record Backup Evidence
          </Typography>
          <Stack spacing={1.2}>
            <TextField
              select
              label="Backup Provider"
              value={backupForm.provider}
              onChange={(event) => setBackupForm({ ...backupForm, provider: event.target.value })}
              size="small"
              required
            >
              <MenuItem value="MongoDB Atlas">MongoDB Atlas</MenuItem>
              <MenuItem value="Database export">Database export</MenuItem>
              <MenuItem value="Other verified provider">Other verified provider</MenuItem>
            </TextField>
            <TextField
              label="Snapshot or Export Reference"
              value={backupForm.reference}
              onChange={(event) => setBackupForm({ ...backupForm, reference: event.target.value })}
              size="small"
              required
              inputProps={{ maxLength: 200 }}
            />
            <TextField
              label="Backup Completed"
              type="datetime-local"
              value={backupForm.completedAt}
              onChange={(event) => setBackupForm({ ...backupForm, completedAt: event.target.value })}
              size="small"
              required
              InputLabelProps={{ shrink: true }}
            />
            <TextField
              select
              label="Verification Result"
              value={backupForm.status}
              onChange={(event) => setBackupForm({ ...backupForm, status: event.target.value })}
              size="small"
            >
              <MenuItem value="Verified">Verified</MenuItem>
              <MenuItem value="Failed">Failed</MenuItem>
            </TextField>
            <TextField
              label="Evidence Notes"
              value={backupForm.notes}
              onChange={(event) => setBackupForm({ ...backupForm, notes: event.target.value })}
              size="small"
              multiline
              minRows={2}
              inputProps={{ maxLength: 1000 }}
            />
            <Box>
              <Button type="submit" variant="contained" startIcon={<BackupIcon />} disabled={loading} sx={{ bgcolor: "#0f766e", fontWeight: 900 }}>
                Record Backup Evidence
              </Button>
            </Box>
          </Stack>
        </Box>

        <Box component="form" onSubmit={submitRestoreTest}>
          <Typography variant="subtitle1" fontWeight={900} color="#102a2c" sx={{ mb: 1.2 }}>
            Record Restore Test
          </Typography>
          <Stack spacing={1.2}>
            <TextField
              select
              label="Verified Backup"
              value={restoreForm.backupVerificationId}
              onChange={(event) => setRestoreForm({ ...restoreForm, backupVerificationId: event.target.value })}
              size="small"
              required
              disabled={verifiedBackups.length === 0}
            >
              {verifiedBackups.map((item) => (
                <MenuItem key={item._id} value={item._id}>
                  {item.provider} | {item.reference} | {formatDate(item.completedAt)}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="Restore Tested"
              type="datetime-local"
              value={restoreForm.testedAt}
              onChange={(event) => setRestoreForm({ ...restoreForm, testedAt: event.target.value })}
              size="small"
              required
              InputLabelProps={{ shrink: true }}
            />
            <TextField
              select
              label="Test Outcome"
              value={restoreForm.outcome}
              onChange={(event) => setRestoreForm({ ...restoreForm, outcome: event.target.value })}
              size="small"
            >
              <MenuItem value="Passed">Passed</MenuItem>
              <MenuItem value="Failed">Failed</MenuItem>
            </TextField>
            <TextField
              label="Restore Procedure and Result"
              value={restoreForm.notes}
              onChange={(event) => setRestoreForm({ ...restoreForm, notes: event.target.value })}
              size="small"
              multiline
              minRows={4}
              required
              inputProps={{ maxLength: 1000 }}
            />
            <Box>
              <Button type="submit" variant="outlined" startIcon={<RestoreIcon />} disabled={loading || verifiedBackups.length === 0} sx={{ fontWeight: 900 }}>
                Record Restore Test
              </Button>
            </Box>
          </Stack>
        </Box>
      </Box>

      {status?.backupHistory?.length > 0 && (
        <Box>
          <Divider sx={{ mb: 1.5 }} />
          <Typography variant="subtitle2" fontWeight={900} color="#102a2c" sx={{ mb: 1 }}>
            Backup Evidence History
          </Typography>
          <TableContainer sx={{ border: "1px solid rgba(15, 23, 42, 0.1)", maxHeight: 320 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell>Completed</TableCell>
                  <TableCell>Provider</TableCell>
                  <TableCell>Reference</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Verified By</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {status.backupHistory.map((item) => (
                  <TableRow key={item._id}>
                    <TableCell>{formatDate(item.completedAt)}</TableCell>
                    <TableCell>{item.provider}</TableCell>
                    <TableCell>{item.reference}</TableCell>
                    <TableCell><Chip size="small" label={item.status} color={item.status === "Verified" ? "success" : "error"} /></TableCell>
                    <TableCell>{item.verifiedBy}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      )}
    </Stack>
  );
}
