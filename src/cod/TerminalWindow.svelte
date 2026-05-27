<script lang="ts">
  import AnsiText from './AnsiText.svelte';
  import {
    keyToTerminalInput,
    renderTerminal,
    type TerminalWindow,
  } from './terminal';
  import cod from '../assets/cod-animation.webp';

  type Props = {
    terminals: TerminalWindow[];
    open: boolean;
    activeTab: string;
    onClose: () => void;
    onSelectTab: (id: string) => void;
    onToggleTask: (id: string) => void;
    onNewTerminal: () => void;
    onInput: (id: string, input: string) => void;
  };

  let {
    terminals,
    open,
    activeTab,
    onClose,
    onSelectTab,
    onToggleTask,
    onNewTerminal,
    onInput,
  }: Props = $props();
  let element = $state<HTMLDialogElement>();
  let closingFromState = false;

  const tasks = () => terminals.filter((terminal) => terminal.kind === 'task');
  const shells = () =>
    terminals.filter((terminal) => terminal.kind === 'terminal');
  const activeTerminal = () =>
    shells().find((terminal) => terminal.id === activeTab);
  const renderedTerminal = (terminal: TerminalWindow) =>
    renderTerminal(terminal);

  const handleKeydown = (event: KeyboardEvent) => {
    const terminal = activeTerminal();
    if (!terminal || terminal.kind !== 'terminal') return;

    const input = keyToTerminalInput(event);
    if (!input) return;

    event.preventDefault();
    onInput(terminal.id, input);
  };

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
</script>

<dialog
  aria-label="Terminal"
  class="terminal-app"
  data-terminal-app
  closedby="any"
  bind:this={element}
  onclose={() => {
    if (closingFromState) {
      closingFromState = false;
      return;
    }
    onClose();
  }}
  onkeydown={handleKeydown}
  tabindex="-1"
>
  <header class="terminal-header">
    <nav aria-label="Terminal tabs" class="terminal-tabs">
      <button
        class:active={activeTab === 'tasks'}
        aria-current={activeTab === 'tasks' ? 'page' : undefined}
        class="terminal-tab"
        type="button"
        onclick={() => onSelectTab('tasks')}
      >
        <div class="terminal-tab-background m3-layer">
          <span>Tasks</span>
        </div>
      </button>
      {#each shells() as terminal (terminal.id)}
        <button
          class:active={activeTab === terminal.id}
          aria-current={activeTab === terminal.id ? 'page' : undefined}
          class="terminal-tab"
          type="button"
          onclick={() => onSelectTab(terminal.id)}
        >
          <div class="terminal-tab-background m3-layer">
            <span>{terminal.title}</span>
          </div>
        </button>
      {/each}
    </nav>
    <button
      aria-label="New terminal"
      class="new-terminal"
      type="button"
      onclick={onNewTerminal}
    >
      <div class="new-terminal-background m3-layer">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="1em"
          height="1em"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            fill="currentColor"
            d="M11 13v3q0 .425.288.713T12 17t.713-.288T13 16v-3h3q.425 0 .713-.288T17 12t-.288-.712T16 11h-3V8q0-.425-.288-.712T12 7t-.712.288T11 8v3H8q-.425 0-.712.288T7 12t.288.713T8 13zm-6 8q-.825 0-1.412-.587T3 19V5q0-.825.588-1.412T5 3h14q.825 0 1.413.588T21 5v14q0 .825-.587 1.413T19 21zm0-2h14V5H5zM5 5v14z"
          />
        </svg>
      </div>
    </button>
  </header>

  {#if activeTab === 'tasks'}
    <div class="task-list">
      {#if tasks().length === 0}
        <p class="empty">$ no tasks have started yet</p>
      {/if}
      {#each tasks() as terminal (terminal.id)}
        <article
          class:error={terminal.failed}
          class:finished={!terminal.running}
          class="task-entry"
        >
          <button
            aria-expanded={!terminal.collapsed}
            class="task-summary m3-layer"
            type="button"
            onclick={() => onToggleTask(terminal.id)}
          >
            <span class="task-chevron" aria-hidden="true"
              >[{terminal.collapsed ? '+' : '-'}]</span
            >
            <strong>
              <span class="task-title">{terminal.title}</span>
              {#if terminal.running}
                <img
                  aria-label="running"
                  class="task-loader"
                  src={cod}
                  alt="running"
                />
              {/if}
            </strong>
          </button>
          {#if !terminal.collapsed}
            {@const rendered = renderedTerminal(terminal)}
            <AnsiText
              id={terminal.id}
              text={rendered.text}
              ranges={rendered.ranges}
            />
          {/if}
        </article>
      {/each}
    </div>
  {:else if activeTerminal()}
    {@const rendered = renderedTerminal(activeTerminal()!)}
    <AnsiText
      id={activeTab}
      text={rendered.text}
      ranges={rendered.ranges}
    />
  {:else}
    <div class="empty terminal-empty">
      <button class="m3-layer" type="button" onclick={onNewTerminal}
        >+ bash</button
      >
    </div>
  {/if}
</dialog>
