import { defineConfig } from "vite";

// Served from https://autotermlab.github.io/web-view/. Port 5173 is the one the bucket's CORS policy allows locally.
export default defineConfig({
  base: "/web-view/",
  server: { port: 5173, strictPort: true, host: true },
  preview: { port: 5173, strictPort: true, host: true },
});
