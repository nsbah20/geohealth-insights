import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
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
  Autocomplete,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import demoData from "./demoData";
import { authHeaders, clearAdminToken, formatSessionTimeRemaining, getAdminToken, isSessionExpiringSoon, isSessionExpired } from "./auth";
import { useOrganizationSettings } from "./OrganizationSettingsContext";

const API_URL = import.meta.env.VITE_API_URL || import.meta.env.REACT_APP_API_URL || "http://localhost:5000";
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || import.meta.env.REACT_APP_MAPBOX_TOKEN;
const SHOW_DEMO_BY_DEFAULT = import.meta.env.DEV;

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
const AGE_GROUP_OPTIONS = ["Unknown", "0-4", "5-17", "18-49", "50-64", "65+"];
const SEX_OPTIONS = ["Unknown", "Female", "Male", "Other"];
const LOCATION_SOURCE_OPTIONS = ["GPS captured", "Manually entered", "Admin corrected", "Imported report"];
const LOCATION_VERIFICATION_OPTIONS = ["GPS verified", "Needs location review", "Admin corrected", "Reported remotely"];

const LOCATION_VERIFICATION_COLORS = {
  "GPS verified": "success",
  "Needs location review": "warning",
  "Admin corrected": "info",
  "Reported remotely": "default",
};

function getPriority(item, settings) {
  if (item.priority) return item.priority;
  const lowMax = Number(settings?.lowPriorityMaxCases) || 19;
  const mediumMax = Number(settings?.mediumPriorityMaxCases) || 49;
  if (item.cases <= lowMax) return "Low";
  if (item.cases <= mediumMax) return "Medium";
  return "High";
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

function getLastReview(caseRecord) {
  const history = caseRecord.reviewHistory || [];
  if (history.length === 0) return null;
  return history
    .filter((entry) => entry.reviewedAt)
    .sort((a, b) => parseDateValue(b.reviewedAt) - parseDateValue(a.reviewedAt))[0];
}

async function geocodeLocation(location) {
  if (!MAPBOX_TOKEN) {
    throw new Error("Mapbox token is not configured for location lookup.");
  }

  const query = String(location || "").trim();
  if (!query) {
    throw new Error("Enter a location before finding map coordinates.");
  }

  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?limit=1&types=place,locality,neighborhood,address,poi&access_token=${MAPBOX_TOKEN}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Location lookup failed. Try again or enter coordinates manually.");
  }

  const data = await response.json();
  const [lng, lat] = data.features?.[0]?.center || [];
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) {
    throw new Error("No map coordinates were found for that location.");
  }

  return {
    latitude: Number(lat).toFixed(6),
    longitude: Number(lng).toFixed(6),
    placeName: data.features[0].place_name,
  };
}

