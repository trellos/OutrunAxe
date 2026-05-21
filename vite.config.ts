import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.NODE_ENV === "production" ? "/OutrunAxe/" : "/",
  server: {
    host: "127.0.0.1",
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
