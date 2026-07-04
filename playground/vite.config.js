import { defineConfig } from "vite";
import { resolve } from "path";
import convertImages from "../vite-webp-avif-generator-plugin.js";

export default defineConfig({
  root: import.meta.dirname,
  publicDir: resolve(import.meta.dirname, "public"),
  plugins: [
    convertImages({
      folders: ["src/img", "public/img"],
      exclude: ["src/img/excluded", "public/img/excluded"],
      enableAvif: true,
      enableInitialPass: true
    })
  ]
});
