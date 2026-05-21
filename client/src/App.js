import React, { useEffect, useState, useRef } from "react";
import { BrowserRouter, Routes, Route, Link, useLocation } from "react-router-dom";
import mapboxgl from "mapbox-gl";
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
  Toolbar,
  Typography,
  Alert,
} from "@mui/material";
import PublicIcon from "@mui/icons-material/Public";
import TableChartIcon from "@mui/icons-material/TableChart";
import WhatshotIcon from "@mui/icons-material/Whatshot";
import PlaceIcon from "@mui/icons-material/Place";
import AddCaseForm from "./AddCaseForm";
import CasesTable from "./CasesTable";

mapboxgl.accessToken = process.env.REACT_APP_MAPBOX_TOKEN;

const API_URL = process.env.REACT_APP_API_URL || "http://localhost:5000";
const DRAWER_WIDTH = 300;

function StatCard({ label, value }) {
  return (
    <Card variant="outlined" sx={{ mb: 1.5 }}>
      <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
        <Typography variant="caption" color="text.secondary">
          {label}
        </Typography>
        <Typography variant="h5" fontWeight={700}>
          {value}
        </Typography>
      </CardContent>
    </Card>
  );
}

function MapView() {
  const [data, setData] = useState([]);
  const [showHeatmap, setShowHeatmap] = useState(true);
  const [loadingData, setLoadingData] = useState(true);
  const [apiError, setApiError] = useState(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);

  const clearMarkers = () => {
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];
  };

  const totalReported = data.reduce((sum, d) => sum + d.cases, 0);
  const recentCases = data.filter((c) => {
    const today = new Date();
    const caseDate = new Date(c.date);
    return today - caseDate < 7 * 24 * 60 * 60 * 1000;
  });

  const geojsonData = {
    type: "FeatureCollection",
    features: data.map((d) => ({
      type: "Feature",
      properties: { cases: d.cases },
      geometry: {
        type: "Point",
        coordinates: [parseFloat(d.lng), parseFloat(d.lat)],
      },
    })),
  };

  const fetchHealthData = () => {
    setLoadingData(true);
    axios
      .get(`${API_URL}/api/health-data`)
      .then((res) => { setData(res.data); setApiError(null); })
      .catch(() => setApiError("Could not load health data. Is the server running?"))
      .finally(() => setLoadingData(false));
  };

  useEffect(() => { fetchHealthData(); }, []);

  useEffect(() => {
    mapRef.current = new mapboxgl.Map({
      container: "map",
      style: "mapbox://styles/mapbox/streets-v11",
      center: [-95, 37],
      zoom: 3,
    });
    return () => mapRef.current.remove();
  }, []);

  useEffect(() => {
    if (!mapRef.current || data.length === 0) return;
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
              0, "rgba(0,0,255,0)", 0.4, "cyan", 0.6, "yellow", 0.8, "orange", 1, "red",
            ],
            "heatmap-opacity": 0.75,
          },
        });
      } else {
        map.getSource("cases-heat-source").setData(geojsonData);
      }
      map.setLayoutProperty("cases-heat-layer", "visibility", showHeatmap ? "visible" : "none");
    };

    if (map.isStyleLoaded()) ensureHeatmap();
    else map.once("load", ensureHeatmap);
  }, [data, showHeatmap]);

  useEffect(() => {
    if (!mapRef.current || data.length === 0) return;
    const map = mapRef.current;

    const addMarkers = () => {
      clearMarkers();
      if (showHeatmap) return;

      data.forEach((point) => {
        const lng = parseFloat(point.lng);
        const lat = parseFloat(point.lat);
        if (isNaN(lng) || isNaN(lat)) return;

        const el = document.createElement("div");
        const size = point.cases <= 1 ? 18 : Math.min(40, point.cases * 5);
        el.style.cssText = `
          width:${size}px; height:${size}px; border-radius:50%;
          background-color:${point.cases > 100 ? "red" : point.cases > 70 ? "orange" : "green"};
          border:2px solid #fff; box-shadow:0 0 6px rgba(0,0,0,0.5);
        `;

        const marker = new mapboxgl.Marker(el)
          .setLngLat([lng, lat])
          .setPopup(new mapboxgl.Popup().setHTML(`<strong>${point.location}</strong><br/>Cases: ${point.cases}`))
          .addTo(map);
        markersRef.current.push(marker);
      });
    };

    if (map.isStyleLoaded()) addMarkers();
    else map.once("load", addMarkers);
  }, [data, showHeatmap]);

  useEffect(() => {
    if (!mapRef.current || showHeatmap || data.length === 0) return;
    const latest = data[data.length - 1];
    const lng = Number(latest.lng);
    const lat = Number(latest.lat);
    if (!isNaN(lng) && !isNaN(lat)) {
      mapRef.current.flyTo({ center: [lng, lat], zoom: 10, essential: true });
    }
  }, [showHeatmap, data]);

  return (
    <Box sx={{ display: "flex", height: "calc(100vh - 64px)" }}>
      {/* Sidebar */}
      <Drawer
        variant="permanent"
        sx={{
          width: DRAWER_WIDTH,
          flexShrink: 0,
          "& .MuiDrawer-paper": {
            width: DRAWER_WIDTH,
            position: "relative",
            height: "100%",
            overflowY: "auto",
            boxSizing: "border-box",
            p: 2,
            bgcolor: "#f9f9f9",
          },
        }}
      >
        <Typography variant="subtitle1" fontWeight={700} gutterBottom>
          Summary
        </Typography>
        {loadingData ? (
          <Box sx={{ display: "flex", justifyContent: "center", mt: 2 }}>
            <CircularProgress size={24} />
          </Box>
        ) : (
          <>
            {apiError && <Alert severity="error" sx={{ mb: 1, fontSize: "0.75rem" }}>{apiError}</Alert>}
            <StatCard label="Total Reported Cases" value={totalReported} />
            <StatCard label="Case Records" value={data.length} />
            <StatCard label="Cases (Last 7 Days)" value={recentCases.length} />
          </>
        )}

        <Divider sx={{ my: 2 }} />

        <Typography variant="subtitle1" fontWeight={700} gutterBottom>
          Report a Case
        </Typography>
        <AddCaseForm onCaseAdded={fetchHealthData} />
      </Drawer>

      {/* Map area */}
      <Box sx={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <Box sx={{ p: 1.5, borderBottom: "1px solid #e0e0e0", bgcolor: "white" }}>
          <ButtonGroup size="small" variant="outlined">
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
        <div id="map" style={{ flex: 1, width: "100%" }} />
      </Box>
    </Box>
  );
}

function NavBar() {
  const location = useLocation();
  return (
    <AppBar position="static" elevation={2}>
      <Toolbar>
        <PublicIcon sx={{ mr: 1.5 }} />
        <Typography variant="h6" fontWeight={700} sx={{ flexGrow: 1 }}>
          GeoHealth Insights
        </Typography>
        <Button
          component={Link}
          to="/"
          color="inherit"
          startIcon={<PublicIcon />}
          sx={{ fontWeight: location.pathname === "/" ? 700 : 400, textDecoration: "none" }}
        >
          Map
        </Button>
        <Button
          component={Link}
          to="/cases"
          color="inherit"
          startIcon={<TableChartIcon />}
          sx={{ fontWeight: location.pathname === "/cases" ? 700 : 400, textDecoration: "none" }}
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