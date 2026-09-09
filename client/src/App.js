import React, { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { BrowserRouter, Routes, Route, Link, useLocation } from "react-router-dom";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import axios from "axios";
import {
  AppBar,
  Box,
  Button,
  ButtonGroup,
  Card,
  CardContent,
  CircularProgress,
  Divider,
  Drawer,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Toolbar,
  Typography,
  Alert,
  Chip,
} from "@mui/material";
import PublicIcon from "@mui/icons-material/Public";
import TableChartIcon from "@mui/icons-material/TableChart";
import WhatshotIcon from "@mui/icons-material/Whatshot";
import PlaceIcon from "@mui/icons-material/Place";
import CoronavirusIcon from "@mui/icons-material/Coronavirus";
import TimelineIcon from "@mui/icons-material/Timeline";
import InsightsIcon from "@mui/icons-material/Insights";
import FileDownloadIcon from "@mui/icons-material/FileDownload";
import PrintIcon from "@mui/icons-material/Print";
import ZoomOutMapIcon from "@mui/icons-material/ZoomOutMap";
import AddCaseForm from "./AddCaseForm";
import CasesTable from "./CasesTable";
import demoData from "./demoData";

mapboxgl.accessToken = process.env.REACT_APP_MAPBOX_TOKEN;

const API_URL = process.env.REACT_APP_API_URL || "http://localhost:5000";
const DRAWER_WIDTH = 360;
const SHOW_DEMO_BY_DEFAULT = process.env.NODE_ENV !== "production";
const DISEASE_OPTIONS = ["COVID-19", "Influenza", "Measles", "Norovirus", "Malaria", "Cholera", "Dengue"];
const STATUS_OPTIONS = ["New", "Under Review", "Confirmed", "Rejected", "Closed"];
const PRIORITY_OPTIONS = ["Low", "Medium", "High"];

function getSeverity(count) {
  if (count >= 50) return "High";
  if (count >= 20) return "Medium";
  return "Low";
}

function getPriority(item) {
  return item.priority || getSeverity(item.cases);
}

function getPriorityColor(priority) {
  if (priority === "High") return "#dc2626";
  if (priority === "Medium") return "#f97316";
  return "#0f766e";
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

function buildCsv(rows) {
  const headers = ["Disease", "Location", "Cases", "Date", "Status", "Priority", "Source", "Notes", "Latitude", "Longitude", "Data Origin"];
  const escape = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const body = rows.map((row) => [
    row.disease,
    row.location,
    row.cases,
    row.date,
    row.status || "New",
    getPriority(row),
    row.reportSource || "Field report",
    row.notes || "",
    row.lat,
    row.lng,
    row.source || "live",
  ].map(escape).join(","));
  return [headers.join(","), ...body].join("\n");
}

function downloadCsv(rows) {
  const blob = new Blob([buildCsv(rows)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `geohealth-cases-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function printPdfReport(rows) {
  const totalCases = rows.reduce((sum, item) => sum + item.cases, 0);
  const reportWindow = window.open("", "_blank", "width=1000,height=800");
  if (!reportWindow) return;

  const tableRows = rows.map((row) => `
    <tr>
      <td>${escapeHtml(row.disease)}</td>
      <td>${escapeHtml(row.location)}</td>
      <td>${escapeHtml(row.cases)}</td>
      <td>${escapeHtml(formatDate(row.date))}</td>
      <td>${escapeHtml(row.status || "New")}</td>
      <td>${escapeHtml(getPriority(row))}</td>
      <td>${escapeHtml(row.reportSource || "Field report")}</td>
      <td>${escapeHtml(row.notes || "")}</td>
    </tr>
  `).join("");

  reportWindow.document.write(`
    <!doctype html>
    <html>
      <head>
        <title>GeoHealth Insights Report</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 32px; color: #102a2c; }
          h1 { margin-bottom: 4px; }
          .meta { color: #64748b; margin-bottom: 24px; }
          .cards { display: flex; gap: 12px; margin-bottom: 24px; }
          .card { border: 1px solid #dbe5e2; border-radius: 8px; padding: 14px; min-width: 150px; }
          .label { color: #64748b; font-size: 12px; text-transform: uppercase; font-weight: 700; }
          .value { font-size: 28px; font-weight: 800; }
          table { width: 100%; border-collapse: collapse; font-size: 13px; }
          th { background: #082f2f; color: white; text-align: left; }
          th, td { padding: 10px; border-bottom: 1px solid #dbe5e2; }
        </style>
      </head>
      <body>
        <h1>GeoHealth Insights Report</h1>
        <div class="meta">Generated ${formatDate(new Date().toISOString())}</div>
        <div class="cards">
          <div class="card"><div class="label">Records</div><div class="value">${rows.length}</div></div>
          <div class="card"><div class="label">Total Cases</div><div class="value">${totalCases}</div></div>
        </div>
        <table>
          <thead>
            <tr><th>Disease</th><th>Location</th><th>Cases</th><th>Date</th><th>Status</th><th>Priority</th><th>Source</th><th>Notes</th></tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </body>
    </html>
  `);
  reportWindow.document.close();
  reportWindow.focus();
  reportWindow.print();
}

function StatCard({ label, value, accent, icon }) {
  return (
    <Card
      elevation={0}
      sx={{
        borderRadius: 2,
        border: "1px solid rgba(15, 23, 42, 0.08)",
        background: "linear-gradient(135deg, #ffffff 0%, #f7faf9 100%)",
      }}
    >
      <CardContent sx={{ p: 2, "&:last-child": { pb: 2 } }}>
        <Stack direction="row" alignItems="center" spacing={1.5}>
          <Box
            sx={{
              width: 42,
              height: 42,
              borderRadius: 2,
              display: "grid",
              placeItems: "center",
              bgcolor: accent,
              color: "white",
            }}
          >
            {icon}
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700, textTransform: "uppercase" }}>
              {label}
            </Typography>
            <Typography variant="h4" fontWeight={800} color="#102a2c" sx={{ lineHeight: 1.1 }}>
              {value}
            </Typography>
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}

function AnalyticsCard({ title, children }) {
  return (
    <Card
      elevation={0}
      sx={{
        borderRadius: 2,
        border: "1px solid rgba(15, 23, 42, 0.08)",
        bgcolor: "rgba(255,255,255,0.96)",
        boxShadow: "0 14px 34px rgba(15, 23, 42, 0.08)",
      }}
    >
      <CardContent sx={{ p: 2, "&:last-child": { pb: 2 } }}>
        <Typography variant="subtitle2" fontWeight={900} color="#102a2c" sx={{ mb: 1.2, textTransform: "uppercase" }}>
          {title}
        </Typography>
        <Stack spacing={1}>{children}</Stack>
      </CardContent>
    </Card>
  );
}

function AnalyticsRow({ primary, secondary, value, priority }) {
  return (
    <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1.5}>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" fontWeight={800} color="#102a2c" noWrap>
          {primary}
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap>
          {secondary}
        </Typography>
      </Box>
      <Chip
        label={value}
        size="small"
        sx={{
          minWidth: 44,
          bgcolor: getPriorityColor(priority),
          color: "white",
          fontWeight: 900,
        }}
      />
    </Stack>
  );
}

function TrendChart({ rows }) {
  const trendData = useMemo(() => {
    const byDate = rows.reduce((acc, item) => {
      acc[item.date] = (acc[item.date] || 0) + item.cases;
      return acc;
    }, {});
    return Object.entries(byDate)
      .map(([date, cases]) => ({ date, cases }))
      .sort((a, b) => parseDateValue(a.date) - parseDateValue(b.date))
      .slice(-10);
  }, [rows]);
  const maxCases = Math.max(...trendData.map((item) => item.cases), 1);

  if (trendData.length === 0) {
    return <Typography variant="body2" color="text.secondary">No trend data available.</Typography>;
  }

  return (
    <Stack direction="row" alignItems="end" spacing={1.1} sx={{ height: 142, pt: 1 }}>
      {trendData.map((item) => (
        <Tooltip key={item.date} title={`${formatDate(item.date)}: ${item.cases} cases`}>
          <Box sx={{ flex: 1, minWidth: 0, display: "grid", alignItems: "end", gap: 0.7 }}>
            <Box
              sx={{
                height: `${Math.max(12, (item.cases / maxCases) * 108)}px`,
                borderRadius: "8px 8px 3px 3px",
                bgcolor: getPriorityColor(getSeverity(item.cases)),
                boxShadow: "inset 0 -10px 18px rgba(255,255,255,0.18)",
              }}
            />
            <Typography variant="caption" color="text.secondary" align="center" noWrap>
              {parseDateValue(item.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
            </Typography>
          </Box>
        </Tooltip>
      ))}
    </Stack>
  );
}

function MapView() {
  const [liveData, setLiveData] = useState([]);
  const [showDemoData, setShowDemoData] = useState(SHOW_DEMO_BY_DEFAULT);
  const [showHeatmap, setShowHeatmap] = useState(true);
  const [loadingData, setLoadingData] = useState(true);
  const [apiError, setApiError] = useState(null);
  const [mapReady, setMapReady] = useState(false);
  const [filters, setFilters] = useState({
    disease: "All",
    status: "All",
    priority: "All",
    startDate: "",
    endDate: "",
  });
  const mapRef = useRef(null);
  const mapContainerRef = useRef(null);
  const markersRef = useRef([]);

  const clearMarkers = () => {
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];
  };

  const data = useMemo(() => {
    const liveRecords = liveData.map((item) => ({ ...item, source: item.source || "live" }));
    return showDemoData ? [...liveRecords, ...demoData] : liveRecords;
  }, [liveData, showDemoData]);

  const filteredData = useMemo(() => data.filter((item) => {
    const status = item.status || "New";
    const priority = getPriority(item);
    const caseDate = parseDateValue(item.date);
    const startsAfter = filters.startDate ? caseDate >= parseDateValue(filters.startDate) : true;
    const endsBefore = filters.endDate ? caseDate <= parseDateValue(filters.endDate) : true;
    const diseaseMatch = filters.disease === "All" || item.disease === filters.disease;
    const statusMatch = filters.status === "All" || status === filters.status;
    const priorityMatch = filters.priority === "All" || priority === filters.priority;
    return startsAfter && endsBefore && diseaseMatch && statusMatch && priorityMatch;
  }), [data, filters]);

  const diseaseOptions = useMemo(
    () => [...new Set([...DISEASE_OPTIONS, ...data.map((item) => item.disease).filter(Boolean)])],
    [data]
  );

  const totalReported = filteredData.reduce((sum, d) => sum + d.cases, 0);
  const recentCases = filteredData.filter((c) => {
    const today = new Date();
    const caseDate = parseDateValue(c.date);
    return today - caseDate < 7 * 24 * 60 * 60 * 1000;
  });
  const topLocations = useMemo(() => {
    const byLocation = filteredData.reduce((acc, item) => {
      acc[item.location] = (acc[item.location] || 0) + item.cases;
      return acc;
    }, {});
    return Object.entries(byLocation)
      .map(([location, cases]) => ({ location, cases }))
      .sort((a, b) => b.cases - a.cases)
      .slice(0, 4);
  }, [filteredData]);
  const diseaseMix = useMemo(() => {
    const byDisease = filteredData.reduce((acc, item) => {
      acc[item.disease] = (acc[item.disease] || 0) + item.cases;
      return acc;
    }, {});
    return Object.entries(byDisease)
      .map(([disease, cases]) => ({ disease, cases }))
      .sort((a, b) => b.cases - a.cases)
      .slice(0, 4);
  }, [filteredData]);
  const recentReports = useMemo(
    () => [...filteredData].sort((a, b) => parseDateValue(b.date) - parseDateValue(a.date)).slice(0, 4),
    [filteredData]
  );
  const statusCounts = useMemo(() => {
    const byStatus = filteredData.reduce((acc, item) => {
      const status = item.status || "New";
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {});
    return STATUS_OPTIONS.map((status) => ({ status, count: byStatus[status] || 0 })).filter((item) => item.count > 0);
  }, [filteredData]);

  const geojsonData = useMemo(() => ({
    type: "FeatureCollection",
    features: filteredData.map((d) => ({
      type: "Feature",
      properties: { cases: d.cases, priority: getPriority(d), status: d.status || "New" },
      geometry: {
        type: "Point",
        coordinates: [parseFloat(d.lng), parseFloat(d.lat)],
      },
    })),
  }), [filteredData]);

  const updateFilter = (field, value) => {
    setFilters((current) => ({ ...current, [field]: value }));
  };

  const resetFilters = () => {
    setFilters({ disease: "All", status: "All", priority: "All", startDate: "", endDate: "" });
  };

  const fitMapToCases = useCallback((duration = 900) => {
    if (!mapRef.current || filteredData.length === 0) return;

    const map = mapRef.current;
    map.stop();
    map.resize();

    window.requestAnimationFrame(() => {
      if (!mapRef.current) return;

      const validCoordinates = filteredData
        .map((point) => [Number(point.lng), Number(point.lat)])
        .filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat));

      if (validCoordinates.length === 0) return;

      if (validCoordinates.length === 1) {
        mapRef.current.flyTo({ center: validCoordinates[0], zoom: 9, duration });
        return;
      }

      const bounds = validCoordinates.reduce(
        (nextBounds, coordinate) => nextBounds.extend(coordinate),
        new mapboxgl.LngLatBounds(validCoordinates[0], validCoordinates[0])
      );

      const mapBox = mapContainerRef.current?.getBoundingClientRect();
      const horizontalPadding = Math.min(64, Math.max(20, (mapBox?.width || 600) * 0.05));
      const verticalPadding = Math.min(44, Math.max(12, (mapBox?.height || 320) * 0.1));

      mapRef.current.fitBounds(bounds, {
        padding: {
          top: verticalPadding,
          right: horizontalPadding,
          bottom: verticalPadding,
          left: horizontalPadding,
        },
        maxZoom: 6,
        duration,
        linear: false,
      });
    });
  }, [filteredData]);

  const fetchHealthData = () => {
    setLoadingData(true);
    axios
      .get(`${API_URL}/api/health-data`)
      .then((res) => { setLiveData(res.data); setApiError(null); })
      .catch(() => {
        setLiveData([]);
        setShowDemoData(true);
        setApiError("Showing demo data because live database records could not be loaded.");
      })
      .finally(() => setLoadingData(false));
  };

  useEffect(() => { fetchHealthData(); }, []);

  useEffect(() => {
    if (!mapContainerRef.current) return undefined;

    const animationFrame = window.requestAnimationFrame(() => {
      mapRef.current = new mapboxgl.Map({
        container: mapContainerRef.current,
        style: "mapbox://styles/mapbox/streets-v12",
        center: [-95, 37],
        zoom: 3,
        projection: "mercator",
      });

      mapRef.current.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
      if (process.env.NODE_ENV === "development") {
        window.geoHealthMap = mapRef.current;
      }
      mapRef.current.once("load", () => {
        mapRef.current?.resize();
        setMapReady(true);
      });
    });

    return () => {
      window.cancelAnimationFrame(animationFrame);
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      if (process.env.NODE_ENV === "development") {
        delete window.geoHealthMap;
      }
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;

    const ensureHeatmap = () => {
      if (!map.getSource("cases-heat-source")) {
        map.addSource("cases-heat-source", { type: "geojson", data: geojsonData });
        map.addLayer({
          id: "cases-heat-layer",
          type: "heatmap",
          source: "cases-heat-source",
          paint: {
            "heatmap-weight": ["interpolate", ["linear"], ["get", "cases"], 0, 0, 50, 0.5, 100, 1],
            "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 0, 12, 15, 40],
            "heatmap-color": [
              "interpolate", ["linear"], ["heatmap-density"],
              0, "rgba(20,184,166,0)", 0.35, "#5eead4", 0.55, "#facc15", 0.75, "#fb923c", 1, "#ef4444",
            ],
            "heatmap-opacity": 0.82,
          },
        });
      } else {
        map.getSource("cases-heat-source").setData(geojsonData);
      }
      map.setLayoutProperty("cases-heat-layer", "visibility", showHeatmap ? "visible" : "none");
    };

    if (map.isStyleLoaded()) ensureHeatmap();
    else map.once("load", ensureHeatmap);
  }, [geojsonData, showHeatmap]);

  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;

    const addMarkers = () => {
      clearMarkers();
      if (showHeatmap) return;

      filteredData.forEach((point) => {
        const lng = parseFloat(point.lng);
        const lat = parseFloat(point.lat);
        if (isNaN(lng) || isNaN(lat)) return;

        const el = document.createElement("div");
        const priority = getPriority(point);
        const status = point.status || "New";
        const size = point.cases <= 1 ? 18 : Math.min(44, 18 + point.cases / 2);
        el.style.cssText = `
          width:${size}px; height:${size}px; border-radius:50%;
          background-color:${getPriorityColor(priority)};
          border:3px solid #fff; box-shadow:0 10px 22px rgba(15,23,42,0.24);
        `;

        const marker = new mapboxgl.Marker(el)
          .setLngLat([lng, lat])
          .setPopup(new mapboxgl.Popup({ offset: 18 }).setHTML(`
            <div class="case-popup">
              <strong>${escapeHtml(point.disease)}</strong>
              <span>${escapeHtml(point.location)}</span>
              <div><b>${escapeHtml(point.cases)}</b> reported cases</div>
              <div>${escapeHtml(formatDate(point.date))} · ${escapeHtml(priority)} priority</div>
              <div>Status: ${escapeHtml(status)}</div>
              <div>Source: ${escapeHtml(point.reportSource || "Field report")} · ${escapeHtml(point.source || "live")}</div>
              ${point.notes ? `<div>${escapeHtml(point.notes)}</div>` : ""}
            </div>
          `))
          .addTo(map);
        markersRef.current.push(marker);
      });
    };

    if (map.isStyleLoaded()) addMarkers();
    else map.once("load", addMarkers);
  }, [filteredData, showHeatmap]);

  useEffect(() => {
    if (!mapReady || !mapRef.current || filteredData.length === 0) return;
    const map = mapRef.current;
    if (map.isStyleLoaded()) fitMapToCases();
    else map.once("load", fitMapToCases);
  }, [filteredData, fitMapToCases, mapReady]);

  useEffect(() => {
    if (filteredData.length === 1) {
      setShowHeatmap(false);
    }
  }, [filteredData.length]);

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: { xs: "column", md: "row" },
        minHeight: "calc(100vh - 72px)",
        bgcolor: "#eef4f2",
      }}
    >
      <Drawer
        variant="permanent"
        sx={{
          width: { xs: "100%", md: DRAWER_WIDTH },
          flexShrink: 0,
          "& .MuiDrawer-paper": {
            width: { xs: "100%", md: DRAWER_WIDTH },
            position: "relative",
            height: { xs: "auto", md: "calc(100vh - 72px)" },
            maxHeight: { xs: "none", md: "calc(100vh - 72px)" },
            overflowY: "auto",
            boxSizing: "border-box",
            p: 2.5,
            borderRight: "1px solid rgba(15, 23, 42, 0.08)",
            bgcolor: "#f8fbfa",
          },
        }}
      >
        <Box sx={{ mb: 2.5 }}>
          <Chip label="Live Surveillance" size="small" sx={{ mb: 1, bgcolor: "#dff7ef", color: "#0f766e", fontWeight: 800 }} />
          <Typography variant="h5" fontWeight={900} color="#102a2c">
            Situation Overview
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Monitor disease reports, activity trends, and location intelligence.
          </Typography>
        </Box>
        {loadingData ? (
          <Box sx={{ display: "flex", justifyContent: "center", mt: 2 }}>
            <CircularProgress size={24} />
          </Box>
        ) : (
          <Stack spacing={1.5}>
            {apiError && <Alert severity="error" sx={{ mb: 1, fontSize: "0.75rem" }}>{apiError}</Alert>}
            <StatCard label="Total Cases" value={totalReported} accent="#0f766e" icon={<CoronavirusIcon />} />
            <StatCard label="Visible Records" value={filteredData.length} accent="#2563eb" icon={<TimelineIcon />} />
            <StatCard label="Last 7 Days" value={recentCases.length} accent="#f97316" icon={<InsightsIcon />} />
            <StatCard
              label="Under Review"
              value={filteredData.filter((item) => (item.status || "New") === "Under Review").length}
              accent="#334155"
              icon={<TableChartIcon />}
            />
          </Stack>
        )}

        <Divider sx={{ my: 2.5 }} />

        <Typography variant="h6" fontWeight={900} color="#102a2c" gutterBottom>
          Data Source
        </Typography>
        <FormControlLabel
          control={
            <Switch
              checked={showDemoData}
              onChange={(event) => setShowDemoData(event.target.checked)}
              color="success"
            />
          }
          label={showDemoData ? "Demo data visible" : "Live data only"}
          sx={{ mb: 0.5, "& .MuiFormControlLabel-label": { fontWeight: 700, color: "#102a2c" } }}
        />
        <Typography variant="caption" color="text.secondary">
          Live records: {liveData.length} · Demo records: {showDemoData ? demoData.length : 0}
        </Typography>
        {!showDemoData && liveData.length > 0 && (
          <Alert severity="success" sx={{ mt: 1.5, fontSize: "0.8rem", borderRadius: 2 }}>
            Live database records are active.
          </Alert>
        )}

        <Divider sx={{ my: 2.5 }} />

        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5 }}>
          <Typography variant="h6" fontWeight={900} color="#102a2c">
            Filters
          </Typography>
          <Button size="small" onClick={resetFilters} sx={{ fontWeight: 800 }}>
            Reset
          </Button>
        </Stack>
        <Stack
          spacing={1.3}
          sx={{
            "& .MuiOutlinedInput-root": {
              borderRadius: 2,
              bgcolor: "white",
            },
          }}
        >
          <TextField
            select
            label="Disease"
            value={filters.disease}
            onChange={(event) => updateFilter("disease", event.target.value)}
            size="small"
            fullWidth
          >
            <MenuItem value="All">All diseases</MenuItem>
            {diseaseOptions.map((disease) => (
              <MenuItem key={disease} value={disease}>{disease}</MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Status"
            value={filters.status}
            onChange={(event) => updateFilter("status", event.target.value)}
            size="small"
            fullWidth
          >
            <MenuItem value="All">All statuses</MenuItem>
            {STATUS_OPTIONS.map((status) => (
              <MenuItem key={status} value={status}>{status}</MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Priority"
            value={filters.priority}
            onChange={(event) => updateFilter("priority", event.target.value)}
            size="small"
            fullWidth
          >
            <MenuItem value="All">All priorities</MenuItem>
            {PRIORITY_OPTIONS.map((priority) => (
              <MenuItem key={priority} value={priority}>{priority}</MenuItem>
            ))}
          </TextField>
          <Stack direction="row" spacing={1.2}>
            <TextField
              label="Start"
              type="date"
              value={filters.startDate}
              onChange={(event) => updateFilter("startDate", event.target.value)}
              size="small"
              fullWidth
              InputLabelProps={{ shrink: true }}
            />
            <TextField
              label="End"
              type="date"
              value={filters.endDate}
              onChange={(event) => updateFilter("endDate", event.target.value)}
              size="small"
              fullWidth
              InputLabelProps={{ shrink: true }}
            />
          </Stack>
        </Stack>

        <Divider sx={{ my: 2.5 }} />

        <Typography variant="h6" fontWeight={900} color="#102a2c" gutterBottom>
          Report a Case
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Capture a disease event with location and report date.
        </Typography>
        <AddCaseForm onCaseAdded={fetchHealthData} />
      </Drawer>

      <Box sx={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <Box
          sx={{
            px: 2.5,
            py: 1.5,
            borderBottom: "1px solid rgba(15, 23, 42, 0.08)",
            bgcolor: "rgba(255,255,255,0.92)",
            display: "flex",
            flexDirection: { xs: "column", sm: "row" },
            alignItems: "center",
            justifyContent: "space-between",
            gap: 2,
          }}
        >
          <Box>
            <Typography variant="h6" fontWeight={900} color="#102a2c">
              Geographic Risk Map
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Switch between density view and precise case locations.
            </Typography>
          </Box>
          <ButtonGroup
            size="small"
            variant="outlined"
            sx={{
              bgcolor: "white",
              boxShadow: "0 8px 22px rgba(15, 23, 42, 0.08)",
              alignSelf: { xs: "stretch", sm: "center" },
              "& .MuiButton-root": { flex: { xs: 1, sm: "initial" } },
            }}
          >
            <Tooltip title={`Fit map to ${filteredData.length} visible records`}>
              <Button onClick={() => fitMapToCases(900)} startIcon={<ZoomOutMapIcon />}>
                Fit
              </Button>
            </Tooltip>
            <Button
              onClick={() => setShowHeatmap(true)}
              variant={showHeatmap ? "contained" : "outlined"}
              startIcon={<WhatshotIcon />}
            >
              Heatmap
            </Button>
            <Button
              onClick={() => setShowHeatmap(false)}
              variant={!showHeatmap ? "contained" : "outlined"}
              startIcon={<PlaceIcon />}
            >
              Markers
            </Button>
          </ButtonGroup>
        </Box>
        <Box sx={{ p: 2, height: { xs: 430, md: 380, xl: 430 }, flexShrink: 0 }}>
          <Box
            sx={{
              height: "100%",
              position: "relative",
              borderRadius: 2,
              overflow: "hidden",
              border: "1px solid rgba(15, 23, 42, 0.12)",
              boxShadow: "0 22px 55px rgba(15, 23, 42, 0.16)",
            }}
          >
            <div
              ref={mapContainerRef}
              id="map"
              style={{
                position: "absolute",
                inset: 0,
                height: "100%",
                width: "100%",
              }}
            />
          </Box>
        </Box>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", xl: "1.15fr 1fr 1fr 1fr" },
            gap: 1.5,
            px: 2,
            pb: 2,
          }}
        >
          <AnalyticsCard title="Case Trend">
            <TrendChart rows={filteredData} />
          </AnalyticsCard>
          <AnalyticsCard title="Recent Reports">
            {recentReports.length === 0 ? (
              <Typography variant="body2" color="text.secondary">No records match the current filters.</Typography>
            ) : recentReports.map((item) => (
              <AnalyticsRow
                key={item._id || `${item.location}-${item.date}`}
                primary={item.disease}
                secondary={`${item.location} · ${item.status || "New"} · ${formatDate(item.date)}`}
                value={item.cases}
                priority={getPriority(item)}
              />
            ))}
          </AnalyticsCard>
          <AnalyticsCard title="Top Locations">
            {topLocations.length === 0 ? (
              <Typography variant="body2" color="text.secondary">No location data available.</Typography>
            ) : topLocations.map((item) => (
              <AnalyticsRow
                key={item.location}
                primary={item.location}
                secondary="Reported case volume"
                value={item.cases}
                priority={getSeverity(item.cases)}
              />
            ))}
          </AnalyticsCard>
          <AnalyticsCard title="Disease Mix">
            {diseaseMix.length === 0 ? (
              <Typography variant="body2" color="text.secondary">No disease data available.</Typography>
            ) : diseaseMix.map((item) => (
              <AnalyticsRow
                key={item.disease}
                primary={item.disease}
                secondary="Total reported cases"
                value={item.cases}
                priority={getSeverity(item.cases)}
              />
            ))}
          </AnalyticsCard>
          <AnalyticsCard title="Workflow Status">
            {statusCounts.length === 0 ? (
              <Typography variant="body2" color="text.secondary">No workflow activity available.</Typography>
            ) : statusCounts.map((item) => (
              <AnalyticsRow
                key={item.status}
                primary={item.status}
                secondary="Records in this review stage"
                value={item.count}
                priority={item.status === "Confirmed" || item.status === "Closed" ? "Low" : item.status === "Under Review" ? "Medium" : "High"}
              />
            ))}
          </AnalyticsCard>
          <AnalyticsCard title="Exports">
            <Button
              variant="contained"
              startIcon={<FileDownloadIcon />}
              onClick={() => downloadCsv(filteredData)}
              disabled={filteredData.length === 0}
              sx={{ justifyContent: "flex-start", bgcolor: "#0f766e", fontWeight: 900, "&:hover": { bgcolor: "#115e59" } }}
            >
              Export CSV
            </Button>
            <Button
              variant="outlined"
              startIcon={<PrintIcon />}
              onClick={() => printPdfReport(filteredData)}
              disabled={filteredData.length === 0}
              sx={{ justifyContent: "flex-start", fontWeight: 900 }}
            >
              Print PDF Report
            </Button>
            <Typography variant="caption" color="text.secondary">
              Exports use the current filters and visible data source.
            </Typography>
          </AnalyticsCard>
        </Box>
      </Box>
    </Box>
  );
}

function NavBar() {
  const location = useLocation();
  return (
    <AppBar position="static" elevation={0} sx={{ bgcolor: "#082f2f", borderBottom: "1px solid rgba(255,255,255,0.12)" }}>
      <Toolbar sx={{ minHeight: "72px !important", gap: 1, flexWrap: { xs: "wrap", sm: "nowrap" }, py: { xs: 1, sm: 0 } }}>
        <Box
          component={Link}
          to="/"
          aria-label="Go to GeoHealth Insights home"
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1.5,
            flexGrow: 1,
            color: "inherit",
            textDecoration: "none",
            minWidth: 0,
            borderRadius: 2,
            "&:hover .brand-icon": { bgcolor: "#14b8a6" },
          }}
        >
          <Box
            className="brand-icon"
            sx={{
              width: 44,
              height: 44,
              borderRadius: 2,
              display: "grid",
              placeItems: "center",
              bgcolor: "#0f766e",
              flexShrink: 0,
              transition: "background-color 160ms ease",
            }}
          >
            <PublicIcon />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h6" fontWeight={900} sx={{ lineHeight: 1.1 }}>
              GeoHealth Insights
            </Typography>
            <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.72)", fontWeight: 600 }}>
              Disease surveillance and geospatial reporting
            </Typography>
          </Box>
        </Box>
        <Button
          component={Link}
          to="/"
          color="inherit"
          startIcon={<PublicIcon />}
          sx={{ fontWeight: location.pathname === "/" ? 800 : 500, textDecoration: "none", borderRadius: 2 }}
        >
          Map
        </Button>
        <Button
          component={Link}
          to="/cases"
          color="inherit"
          startIcon={<TableChartIcon />}
          sx={{ fontWeight: location.pathname === "/cases" ? 800 : 500, textDecoration: "none", borderRadius: 2 }}
        >
          Cases
        </Button>
      </Toolbar>
    </AppBar>
  );
}

function App() {
  return (
    <BrowserRouter>
      <NavBar />
      <Routes>
        <Route path="/" element={<MapView />} />
        <Route path="/cases" element={<CasesTable />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App; 
