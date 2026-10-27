<script lang="ts">
  import { tick, onMount } from 'svelte';
  let {
    item,
    onapply,
    onclose,
  }: {
    item: { id: string; text: string; note: string } | null;
    onapply: (id: string, note: string) => void;
    onclose: () => void;
  } = $props();
  let dialog = $state<HTMLDialogElement>();
  let input = $state<HTMLTextAreaElement>();
  let draft = $state('');
  let original = '';
  const bytes = $derived(new TextEncoder().encode(draft).length);
  $effect(() => {
    if (!item || !dialog) return;
    original = item.note;
    draft = item.note;
    dialog.showModal();
    void tick().then(() => input?.focus());
  });
  function close() {
    dialog?.close();
    onclose();
  }
  onMount(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dialog?.open && draft !== original) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  });
</script>

<dialog
  class="guide note-dialog"
  bind:this={dialog}
  aria-labelledby="note-title"
  oncancel={(event) => {
    event.preventDefault();
    close();
  }}
>
  <div class="guide-header">
    <h2 id="note-title">Item note</h2>
    <button class="quiet" aria-label="Close note" onclick={close}>✕</button>
  </div>
  <p class="note-item-title">{item?.text || 'Empty item'}</p>
  <p class="guide-intro">
    Plain text. Markdown is kept literally. Apply saves one undoable change;
    Cancel discards this draft.
  </p>
  <label for="item-note">Note text</label>
  <textarea id="item-note" bind:this={input} bind:value={draft} rows="12"
  ></textarea>
  <p class:error-message={bytes > 65536}>{bytes} / 65536 bytes</p>
  <div class="transfer-actions">
    <button
      disabled={bytes > 65536}
      onclick={() => {
        if (!item) return;
        onapply(item.id, draft);
        close();
      }}>Apply note</button
    ><button onclick={close}>Cancel</button>
  </div>
</dialog>
