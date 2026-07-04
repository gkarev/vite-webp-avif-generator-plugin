import convertImages from "../../vite-webp-avif-generator-plugin.js";

export default defineNuxtConfig({
  compatibilityDate: "2026-07-04",
  devtools: { enabled: false },
  telemetry: false,
  vite: {
    plugins: [
      convertImages({
        folders: ["src/img", "public/img"],
        exclude: []
      })
    ]
  }
});
