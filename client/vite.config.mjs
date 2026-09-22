import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Keep the deployed CRA variable names available while Render is migrated.
  envPrefix: ["VITE_", "REACT_APP_"],
  build: {
    // Preserve the existing Render static publish directory during migration.
    outDir: "build",
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/setupTests.js",
    css: true,
  },
});
