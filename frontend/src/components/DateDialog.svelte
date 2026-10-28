<script lang="ts">
  import { tick, onMount } from 'svelte';
  import { validDate } from '../lib/dates';
  let {
    item,
    onapply,
    onclose,
  }: {
    item: { id: string; text: string; dueDate: string } | null;
    onapply: (id: string, date: string) => void;
    onclose: () => void;
  } = $props();
  let dialog = $state<HTMLDialogElement>();
  let input = $state<HTMLInputElement>();
  let draft = $state('');
  let original = $state('');
  const error = $derived(
    draft && !validDate(draft)
      ? 'Choose a real calendar date between 0001 and 9999.'
      : '',
  );
  $effect(() => {
    if (!item || !dialog) return;
    original = item.dueDate;
    draft = original;
    dialog.showModal();
    void tick().then(() => input?.focus());
  });
  function close() {
    dialog?.close();
    onclose();
  }
  function apply() {
    if (!item || error || !input?.checkValidity()) return;
    onapply(item.id, draft);
    close();
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
  class="guide date-dialog"
  bind:this={dialog}
  aria-labelledby="date-title"
  oncancel={(event) => {
    event.preventDefault();
    close();
  }}
>
  <div class="guide-header">
    <h2 id="date-title">Due date</h2>
    <button class="quiet" aria-label="Close due date" onclick={close}>✕</button>
  </div>
  <p class="note-item-title">{item?.text || 'Empty item'}</p>
  <p class="guide-intro">
    A calendar date without a time or reminder. Apply is one undoable change.
  </p>
  <form
    onsubmit={(event) => {
      event.preventDefault();
      apply();
    }}
  >
    <label for="item-due-date">Due date</label>
    <input
      id="item-due-date"
      type="date"
      min="0001-01-01"
      max="9999-12-31"
      bind:this={input}
      bind:value={draft}
    />
    {#if error}<p class="error-message" role="alert">{error}</p>{/if}
    <div class="transfer-actions date-actions">
      <button class="date-apply" type="submit" disabled={!!error}
        >Apply date</button
      >
      <button
        type="button"
        onclick={() => {
          draft = '';
          input?.focus();
        }}>Clear date</button
      >
      <button class="date-cancel" type="button" onclick={close}>Cancel</button>
    </div>
  </form>
</dialog>
