declare module '*.css?inline' {
  const css: string;
  export default css;
}

declare module '*.svg' {
  const svg: string;
  export default svg;
}

declare module '*.webp' {
  const url: string;
  export default url;
}

declare module '*.svelte' {
  import type { ComponentType, SvelteComponent } from 'svelte';

  const component: ComponentType<SvelteComponent<Record<string, unknown>>>;
  export default component;
}
