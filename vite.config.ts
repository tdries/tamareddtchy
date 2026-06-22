import { defineConfig } from "vite";

// Client is built into webroot/ which Devvit Web serves as the post's web view.
// Root is src/client so index.html and main.ts live with the rest of the client.
export default defineConfig({
  root: "src/client",
  build: {
    outDir: "../../webroot",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
  },
});
