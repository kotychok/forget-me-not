<script lang="ts">
  import MarkdownView from './MarkdownView.svelte';
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
  let preview = $state(false);
  let original = $state('');
  const bytes = $derived(new TextEncoder().encode(draft).length);
  $effect(() => {
    if (!item || !dialog) return;
    preview = false;
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
      if (item && draft !== original) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  });
</script>

<dialog
  data-draft-dirty={!!item && draft !== original}
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
    Edit the original text. Preview renders Markdown without changing it. Apply
    saves one undoable change; Cancel discards this draft.
  </p>
  <button
    class="quiet"
    aria-pressed={preview}
    onclick={() => (preview = !preview)}
    >{preview ? 'Hide note preview' : 'Preview note'}</button
  >
  {#if preview}<div class="note-preview" aria-label="Note preview">
      <MarkdownView text={draft} interactive />
    </div>{/if}
  <label for="item-note">Note text</label>
  <textarea
    aria-describedby="note-size"
    aria-invalid={bytes > 65536}
    placeholder="Add details, context or links…"
    id="item-note"
    bind:this={input}
    bind:value={draft}
    rows="12"></textarea>
  <p id="note-size" class="field-hint" class:error-message={bytes > 65536}>
    {bytes} / 65536 bytes
  </p>
  <div class="transfer-actions">
    <button
      class="dialog-primary"
      disabled={bytes > 65536}
      onclick={() => {
        if (!item) return;
        onapply(item.id, draft);
        close();
      }}>Apply note</button
    ><button class="dialog-cancel" onclick={close}>Cancel</button>
  </div>
</dialog>
