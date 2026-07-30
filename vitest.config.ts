import { defineConfig } from "vitest/config";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    exclude: ["node_modules/**", "dist/**", ".next/**"],
  },
  resolve: { alias: { "@": __dirname } },
});
