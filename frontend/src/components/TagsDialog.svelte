<script lang="ts">
  import { tick, onMount } from 'svelte';
  import { parseTags } from '../lib/tags';
  let {
    item,
    suggestions,
    onapply,
    onclose,
  }: {
    item: { id: string; text: string; tags: string[] } | null;
    suggestions: string[];
    onapply: (id: string, tags: string[]) => void;
    onclose: () => void;
  } = $props();
  let dialog = $state<HTMLDialogElement>();
  let input = $state<HTMLInputElement>();
  let draft = $state('');
  let original = '';
  const parsed = $derived.by(() => {
    try {
      return { tags: parseTags(draft), error: '' };
    } catch (error) {
      return {
        tags: [] as string[],
        error: error instanceof Error ? error.message : 'Invalid tags',
      };
    }
  });
  $effect(() => {
    if (!item || !dialog) return;
    original = item.tags.join(', ');
    draft = original;
    dialog.showModal();
    void tick().then(() => input?.focus());
  });
  function close() {
    dialog?.close();
    onclose();
  }
  function apply() {
    if (!item || parsed.error) return;
    onapply(item.id, parsed.tags);
    close();
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
  class="guide tags-dialog"
  bind:this={dialog}
  aria-labelledby="tags-title"
  oncancel={(event) => {
    event.preventDefault();
    close();
  }}
>
  <div class="guide-header">
    <h2 id="tags-title">Item tags</h2>
    <button class="quiet" aria-label="Close tags" onclick={close}>✕</button>
  </div>
  <p class="note-item-title">{item?.text || 'Empty item'}</p>
  <p class="guide-intro">
    Case-sensitive names, separated by commas. Up to 12 tags, 40 characters
    each. Apply is one undoable change.
  </p>
  <form
    onsubmit={(event) => {
      event.preventDefault();
      apply();
    }}
  >
    <label for="item-tags">Tags</label><input
      id="item-tags"
      bind:this={input}
      bind:value={draft}
      autocomplete="off"
    />
    {#if parsed.error}<p class="error-message" role="alert">
        {parsed.error}
      </p>{/if}
    {#if suggestions.length}<div
        class="tag-suggestions"
        aria-label="Tags in this list"
      >
        {#each suggestions.slice(0, 20) as tag}<button
            type="button"
            disabled={!!parsed.error || parsed.tags.includes(tag)}
            onclick={() => {
              draft = [...parsed.tags, tag].join(', ');
              input?.focus();
            }}>{tag}</button
          >{/each}
      </div>{/if}
    <div class="transfer-actions">
      <button type="submit" disabled={!!parsed.error}>Apply tags</button><button
        type="button"
        onclick={close}>Cancel</button
      >
    </div>
  </form>
</dialog>
