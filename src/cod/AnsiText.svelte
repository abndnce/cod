<script lang="ts">
  import { tick } from 'svelte';
  import type { AnsiRange } from './terminal';

  type AnsiPart = {
    className?: string;
    text: string;
  };

  type Props = {
    class?: string;
    id?: string;
    ranges: AnsiRange[];
    text: string;
  };

  const getParts = (text: string, ranges: AnsiRange[]) => {
    const parts: AnsiPart[] = [];

    const pushPart = (part: AnsiPart) => {
      const previous = parts.at(-1);
      if (previous && previous.className === part.className) {
        previous.text += part.text;
      } else if (part.text) {
        parts.push(part);
      }
    };

    let index = 0;

    for (const range of ranges) {
      if (range.start > index) pushPart({ text: text.slice(index, range.start) });
      pushPart({ className: range.name, text: text.slice(range.start, range.end) });
      index = range.end;
    }

    if (index < text.length) pushPart({ text: text.slice(index) });
    return parts;
  };

  let { class: className, id, ranges, text }: Props = $props();
  let element = $state<HTMLPreElement>();
  const parts = $derived(getParts(text, ranges));

  $effect(() => {
    text;
    element;

    tick().then(() => {
      if (element) element.scrollTop = element.scrollHeight;
    });
  });
</script>

<pre class={className} data-terminal-id={id} bind:this={element}>{#each parts as part}<span class={part.className}>{part.text}</span>{/each}</pre>
