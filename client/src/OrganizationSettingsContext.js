import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import axios from "axios";

const API_URL = process.env.REACT_APP_API_URL || "http://localhost:5000";

export const DEFAULT_ORGANIZATION_SETTINGS = {
  organizationName: "GeoHealth Insights",
  defaultRegion: "Madison, WI",
  surveillanceScope: "Disease surveillance and geospatial reporting",
  contactEmail: "",
  lowPriorityMaxCases: 19,
  mediumPriorityMaxCases: 49,
  diseaseList: ["COVID-19", "Influenza", "Measles", "Norovirus", "Malaria", "Cholera", "Dengue"],
  facilityList: ["Hospital", "Clinic", "Laboratory", "School health office", "Community reporting line"],
  reportSourceList: ["Field report", "Clinic report", "Hospital report", "Laboratory report", "Community report", "School report", "Facility report", "Self report"],
};

const OrganizationSettingsContext = createContext({
  settings: DEFAULT_ORGANIZATION_SETTINGS,
  loading: false,
  refreshSettings: () => Promise.resolve(DEFAULT_ORGANIZATION_SETTINGS),
});

export function OrganizationSettingsProvider({ children }) {
  const [settings, setSettings] = useState(DEFAULT_ORGANIZATION_SETTINGS);
  const [loading, setLoading] = useState(true);

  const refreshSettings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API_URL}/api/settings`);
      const nextSettings = { ...DEFAULT_ORGANIZATION_SETTINGS, ...res.data };
      setSettings(nextSettings);
      return nextSettings;
    } catch {
      setSettings(DEFAULT_ORGANIZATION_SETTINGS);
      return DEFAULT_ORGANIZATION_SETTINGS;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshSettings();
  }, [refreshSettings]);

  const value = useMemo(() => ({ settings, loading, refreshSettings }), [settings, loading, refreshSettings]);

  return (
    <OrganizationSettingsContext.Provider value={value}>
      {children}
    </OrganizationSettingsContext.Provider>
  );
}

export function useOrganizationSettings() {
  return useContext(OrganizationSettingsContext);
}
