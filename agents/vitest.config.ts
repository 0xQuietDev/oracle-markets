import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // hidden-tests/ are fixtures run by the validator harness at runtime, not unit
    // tests; .validator-work/ is the validator's transient scratch dir (gitignored).
    exclude: ["**/node_modules/**", "**/dist/**", "hidden-tests/**", ".validator-work/**"],
  },
});