async function searchLocations(location) {
  if (!MAPBOX_TOKEN) return [];

  const query = String(location || "").trim();
  if (query.length < 3) return [];

  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?autocomplete=true&limit=5&types=place,locality,neighborhood,address,poi&access_token=${MAPBOX_TOKEN}`;
  const response = await fetch(url);
  if (!response.ok) return [];

  const data = await response.json();
  return (data.features || [])
    .map((feature) => {
      const [lng, lat] = feature.center || [];
      if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return null;
      return {
        id: feature.id,
        label: feature.place_name,
        latitude: Number(lat).toFixed(6),
        longitude: Number(lng).toFixed(6),
      };
    })
    .filter(Boolean);
}

function coordinatesMatch(aLat, aLng, bLat, bLng) {
  const firstLat = Number(aLat);
  const firstLng = Number(aLng);
  const secondLat = Number(bLat);
  const secondLng = Number(bLng);
  if (![firstLat, firstLng, secondLat, secondLng].every(Number.isFinite)) return false;
  return Math.abs(firstLat - secondLat) < 0.0001 && Math.abs(firstLng - secondLng) < 0.0001;
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
    location: "",
    latitude: "",
    longitude: "",
    locationSource: "GPS captured",
    locationVerification: "GPS verified",
    locationReviewReason: "",
    ageGroup: "Unknown",
    sex: "Unknown",
    symptomOnsetDate: "",
    facility: "",
    suspectedExposure: "",
    reportSource: "Field report",
    notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [findingLocation, setFindingLocation] = useState(false);
  const [locationSuggestions, setLocationSuggestions] = useState([]);
  const [loadingLocationSuggestions, setLoadingLocationSuggestions] = useState(false);
  const [saveMessage, setSaveMessage] = useState(null);
  const [adminSession, setAdminSession] = useState(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [sessionTick, setSessionTick] = useState(0);
  const { settings: organizationSettings } = useOrganizationSettings();
  const canViewRegistry = Boolean(adminSession?.canView);
  const canReview = Boolean(adminSession?.canReview);
  const canDelete = Boolean(adminSession?.canDelete);
  const sessionTimeRemaining = sessionTick >= 0 && adminSession ? formatSessionTimeRemaining(adminSession) : "";
  const sessionExpiringSoon = adminSession && isSessionExpiringSoon(adminSession);

  const reportSourceOptions = organizationSettings?.reportSourceList?.length
    ? organizationSettings.reportSourceList
    : REPORT_SOURCE_OPTIONS;
  const facilityOptions = organizationSettings?.facilityList?.length
    ? organizationSettings.facilityList
    : [];

  useEffect(() => {
    const token = getAdminToken();
    if (!token) {
      setSessionChecked(true);
      setLoading(false);
      return;
    }

    axios
      .get(`${API_URL}/api/auth/session`, { headers: authHeaders(token) })
      .then((res) => setAdminSession(res.data.user))
      .catch(() => {
        clearAdminToken();
        setAdminSession(null);
      })
      .finally(() => {
        setSessionChecked(true);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!sessionChecked || !canViewRegistry) return;

    setLoading(true);
    const token = getAdminToken();
    axios
      .get(`${API_URL}/api/registry-cases`, { headers: authHeaders(token) })
      .then((res) => setCases(SHOW_DEMO_BY_DEFAULT ? [...res.data, ...demoData] : res.data))
      .catch(() => {
        setCases(SHOW_DEMO_BY_DEFAULT ? demoData : []);
        setError(SHOW_DEMO_BY_DEFAULT ? null : "Unable to load the protected case registry.");
      })
      .finally(() => setLoading(false));
  }, [canViewRegistry, sessionChecked]);

  useEffect(() => {
    if (!adminSession) return undefined;

    const checkSession = () => {
      if (!isSessionExpired(adminSession)) return;
      clearAdminToken();
      setAdminSession(null);
      setSelectedCase(null);
      setSaveMessage({ type: "warning", text: "Session expired. Sign in again to access case records." });
    };

    checkSession();
    const interval = window.setInterval(() => {
      setSessionTick((current) => current + 1);
      checkSession();
    }, 60000);

    return () => window.clearInterval(interval);
  }, [adminSession]);

  useEffect(() => {
    if (!selectedCase || !canReview) {
      setLocationSuggestions([]);
      return undefined;
    }

    const query = editForm.location.trim();
    if (query.length < 3) {
      setLocationSuggestions([]);
      return undefined;
    }

    let cancelled = false;
    setLoadingLocationSuggestions(true);
    const timeout = window.setTimeout(() => {
      searchLocations(query)
        .then((suggestions) => {
          if (!cancelled) setLocationSuggestions(suggestions);
        })
        .finally(() => {
          if (!cancelled) setLoadingLocationSuggestions(false);
        });
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [canReview, editForm.location, selectedCase]);

  const filtered = cases.filter(
    (c) =>
      c.disease?.toLowerCase().includes(search.toLowerCase()) ||
      c.location?.toLowerCase().includes(search.toLowerCase()) ||
      c.locationSource?.toLowerCase().includes(search.toLowerCase()) ||
      c.locationVerification?.toLowerCase().includes(search.toLowerCase()) ||
      c.locationReviewReason?.toLowerCase().includes(search.toLowerCase()) ||
      c.status?.toLowerCase().includes(search.toLowerCase()) ||
      c.priority?.toLowerCase().includes(search.toLowerCase()) ||
      c.ageGroup?.toLowerCase().includes(search.toLowerCase()) ||
      c.sex?.toLowerCase().includes(search.toLowerCase()) ||
      c.facility?.toLowerCase().includes(search.toLowerCase()) ||
      c.suspectedExposure?.toLowerCase().includes(search.toLowerCase()) ||
      c.reportSource?.toLowerCase().includes(search.toLowerCase()) ||
      c.notes?.toLowerCase().includes(search.toLowerCase())
  );

  const openReview = (caseRecord) => {
    setSelectedCase(caseRecord);
    setEditForm({
      status: caseRecord.status || "New",
      priority: getPriority(caseRecord, organizationSettings),
      location: caseRecord.location || "",
      latitude: Number.isFinite(Number(caseRecord.lat)) ? String(caseRecord.lat) : "",
      longitude: Number.isFinite(Number(caseRecord.lng)) ? String(caseRecord.lng) : "",
      locationSource: caseRecord.locationSource || "GPS captured",
      locationVerification: caseRecord.locationVerification || "GPS verified",
      locationReviewReason: caseRecord.locationReviewReason || "",
      ageGroup: caseRecord.ageGroup || "Unknown",
      sex: caseRecord.sex || "Unknown",
      symptomOnsetDate: caseRecord.symptomOnsetDate || "",
      facility: caseRecord.facility || "",
      suspectedExposure: caseRecord.suspectedExposure || "",
      reportSource: caseRecord.reportSource || "Field report",
      notes: caseRecord.notes || "",
    });
    setSaveMessage(null);
  };

  const closeReview = () => {
    if (saving || deleting) return;
    setSelectedCase(null);
    setSaveMessage(null);
  };

  const handleEditChange = (event) => {
    setEditForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  };

  const applyLocationSuggestion = (suggestion) => {
    if (!suggestion) return;
    setEditForm((current) => ({
      ...current,
      location: suggestion.label,
      latitude: suggestion.latitude,
      longitude: suggestion.longitude,
      locationSource: "Admin corrected",
      locationVerification: "Admin corrected",
      locationReviewReason: `Map coordinates selected from ${suggestion.label}.`,
    }));
    setSaveMessage({ type: "success", text: "Map coordinates selected. Save the review to move the marker and heatmap." });
  };

  const applyGeocodedLocation = async () => {
    setFindingLocation(true);
    setSaveMessage(null);

    try {
      const result = await geocodeLocation(editForm.location);
      setEditForm((current) => ({
        ...current,
        latitude: result.latitude,
        longitude: result.longitude,
        locationSource: "Admin corrected",
        locationVerification: "Admin corrected",
        locationReviewReason: current.locationReviewReason || `Map coordinates matched from ${result.placeName}.`,
      }));
      setSaveMessage({ type: "success", text: `Map coordinates found for ${result.placeName}. Save the review to move the marker.` });
      return result;
    } catch (err) {
      setSaveMessage({ type: "error", text: err.message || "Unable to find map coordinates for this location." });
      return null;
    } finally {
      setFindingLocation(false);
    }
  };

  const saveReview = async () => {
    if (!selectedCase?._id || String(selectedCase._id).startsWith("demo-")) return;
    const token = getAdminToken();
    if (!token) {
      setSaveMessage({ type: "warning", text: "Reviewer access is required before saving case reviews. Open the Admin tab and sign in first." });
      return;
    }

    setSaving(true);
    setSaveMessage(null);

    try {
      const locationChanged = String(editForm.location || "").trim() !== String(selectedCase.location || "").trim();
      const coordinatesUnchanged = coordinatesMatch(editForm.latitude, editForm.longitude, selectedCase.lat, selectedCase.lng);
      const shouldGeocodeAdminCorrection =
        editForm.locationSource === "Admin corrected" &&
        editForm.locationVerification === "Admin corrected" &&
        coordinatesUnchanged;
      let payload = { ...editForm };

      if ((locationChanged && coordinatesUnchanged) || shouldGeocodeAdminCorrection) {
        const result = await geocodeLocation(editForm.location);
        payload = {
          ...payload,
          latitude: result.latitude,
          longitude: result.longitude,
          locationSource: "Admin corrected",
          locationVerification: "Admin corrected",
          locationReviewReason: payload.locationReviewReason || `Map coordinates matched from ${result.placeName}.`,
        };
        setEditForm((current) => ({ ...current, ...payload }));
      }

      const res = await axios.patch(`${API_URL}/api/cases/${selectedCase._id}`, payload, { headers: authHeaders(token) });
      setCases((current) => current.map((item) => (item._id === selectedCase._id ? res.data : item)));
      setSelectedCase(res.data);
      setSaveMessage({ type: "success", text: "Case review updated." });
      setAdminSession((current) => current || { name: "GeoHealth Administrator", role: "Admin" });
    } catch (err) {
      if (err.response?.status === 401) {
        clearAdminToken();
        setAdminSession(null);
      }
      const text = err.response?.data?.errors?.[0]?.msg || err.response?.data?.error || err.message || "Unable to update this case.";
      setSaveMessage({ type: "error", text });
    } finally {
      setSaving(false);
    }
  };

  const deleteCase = async (caseRecord = selectedCase) => {
    if (!caseRecord?._id || String(caseRecord._id).startsWith("demo-")) return;
    const token = getAdminToken();
    if (!token || !canDelete) {
      setSelectedCase(caseRecord);
      setSaveMessage({ type: "warning", text: "Administrator access is required before deleting a case." });
      return;
    }

    const confirmed = window.confirm(`Delete this ${caseRecord.disease} case record from ${caseRecord.location}? This action will be recorded in the audit log.`);
    if (!confirmed) return;

    setDeleting(true);
    setSaveMessage(null);

    try {
      await axios.delete(`${API_URL}/api/cases/${caseRecord._id}`, { headers: authHeaders(token) });
      setCases((current) => current.filter((item) => item._id !== caseRecord._id));
      setSelectedCase(null);
      setSaveMessage(null);
    } catch (err) {
      if (err.response?.status === 401) {
        clearAdminToken();
        setAdminSession(null);
      }
      const text = err.response?.data?.error || "Unable to delete this case.";
      setSaveMessage({ type: "error", text });
    } finally {
      setDeleting(false);
    }
  };

  if (loading || !sessionChecked)
    return (
      <Box sx={{ display: "flex", justifyContent: "center", mt: 8 }}>
        <CircularProgress />
      </Box>
    );

  if (!canViewRegistry) {
    return (
      <Box sx={{ minHeight: "calc(100vh - 72px)", bgcolor: "#eef4f2", p: 3 }}>
        <Box
          sx={{
            maxWidth: 780,
            mx: "auto",
            mt: 8,
            p: 4,
            borderRadius: 2,
            bgcolor: "white",
            border: "1px solid rgba(15, 23, 42, 0.08)",
            boxShadow: "0 22px 55px rgba(15, 23, 42, 0.10)",
          }}
        >
          <Typography variant="h4" fontWeight={900} color="#102a2c" gutterBottom>
            Staff Sign-In Required
          </Typography>
          <Alert severity="warning" sx={{ mb: 2 }}>
            The detailed case registry is restricted to signed-in organization users. Guests can still view the public surveillance map.
          </Alert>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Sign in as a field reporter, reviewer, data manager, or administrator to view submitted case records.
          </Typography>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
            <Button component={Link} to="/admin" variant="contained" sx={{ bgcolor: "#0f766e", fontWeight: 900, "&:hover": { bgcolor: "#115e59" } }}>
              Go to Sign In
            </Button>
            <Button component={Link} to="/" variant="outlined" sx={{ fontWeight: 900 }}>
              Return to Map
            </Button>
          </Stack>
        </Box>
      </Box>
    );
  }

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
            {organizationSettings.organizationName} Case Registry
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Search, review, and triage submitted surveillance records for {organizationSettings.defaultRegion}.
          </Typography>
        </Box>

        <Stack spacing={1} alignItems={{ xs: "stretch", md: "flex-end" }}>
          <TextField
            placeholder="Search disease, location, status, facility..."
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
          <Chip
            label={canReview ? `${adminSession.role} review access active` : "Review saving locked"}
            color={canReview ? "success" : "warning"}
            size="small"
            sx={{ fontWeight: 900, alignSelf: { xs: "flex-start", md: "flex-end" } }}
          />
          {adminSession && sessionTimeRemaining && (
            <Chip
              label={`${sessionTimeRemaining} remaining`}
              color={sessionExpiringSoon ? "warning" : "success"}
              variant="outlined"
              size="small"
              sx={{ fontWeight: 900, alignSelf: { xs: "flex-start", md: "flex-end" } }}
            />
          )}
        </Stack>
      </Stack>

      {!canReview && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Case review updates are protected now. Sign in as an administrator, epidemiology reviewer, or data manager before saving review changes.
        </Alert>
      )}

      {sessionExpiringSoon && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Your session is almost up. Sign out and sign back in if you need more time to continue reviewing records.
        </Alert>
      )}

      <TableContainer
        component={Paper}
        elevation={0}
        sx={{
          borderRadius: 2,
          border: "1px solid rgba(15, 23, 42, 0.08)",
          boxShadow: "0 22px 55px rgba(15, 23, 42, 0.10)",
          overflowX: "auto",
        }}
      >
        <Table size="small" sx={{ minWidth: 2100 }}>
          <TableHead>
            <TableRow sx={{ "& th": { fontWeight: 900, bgcolor: "#082f2f", color: "white", py: 1.5 } }}>
              <TableCell>#</TableCell>
              <TableCell>Disease</TableCell>
              <TableCell>Location</TableCell>
              <TableCell>Location Trust</TableCell>
              <TableCell align="right">Cases</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Priority</TableCell>
              <TableCell>Age/Sex</TableCell>
              <TableCell>Facility</TableCell>
              <TableCell>Reporter</TableCell>
              <TableCell>Source</TableCell>
              <TableCell>Notes</TableCell>
              <TableCell>Report Date</TableCell>
              <TableCell>Onset</TableCell>
              <TableCell>Last Reviewed</TableCell>
              <TableCell align="right">Lat</TableCell>
              <TableCell align="right">Lng</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={18} align="center">
                  No cases found.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((c, i) => {
                const priority = getPriority(c, organizationSettings);
                const status = c.status || "New";
                const lastReview = getLastReview(c);
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
                    <TableCell>
                      <Typography variant="body2" fontWeight={700}>
                        {c.location}
                      </Typography>
                      {c.enteredLocation && c.enteredLocation !== c.location && (
                        <Typography variant="caption" color="text.secondary">
                          Reported: {c.enteredLocation}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={c.locationVerification || "GPS verified"}
                        color={LOCATION_VERIFICATION_COLORS[c.locationVerification || "GPS verified"] || "default"}
                        size="small"
                        sx={{ fontWeight: 800, mb: 0.4 }}
                      />
                      <Typography variant="caption" color="text.secondary" display="block">
                        {c.locationSource || "GPS captured"}
                      </Typography>
                    </TableCell>
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
                    <TableCell>
                      <Typography variant="body2" fontWeight={700}>
                        {c.ageGroup || "Unknown"}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {c.sex || "Unknown"}
                      </Typography>
                    </TableCell>
                    <TableCell>{c.facility || "Not specified"}</TableCell>
                    <TableCell>
                      <Typography variant="body2" fontWeight={700}>
                        {c.submittedBy || "Unknown reporter"}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {c.submittedByRole || "Unassigned role"}
                      </Typography>
                    </TableCell>
                    <TableCell>{c.reportSource || "Field report"}</TableCell>
                    <TableCell sx={{ maxWidth: 280 }}>
                      <Typography variant="body2" color="text.secondary" noWrap>
                        {c.notes || "No notes"}
                      </Typography>
                    </TableCell>
                    <TableCell>{formatDate(c.date)}</TableCell>
                    <TableCell>{c.symptomOnsetDate ? formatDate(c.symptomOnsetDate) : "Unknown"}</TableCell>
                    <TableCell>
                      {lastReview ? (
                        <Box>
                          <Typography variant="body2" fontWeight={700}>
                            {formatDateTime(lastReview.reviewedAt)}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {lastReview.changedFields?.length ? lastReview.changedFields.join(", ") : "Reviewed"}
                          </Typography>
                        </Box>
                      ) : (
                        <Typography variant="body2" color="text.secondary">
                          Not reviewed
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell align="right">{Number(c.lat).toFixed(4)}</TableCell>
                    <TableCell align="right">{Number(c.lng).toFixed(4)}</TableCell>
                    <TableCell align="right">
                      {canReview || canDelete ? (
                        <Stack direction="row" spacing={1} justifyContent="flex-end">
                          {canReview && (
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
                          )}
                          {canDelete && (
                            <Button
                              size="small"
                              variant="outlined"
                              color="error"
                              startIcon={<DeleteIcon />}
                              onClick={() => deleteCase(c)}
                              disabled={deleting || String(c._id || "").startsWith("demo-")}
                              sx={{ fontWeight: 800, whiteSpace: "nowrap" }}
                            >
                              Delete
                            </Button>
                          )}
                        </Stack>
                      ) : (
                        <Chip
                          label="View only"
                          size="small"
                          variant="outlined"
                          sx={{ fontWeight: 800, color: "#64748b", borderColor: "rgba(100, 116, 139, 0.35)" }}
                        />
                      )}
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
                  {selectedCase.location} · {selectedCase.cases} reported cases · Reported {formatDate(selectedCase.date)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {selectedCase.facility || "No facility specified"} · Onset {selectedCase.symptomOnsetDate ? formatDate(selectedCase.symptomOnsetDate) : "unknown"}
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block">
                  Submitted by {selectedCase.submittedBy || "Unknown reporter"}{selectedCase.submittedByRole ? ` · ${selectedCase.submittedByRole}` : ""}
                </Typography>
              </Box>
              {saveMessage && (
                <Alert severity={saveMessage.type} sx={{ fontSize: "0.85rem" }}>
                  {saveMessage.text}
                </Alert>
              )}
              {(selectedCase.locationVerification === "Needs location review" || selectedCase.locationReviewReason) && (
                <Alert severity="warning" sx={{ fontSize: "0.85rem" }}>
                  {selectedCase.locationReviewReason || "This case needs location review before the plotted map location is trusted."}
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
              <Divider />
              <Typography variant="subtitle2" fontWeight={900} color="#102a2c">
                Location Verification
              </Typography>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1.2} alignItems={{ xs: "stretch", sm: "flex-start" }}>
                <Autocomplete
                  freeSolo
                  options={locationSuggestions}
                  loading={loadingLocationSuggestions}
                  filterOptions={(options) => options}
                  getOptionLabel={(option) => (typeof option === "string" ? option : option.label)}
                  value={editForm.location}
                  inputValue={editForm.location}
                  onInputChange={(event, nextValue) => {
                    setEditForm((current) => ({ ...current, location: nextValue || "" }));
                  }}
                  onChange={(event, suggestion) => {
                    if (typeof suggestion === "string") {
                      setEditForm((current) => ({ ...current, location: suggestion }));
                    } else {
                      applyLocationSuggestion(suggestion);
                    }
                  }}
                  fullWidth
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Reported Location"
                      name="location"
                      size="small"
                      helperText="Choose a suggestion, or search to update map coordinates."
                    />
                  )}
                />
                <Button
                  variant="outlined"
                  startIcon={<SearchIcon />}
                  onClick={applyGeocodedLocation}
                  disabled={findingLocation || !editForm.location.trim()}
                  aria-label="Search map coordinates"
                  sx={{
                    fontWeight: 900,
                    whiteSpace: "nowrap",
                    minHeight: 40,
                    width: { xs: "100%", sm: 126 },
                    flexShrink: 0,
                    borderRadius: 1.5,
                    letterSpacing: 0,
                  }}
                >
                  {findingLocation ? "Finding" : "Search"}
                </Button>
              </Stack>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1.2}>
                <TextField
                  label="Map Latitude"
                  name="latitude"
                  value={editForm.latitude}
                  onChange={handleEditChange}
                  size="small"
                  fullWidth
                  helperText="Update only after verified correction."
                />
                <TextField
                  label="Map Longitude"
                  name="longitude"
                  value={editForm.longitude}
                  onChange={handleEditChange}
                  size="small"
                  fullWidth
                  helperText="Update only after verified correction."
                />
              </Stack>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1.2}>
                <TextField
                  select
                  label="Location Source"
                  name="locationSource"
                  value={editForm.locationSource}
                  onChange={handleEditChange}
                  size="small"
                  fullWidth
                >
                  {LOCATION_SOURCE_OPTIONS.map((source) => (
                    <MenuItem key={source} value={source}>{source}</MenuItem>
                  ))}
                </TextField>
                <TextField
                  select
                  label="Verification"
                  name="locationVerification"
                  value={editForm.locationVerification}
                  onChange={handleEditChange}
                  size="small"
                  fullWidth
                >
                  {LOCATION_VERIFICATION_OPTIONS.map((verification) => (
                    <MenuItem key={verification} value={verification}>{verification}</MenuItem>
                  ))}
                </TextField>
              </Stack>
              <TextField
                label="Location Review Note"
                name="locationReviewReason"
                value={editForm.locationReviewReason}
                onChange={handleEditChange}
                size="small"
                fullWidth
                multiline
                minRows={2}
                inputProps={{ maxLength: 500 }}
                placeholder="Explain why the location was verified, corrected, or reported remotely"
              />
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1.2}>
                <TextField
                  select
                  label="Age Group"
                  name="ageGroup"
                  value={editForm.ageGroup}
                  onChange={handleEditChange}
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
                  value={editForm.sex}
                  onChange={handleEditChange}
                  size="small"
                  fullWidth
                >
                  {SEX_OPTIONS.map((sex) => (
                    <MenuItem key={sex} value={sex}>{sex}</MenuItem>
                  ))}
                </TextField>
              </Stack>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1.2}>
                <TextField
                  label="Symptom Onset"
                  name="symptomOnsetDate"
                  type="date"
                  value={editForm.symptomOnsetDate}
                  onChange={handleEditChange}
                  size="small"
                  fullWidth
                  InputLabelProps={{ shrink: true }}
                />
                <TextField
                  label="Facility"
                  name="facility"
                  value={editForm.facility}
                  onChange={handleEditChange}
                  size="small"
                  fullWidth
                  inputProps={{ list: "review-facility-options" }}
                />
              </Stack>
              <datalist id="review-facility-options">
                {facilityOptions.map((facility) => (
                  <option key={facility} value={facility} />
                ))}
              </datalist>
              <TextField
                select
                label="Source"
                name="reportSource"
                value={editForm.reportSource}
                onChange={handleEditChange}
                size="small"
                fullWidth
              >
                {reportSourceOptions.map((source) => (
                  <MenuItem key={source} value={source}>{source}</MenuItem>
                ))}
              </TextField>
              <TextField
                label="Suspected Exposure"
                name="suspectedExposure"
                value={editForm.suspectedExposure}
                onChange={handleEditChange}
                size="small"
                fullWidth
                multiline
                minRows={2}
                inputProps={{ maxLength: 1000 }}
                placeholder="Possible event, travel, facility exposure, or known contact"
              />
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
                        <Typography variant="caption" color="text.secondary" display="block">
                          Age: {entry.ageGroup || "Unknown"} · Sex: {entry.sex || "Unknown"} · Facility: {entry.facility || "Not specified"}
                        </Typography>
                        {(entry.location || entry.locationSource || entry.locationVerification) && (
                          <Typography variant="caption" color="text.secondary" display="block">
                            Location: {entry.location || "Unknown"} · {entry.locationSource || "Source unknown"} · {entry.locationVerification || "Verification unknown"}
                          </Typography>
                        )}
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
          {canDelete && selectedCase && !String(selectedCase._id || "").startsWith("demo-") && (
            <Button
              onClick={deleteCase}
              disabled={saving || deleting}
              color="error"
              startIcon={<DeleteIcon />}
              sx={{ mr: "auto", fontWeight: 900 }}
            >
              {deleting ? "Deleting..." : "Delete Case"}
            </Button>
          )}
          <Button onClick={closeReview} disabled={saving || deleting || findingLocation} sx={{ fontWeight: 800 }}>
            Close
          </Button>
          <Button
            onClick={saveReview}
            disabled={saving || deleting || findingLocation || !canReview || !selectedCase || String(selectedCase._id || "").startsWith("demo-")}
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
