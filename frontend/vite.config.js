import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  define: {
    CESIUM_BASE_URL: JSON.stringify("/cesium")
  },
  server: {
    host: "0.0.0.0",
    port: 5173
  },
  optimizeDeps: {
    include: ["cesium"]
  }
});
