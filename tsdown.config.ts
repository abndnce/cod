import { defineConfig } from 'tsdown';

export default defineConfig({
  platform: 'browser',
  entry: 'src/bootstrap/index.ts',
  dts: false,
  exports: true,
  minify: true,
  loader: {
    '.svg': 'text',
  },
});
