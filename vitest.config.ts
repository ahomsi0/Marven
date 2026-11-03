import { defineConfig } from "vitest/config";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    exclude: ["node_modules/**", "dist/**", ".next/**", ".claude/**"],
  },
  resolve: { alias: { "@": __dirname } },
});
