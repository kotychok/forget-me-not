<script lang="ts">
  import { tick } from 'svelte';
  import type { Document } from '../lib/api';
  import type { SearchHit } from '../lib/search';
  import { searchDocuments, snippet } from '../lib/search';
  import MarkedText from './MarkedText.svelte';
  let {
    disabled = false,
    onload,
    onselect,
    onreveal,
    query = $bindable(''),
    onreset,
  }: {
    disabled?: boolean;
    query?: string;
    onreset: () => void;
    onload: () => Promise<Document[]>;
    onselect: (hit: SearchHit, query: string) => Promise<void>;
    onreveal: (hit: SearchHit, query: string) => void;
  } = $props();
  let dialog = $state<HTMLDialogElement>();
  let input = $state<HTMLInputElement>();
  let resultList = $state<HTMLDivElement>();
  let source = $state.raw<Document[]>([]);
  let loading = $state(false);
  let selecting = $state(false);
  let error = $state('');
  let generation = 0;
  const results = $derived(searchDocuments(source, query));
  async function refresh() {
    const run = ++generation;
    loading = true;
    error = '';
    source = [];
    try {
      const documents = await onload();
      if (run === generation) source = documents;
    } catch (reason) {
      if (run === generation)
        error =
          reason instanceof Error ? reason.message : 'Could not load search';
    } finally {
      if (run === generation) loading = false;
    }
  }
  async function open() {
    dialog?.showModal();
    await tick();
    input?.focus();
    void refresh();
  }
  async function choose(hit: SearchHit) {
    if (selecting) return;
    selecting = true;
    error = '';
    try {
      await onselect(hit, query);
      dialog?.close();
      await tick();
      onreveal(hit, query);
    } catch (reason) {
      error =
        reason instanceof Error ? reason.message : 'Could not open result';
    } finally {
      selecting = false;
    }
  }
</script>

<button class="new-list" {disabled} onclick={open} aria-haspopup="dialog"
  >Search lists</button
>
<dialog
  class="guide search-dialog"
  bind:this={dialog}
  aria-labelledby="search-title"
  oncancel={(event) => {
    if (selecting) event.preventDefault();
  }}
  onclose={() => {
    generation++;
    loading = false;
  }}
>
  <div class="guide-header">
    <h2 id="search-title">Search lists</h2>
    <button
      class="quiet"
      disabled={selecting}
      aria-label="Close search"
      onclick={() => dialog?.close()}>✕</button
    >
  </div>
  <label for="search-query">Search titles, items, notes and tags</label>
  <input
    id="search-query"
    bind:this={input}
    bind:value={query}
    maxlength="200"
    disabled={selecting}
    onkeydown={(event) => {
      if (event.isComposing) return;
      if (event.key === 'ArrowDown' || event.key === 'Enter') {
        event.preventDefault();
        resultList?.querySelector<HTMLButtonElement>('button')?.focus();
      }
    }}
  />
  <button
    class="quiet"
    disabled={selecting || !query}
    onclick={() => {
      onreset();
      input?.focus();
    }}>Clear search</button
  >
  <p class="guide-intro">
    Literal, case-insensitive search. Open lists include local edits. Reopen or
    refresh to update results.
  </p>
  <button class="quiet" disabled={loading || selecting} onclick={refresh}
    >Refresh search</button
  >
  {#if error}<p class="error-message" role="alert">
      {error} Search uses the snapshot limits: 100 lists, 10,000 items, 8 MiB.
    </p>{/if}
  <p role="status" aria-label="Search status">
    {#if loading}Loading search…{:else if !query.trim()}Enter text to search.{:else if !error}{results.total}
      results{#if results.total > results.hits.length}
        — showing first {results.hits.length}; refine your search{/if}{/if}
  </p>
  <div
    class="search-results"
    bind:this={resultList}
    role="group"
    aria-label="Search results"
  >
    {#each results.hits as hit (`${hit.listId}:${hit.itemId ?? 'title'}:${hit.field ?? 'text'}`)}
      <button
        class="search-result"
        data-search-list={hit.listId}
        disabled={selecting}
        onclick={() => choose(hit)}
        onkeydown={(event) => {
          if (
            event.isComposing ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey
          )
            return;
          if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
          const buttons = [
            ...(resultList?.querySelectorAll<HTMLButtonElement>('button') ??
              []),
          ];
          const index = buttons.indexOf(event.target as HTMLButtonElement);
          if (index < 0) return;
          event.preventDefault();
          if (event.key === 'ArrowUp' && index === 0) input?.focus();
          else buttons[index + (event.key === 'ArrowDown' ? 1 : -1)]?.focus();
        }}
      >
        <span class="search-context"
          ><MarkedText text={hit.title} {query} />{hit.itemId
            ? hit.field === 'note'
              ? ' · Note'
              : hit.field === 'tag'
                ? ' · Tags'
                : ' · Item'
            : ' · List title'}</span
        >
        {#if hit.ancestors.length}<span class="search-path"
            >{hit.ancestors.join(' › ')}</span
          >{/if}
        <span><MarkedText text={snippet(hit.text, query)} {query} /></span>
      </button>
    {/each}
  </div>
</dialog>
