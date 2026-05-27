<script lang="ts">
  import {
    keyToTerminalInput,
    renderTerminal,
    type TerminalWindow,
  } from './terminal';

  type Props = {
    terminal: TerminalWindow;
    open: boolean;
    onOpen: (id: string) => void;
    onClose: (id: string) => void;
    onInput: (id: string, input: string) => void;
  };

  let { terminal, open, onOpen, onClose, onInput }: Props = $props();
  let element = $state<HTMLDialogElement>();
  let closingFromState = false;

  $effect(() => {
    if (!element) return;

    if (open && !element.open) {
      element.showModal();
      element.focus({ preventScroll: true });
    } else if (!open && element.open) {
      closingFromState = true;
      element.close();
    }
  });

  const close = () => {
    closingFromState = true;
    onClose(terminal.id);
  };

  const handleKeydown = (event: KeyboardEvent) => {
    const input = keyToTerminalInput(event);
    if (!input) return;

    event.preventDefault();
    onInput(terminal.id, input);
  };
</script>

<dialog
  aria-label={terminal.title}
  class="terminal-log"
  data-terminal-window-id={terminal.id}
  closedby="any"
  bind:this={element}
  onclose={() => {
    if (closingFromState) {
      closingFromState = false;
      return;
    }
    onClose(terminal.id);
  }}
  onkeydown={handleKeydown}
>
  <header>
    <strong>{terminal.title}</strong>
    <span class:running={terminal.running} class:error={terminal.failed}>
      {terminal.running ? 'running' : terminal.failed ? 'failed' : 'done'}
    </span>
    <button type="button" aria-label="Close terminal" onclick={close}>x</button>
  </header>
  <pre data-terminal-id={terminal.id}>{renderTerminal(terminal).text}</pre>
</dialog>

{#if !open}
  <button
    class:error={terminal.failed}
    class="terminal-log-peek"
    type="button"
    onclick={() => onOpen(terminal.id)}
  >
    {terminal.title}
  </button>
{/if}
