import React, { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import Papa from "papaparse";
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
  Typography,
} from "@mui/material";
import BlockIcon from "@mui/icons-material/Block";
import DownloadIcon from "@mui/icons-material/Download";
import PublishIcon from "@mui/icons-material/Publish";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import { authHeaders, getAdminToken } from "./auth";

const API_URL = process.env.REACT_APP_API_URL || "http://localhost:5000";
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_ROWS = 500;
const TEMPLATE_HEADERS = [
  "external_id",
  "disease",
  "location",
  "latitude",
  "longitude",
  "cases",
  "report_date",
  "age_group",
  "sex",
  "facility",
  "report_source",
  "notes",
];

function normalizeHeader(header = "") {
  return String(header)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function formatDateTime(value) {
  if (!value) return "Not recorded";
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function BatchStatus({ status }) {
  const color = status === "Imported" ? "success" : status === "Rejected" ? "default" : "warning";
  return <Chip size="small" label={status} color={color} sx={{ fontWeight: 900 }} />;
}

export default function CaseImportPanel({ authUser, onChanged }) {
  const inputRef = useRef(null);
  const [batch, setBatch] = useState(null);
  const [history, setHistory] = useState([]);
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(false);
  const canImport = Boolean(authUser?.canImport);

  const loadHistory = useCallback(async () => {
    if (!canImport) {
      setHistory([]);
      return;
    }
    try {
      const res = await axios.get(`${API_URL}/api/admin/imports`, { headers: authHeaders(getAdminToken()) });
      setHistory(res.data);
    } catch (err) {
      setMessage({ type: "error", text: err.response?.data?.error || "Unable to load import history." });
    }
  }, [canImport]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const downloadTemplate = () => {
    const blob = new Blob([`${TEMPLATE_HEADERS.join(",")}\n`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "geohealth-case-import-template.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const stageFile = (file) => {
    if (!file) return;
    setMessage(null);
    setBatch(null);

    if (!file.name.toLowerCase().endsWith(".csv")) {
      setMessage({ type: "error", text: "Choose a CSV file created from the approved template." });
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setMessage({ type: "error", text: "CSV files must be 1 MB or smaller." });
      return;
    }

    setLoading(true);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: normalizeHeader,
      complete: async (results) => {
        try {
          const seriousParseError = results.errors.find((error) => error.code !== "UndetectableDelimiter");
          if (seriousParseError) throw new Error(`CSV parsing failed near row ${seriousParseError.row + 2}: ${seriousParseError.message}`);
          if (results.data.length > MAX_ROWS) throw new Error(`A single import can contain at most ${MAX_ROWS} rows.`);

          const res = await axios.post(
            `${API_URL}/api/admin/imports/preview`,
            { filename: file.name, rows: results.data },
            { headers: authHeaders(getAdminToken()) }
          );
          setBatch(res.data);
          setMessage({ type: "success", text: `${file.name} is staged for review.` });
          await loadHistory();
          onChanged?.();
        } catch (err) {
          setMessage({ type: "error", text: err.response?.data?.error || err.message || "Unable to stage this CSV file." });
        } finally {
          setLoading(false);
          if (inputRef.current) inputRef.current.value = "";
        }
      },
      error: (err) => {
        setLoading(false);
        setMessage({ type: "error", text: err.message || "Unable to read this CSV file." });
        if (inputRef.current) inputRef.current.value = "";
      },
    });
  };

  const updateBatchStatus = async (action) => {
    if (!batch?._id) return;
    setLoading(true);
    setMessage(null);
    try {
      const res = await axios.post(
        `${API_URL}/api/admin/imports/${batch._id}/${action}`,
        {},
        { headers: authHeaders(getAdminToken()) }
      );
      setBatch(res.data);
      setMessage({
        type: action === "publish" ? "success" : "info",
        text: action === "publish"
          ? `${res.data.importedRows} validated records were published for case review.`
          : "The staged import was rejected.",
      });
      await loadHistory();
      onChanged?.();
    } catch (err) {
      setMessage({ type: "error", text: err.response?.data?.error || `Unable to ${action} this batch.` });
    } finally {
      setLoading(false);
    }
  };

  const previewRows = batch?.rows
    ? [...batch.rows].sort((left, right) => {
      const leftIssue = left.errors.length > 0 || left.duplicate ? 0 : 1;
      const rightIssue = right.errors.length > 0 || right.duplicate ? 0 : 1;
      return leftIssue - rightIssue || left.rowNumber - right.rowNumber;
    }).slice(0, 12)
    : [];

  if (!canImport) {
    return <Alert severity="warning">Administrator or Data Manager access is required for institutional case imports.</Alert>;
  }

  return (
    <Stack spacing={2}>
      {message && <Alert severity={message.type}>{message.text}</Alert>}
      {loading && <LinearProgress />}

      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.2}>
        <Button variant="contained" startIcon={<UploadFileIcon />} onClick={() => inputRef.current?.click()} disabled={loading} sx={{ bgcolor: "#0f766e", fontWeight: 900 }}>
          Choose CSV
        </Button>
        <Button variant="outlined" startIcon={<DownloadIcon />} onClick={downloadTemplate} sx={{ fontWeight: 900 }}>
          Download Template
        </Button>
        <input ref={inputRef} type="file" accept=".csv,text/csv" hidden onChange={(event) => stageFile(event.target.files?.[0])} />
      </Stack>

      <Alert severity="info">
        CSV batches remain staged until approved. Imported records start as New and require location review before confirmation.
      </Alert>

      {batch && (
        <Box>
          <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" alignItems={{ xs: "flex-start", md: "center" }} spacing={1.5}>
            <Box>
              <Typography variant="subtitle1" fontWeight={900} color="#102a2c">{batch.filename}</Typography>
              <Typography variant="caption" color="text.secondary">Staged {formatDateTime(batch.createdAt)}</Typography>
            </Box>
            <BatchStatus status={batch.status} />
          </Stack>

          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ my: 1.5 }}>
            <Chip label={`${batch.totalRows} total`} />
            <Chip label={`${batch.validRows} ready`} color="success" />
            <Chip label={`${batch.invalidRows} invalid`} color={batch.invalidRows ? "error" : "default"} />
            <Chip label={`${batch.duplicateRows} duplicate`} color={batch.duplicateRows ? "warning" : "default"} />
          </Stack>

          {previewRows.length > 0 && (
            <TableContainer sx={{ border: "1px solid rgba(15, 23, 42, 0.1)", maxHeight: 360 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell>Row</TableCell>
                    <TableCell>Disease</TableCell>
                    <TableCell>Location</TableCell>
                    <TableCell>Report Date</TableCell>
                    <TableCell>Validation</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {previewRows.map((row) => (
                    <TableRow key={row.rowNumber}>
                      <TableCell>{row.rowNumber}</TableCell>
                      <TableCell>{row.disease || "Not recognized"}</TableCell>
                      <TableCell>{row.location || "Missing"}</TableCell>
                      <TableCell>{row.date || "Missing"}</TableCell>
                      <TableCell sx={{ minWidth: 220 }}>
                        {row.duplicate
                          ? <Chip size="small" label="Duplicate" color="warning" />
                          : row.errors.length > 0
                            ? <Typography variant="caption" color="error">{row.errors.join("; ")}</Typography>
                            : <Chip size="small" label="Ready" color="success" />}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}

          {batch.status === "Staged" && (
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.2} sx={{ mt: 1.5 }}>
              <Button variant="contained" startIcon={<PublishIcon />} onClick={() => updateBatchStatus("publish")} disabled={loading || batch.validRows === 0} sx={{ bgcolor: "#0f766e", fontWeight: 900 }}>
                Publish {batch.validRows} Valid Rows
              </Button>
              <Button variant="outlined" color="error" startIcon={<BlockIcon />} onClick={() => updateBatchStatus("reject")} disabled={loading} sx={{ fontWeight: 900 }}>
                Reject Batch
              </Button>
            </Stack>
          )}
        </Box>
      )}

      {history.length > 0 && (
        <Box>
          <Divider sx={{ mb: 1.5 }} />
          <Typography variant="subtitle2" fontWeight={900} color="#102a2c" sx={{ mb: 1 }}>Recent Import Batches</Typography>
          <Stack spacing={0.8}>
            {history.slice(0, 5).map((item) => (
              <Stack key={item._id} direction={{ xs: "column", sm: "row" }} justifyContent="space-between" alignItems={{ xs: "flex-start", sm: "center" }} spacing={1} sx={{ py: 0.8, borderBottom: "1px solid rgba(15, 23, 42, 0.08)" }}>
                <Box>
                  <Typography variant="body2" fontWeight={800}>{item.filename}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {item.uploadedBy} | {item.totalRows} rows | {formatDateTime(item.createdAt)}
                  </Typography>
                </Box>
                <BatchStatus status={item.status} />
              </Stack>
            ))}
          </Stack>
        </Box>
      )}
    </Stack>
  );
}
