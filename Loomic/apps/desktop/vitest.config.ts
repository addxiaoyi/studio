import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    clearMocks: true,
    restoreMocks: true,
    exclude: [...configDefaults.exclude, "**/.candidate-*/**", "dist-electron/**", "dist/**"],
  },
});
