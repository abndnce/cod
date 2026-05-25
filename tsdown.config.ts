import { defineConfig } from "tsdown";

export default defineConfig({
  dts: false,
  platform: "browser",
  minify: true,
  exports: true,
  // ...config options
});
