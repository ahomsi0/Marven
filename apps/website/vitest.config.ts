import { defineConfig } from "vitest/config";
import { fileURLToPath } from "url";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    exclude: ["node_modules/**", ".next/**", "out/**"],
  },
  resolve: { alias: { "@": root } },
});
