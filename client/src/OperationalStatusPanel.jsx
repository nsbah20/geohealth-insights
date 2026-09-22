import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import {
  Alert,
  Box,
  Button,
  Chip,
  LinearProgress,
  Stack,
  Typography,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import { authHeaders, getAdminToken } from "./auth";

const API_URL = import.meta.env.VITE_API_URL || import.meta.env.REACT_APP_API_URL || "http://localhost:5000";
const REFRESH_INTERVAL_MS = 60 * 1000;

function formatUptime(seconds) {
  const totalMinutes = Math.floor((seconds || 0) / 60);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function StatusItem({ label, value, healthy, detail }) {
  return (
    <Box sx={{ border: "1px solid rgba(15, 23, 42, 0.12)", borderRadius: 1, p: 1.5, minWidth: 0 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
        <Typography variant="subtitle2" fontWeight={900} color="#102a2c">
          {label}
        </Typography>
        <Chip size="small" label={value} color={healthy ? "success" : "warning"} />
      </Stack>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.8 }}>
        {detail}
      </Typography>
    </Box>
  );
}

export default function OperationalStatusPanel({ authUser, loadOnMount = true }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const canAdmin = Boolean(authUser?.canAdmin);

  const loadStatus = useCallback(async () => {
    if (!canAdmin) return;
    setLoading(true);
    setError("");
    try {
      const response = await axios.get(`${API_URL}/api/admin/operations/status`, {
        headers: authHeaders(getAdminToken()),
      });
      setStatus(response.data);
    } catch (err) {
      const degradedStatus = err.response?.data;
      setStatus(degradedStatus?.status ? degradedStatus : null);
      setError(degradedStatus?.status ? "" : degradedStatus?.error || "Operational status could not be confirmed.");
    } finally {
      setLoading(false);
    }
  }, [canAdmin]);

  useEffect(() => {
    if (!loadOnMount) return undefined;
    loadStatus();
    if (!canAdmin) return undefined;
    const interval = window.setInterval(loadStatus, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [canAdmin, loadOnMount, loadStatus]);

  if (!canAdmin) {
    return <Alert severity="warning">Administrator access is required to view operational status.</Alert>;
  }

  const databaseReady = status?.database?.status === "ready";
  const emailReady = Boolean(status?.configuration?.transactionalEmail);
  const sessionSecretReady = Boolean(status?.configuration?.dedicatedSessionSecret);

  return (
    <Stack spacing={1.5}>
      {loading && <LinearProgress />}
      {error && <Alert severity="error">{error}</Alert>}
      {status && (
        <Alert severity={status.status === "Operational" ? "success" : "error"}>
          System status: {status.status}. Last checked {new Date(status.checkedAt).toLocaleString()}.
        </Alert>
      )}

      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", lg: "repeat(4, 1fr)" }, gap: 1.2 }}>
        <StatusItem
          label="Database"
          value={databaseReady ? "Ready" : "Unavailable"}
          healthy={databaseReady}
          detail={databaseReady ? `${status.database.latencyMs} ms response` : "No successful database ping"}
        />
        <StatusItem
          label="API Uptime"
          value={status ? formatUptime(status.uptimeSeconds) : "Checking"}
          healthy={Boolean(status)}
          detail={status ? `${status.runtime.environment} on ${status.runtime.nodeVersion}` : "Waiting for runtime status"}
        />
        <StatusItem
          label="Email Delivery"
          value={emailReady ? "Configured" : "Limited"}
          healthy={emailReady}
          detail={emailReady ? "Provider key and sender are present" : "Domain-based delivery is not fully configured"}
        />
        <StatusItem
          label="Session Signing"
          value={sessionSecretReady ? "Dedicated" : "Fallback"}
          healthy={sessionSecretReady}
          detail={sessionSecretReady ? "Dedicated SESSION_SECRET is active" : "Set SESSION_SECRET in the API environment"}
        />
      </Box>

      <Box>
        <Button variant="outlined" size="small" startIcon={<RefreshIcon />} onClick={loadStatus} disabled={loading} sx={{ fontWeight: 900 }}>
          Refresh Status
        </Button>
      </Box>
    </Stack>
  );
}
