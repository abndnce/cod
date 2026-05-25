import { defineConfig } from 'tsdown';
import { compile } from 'svelte/compiler';

const sveltePlugin = () => ({
  name: 'svelte',
  transform: {
    filter: { id: /\.svelte$/ },
    handler(code: string, id: string) {
      const compiled = compile(code, {
        filename: id,
        generate: 'client',
        css: 'injected',
      });

      return {
        code: compiled.js.code,
        map: compiled.js.map,
      };
    },
  },
});

export default defineConfig({
  platform: 'browser',
  entry: 'src/bootstrap/index.ts',
  dts: false,
  exports: true,
  minify: true,
  plugins: [sveltePlugin()],
  loader: {
    '.svg': 'text',
    '.webp': 'dataurl',
  },
});
