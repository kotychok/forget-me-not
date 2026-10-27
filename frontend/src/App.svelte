<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { api } from './lib/api';
  import type { SaveStatus } from './lib/autosave';
  import { IndexedDbDrafts } from './lib/draft-storage';
  import type { Draft } from './lib/draft-storage';
  import RecoveryPanel from './components/RecoveryPanel.svelte';
  import { Workspace } from './lib/workspace';
  import type { Session, SidebarList } from './lib/workspace';
  import EditorPane from './components/EditorPane.svelte';
  import TransferDialog from './components/TransferDialog.svelte';
  import SearchDialog from './components/SearchDialog.svelte';
  import type { SearchHit } from './lib/search';
  import KeyboardGuide from './components/KeyboardGuide.svelte';

  let searchReveal = $state<{
    listId: string;
    id: string | null;
    query: string;
    token: number;
  } | null>(null);
  let current = $state.raw<Session>();
  let selectedId = $state<string | null>(null);
  let lists = $state<SidebarList[]>([]);
  let title = $state('No lists yet');
  let loading = $state(true);
  let busy = $state(false);
  let loadError = $state('');
  let saveStatus = $state<SaveStatus>('saved');
  let saveError = $state('');
  let savedNoticeVisible = $state(true);
  $effect(() => {
    // Restart only for status/list transitions, not every draft update.
    const status = saveStatus;
    const list = selectedId;
    savedNoticeVisible = true;
    if (status !== 'saved' || !list) return;
    const timer = setTimeout(() => (savedNoticeVisible = false), 1200);
    return () => clearTimeout(timer);
  });
  let draftRecords = $state.raw<Draft[]>([]);
  let draftError = $state('');
  let draftDurable = $state(false);
  let titleEditing = $state(false);
  let titleDraft = $state('');
  let titleInput = $state<HTMLInputElement>();
  let titleButton = $state<HTMLButtonElement>();
  const workspace = new Workspace(
    () => {
      current = workspace.current;
      selectedId = workspace.selectedId;
      lists = workspace.lists;
      title = workspace.title;
      loading = workspace.loading;
      busy = workspace.busy;
      loadError = workspace.error;
      saveStatus = current?.sync.status ?? 'saved';
      saveError = current?.sync.error ?? '';
      draftRecords = workspace.drafts?.records ?? [];
      draftError = workspace.drafts?.error ?? '';
      draftDurable =
        !!selectedId && (workspace.drafts?.isDurable(selectedId) ?? false);
    },
    undefined,
    new IndexedDbDrafts(),
  );

  function updateUrl() {
    const url = new URL(location.href);
    if (selectedId) url.searchParams.set('list', selectedId);
    else url.searchParams.delete('list');
    window.history.replaceState(null, '', url);
  }
  async function openList(id: string) {
    finishRename();
    if (await workspace.open(id)) updateUrl();
  }
  async function loadLists() {
    await workspace.load(new URL(location.href).searchParams.get('list'));
    updateUrl();
  }
  async function newList() {
    finishRename();
    if (await workspace.create()) {
      updateUrl();
      await beginRename();
    }
  }

  async function beginRename() {
    if (!current || busy) return;
    titleDraft = title;
    titleEditing = true;
    await tick();
    titleInput?.focus();
    titleInput?.select();
  }
  function finishRename(cancel = false, restoreFocus = false) {
    if (!titleEditing) return;
    titleEditing = false;
    const next = titleDraft.trim();
    if (!cancel && next && next !== title && current) {
      workspace.rename(next);
    }
    if (restoreFocus) void tick().then(() => titleButton?.focus());
  }

  async function deleteList() {
    if (
      !current ||
      busy ||
      !confirm(
        `Delete “${title}” and all its items permanently? This cannot be undone.`,
      )
    )
      return;
    finishRename();
    if (await workspace.removeCurrent()) updateUrl();
  }

  onMount(() => {
    void loadLists();
    const warn = (event: BeforeUnloadEvent) => {
      if (workspace.hasUnsaved || (titleEditing && titleDraft !== title)) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
      workspace.dispose();
    };
  });
</script>

<svelte:head
  ><meta
    name="description"
    content="A quiet, keyboard-driven outliner for thoughts and tasks."
  /></svelte:head
>

<div class="shell">
  <aside>
    <a class="brand" href="#main"
      ><span class="flower">✳</span> forget me not<span class="brand-dot"
        >.</span
      ></a
    >
    <div class="sidebar-section">YOUR SPACE</div>
    <nav aria-label="Lists">
      {#each lists as list (list.id)}
        <button
          class="list-link"
          data-list-id={list.id}
          class:selected={selectedId === list.id}
          disabled={busy}
          onclick={() => openList(list.id)}
          aria-current={selectedId === list.id ? 'page' : undefined}
        >
          <span>☷</span><span class="list-name">{list.title}</span>
          {#if list.saveStatus && list.saveStatus !== 'saved'}<span
              class="pending-status"
              class:failed={list.saveStatus === 'error' ||
                list.saveStatus === 'conflict'}
              aria-label={list.saveStatus}
              title={list.saveStatus}>●</span
            >{/if}<span class="count">{list.itemCount}</span>
        </button>
      {/each}
      <button class="new-list" disabled={busy || loading} onclick={newList}
        >＋ New list</button
      >
    </nav>
    <SearchDialog
      disabled={busy || loading}
      onload={() => {
        finishRename();
        return workspace.searchSource();
      }}
      onselect={async (hit, query) => {
        await workspace.openSearchHit(hit, query);
        updateUrl();
      }}
      onreveal={(hit: SearchHit, query: string) => {
        searchReveal = {
          listId: hit.listId,
          id: hit.itemId,
          query,
          token: (searchReveal?.token ?? 0) + 1,
        };
        if (!hit.itemId)
          void tick().then(() => {
            titleButton?.focus();
            titleButton?.scrollIntoView({ block: 'center' });
          });
      }}
    />
    <TransferDialog
      ondecode={api.decodeFile}
      onencode={api.encodeFile}
      currentTitle={selectedId ? title : null}
      hasLists={lists.length > 0}
      disabled={busy || loading}
      onexport={async (scope) => {
        finishRename();
        return scope === 'current'
          ? workspace.exportCurrent()
          : workspace.exportAll();
      }}
      onrefresh={() => workspace.refreshIndex()}
      onimport={async (document) => {
        finishRename();
        const count = await workspace.importJson(document);
        updateUrl();
        return count;
      }}
    />
    <div class="sidebar-bottom">
      <span class="local-dot"></span> Local only · no login
      <span class="version">M6</span>
    </div>
  </aside>

  <main id="main">
    <header>
      <span>Personal space <span class="slash">/</span> {title}</span>
      <KeyboardGuide />
    </header>
    <div class="page">
      <div class="eyebrow">A PLACE TO BEGIN</div>
      {#if titleEditing}
        <form
          class="rename-form"
          onsubmit={(event) => {
            event.preventDefault();
            finishRename(false, true);
          }}
        >
          <input
            class="title-input"
            bind:this={titleInput}
            aria-label="List title"
            maxlength="200"
            bind:value={titleDraft}
            onblur={() => finishRename()}
            onkeydown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                finishRename(true, true);
              }
            }}
          />
        </form>
      {:else}
        <h1>
          <button
            class="title-button"
            bind:this={titleButton}
            aria-label="Rename list"
            disabled={!selectedId || busy}
            onclick={beginRename}>{title}</button
          ><span>.</span>
        </h1>
      {/if}
      <p class="subtitle">One thought at a time. Give it a little structure.</p>
      <div
        class="session-note"
        class:notice-hidden={!loading &&
          !!selectedId &&
          saveStatus === 'saved' &&
          !savedNoticeVisible}
        aria-live="polite"
        role="status"
        aria-label="Save status"
      >
        {#if loading}Loading lists…{:else if selectedId}
          {saveStatus === 'saved'
            ? 'Saved'
            : saveStatus === 'saving'
              ? 'Saving…'
              : saveStatus === 'unsaved'
                ? 'Unsaved changes'
                : saveStatus === 'conflict'
                  ? 'Conflict — local changes kept in this tab.'
                  : 'Save failed — local changes kept in this tab.'}
        {:else}Create a list to get started.{/if}
        {#if draftDurable}<span>Local draft saved in this browser.</span>{/if}
      </div>
      {#if saveStatus === 'error' && selectedId}<p class="error-message">
          {saveError}
          <button disabled={busy} onclick={() => current?.sync.retry()}
            >Retry save</button
          >
        </p>{/if}
      <RecoveryPanel
        records={draftRecords}
        storageError={draftError}
        conflict={saveStatus === 'conflict' || saveStatus === 'error'}
        disabled={busy || loading}
        onrefresh={() => workspace.refreshDrafts()}
        onretry={() => workspace.retryDraftStorage()}
        ondiscard={(record) => workspace.discardDraft(record)}
        onrecover={async (record) => {
          finishRename();
          await workspace.recoverDraft(record);
          updateUrl();
        }}
        oncopy={async () => {
          finishRename();
          await workspace.saveLocalCopy();
          updateUrl();
        }}
        onload={async () => {
          finishRename();
          await workspace.loadServerVersion();
          updateUrl();
        }}
        onexport={() => workspace.exportCurrent()}
        onindex={() => workspace.refreshIndex()}
      />
      {#if loadError}<p class="error-message" role="alert">
          {loadError}
          {#if !selectedId}<button onclick={loadLists}>Retry</button>{/if}
        </p>{/if}
      {#if selectedId}
        <div class="list-actions">
          <button class="quiet danger" disabled={busy} onclick={deleteList}
            >Delete list</button
          >
        </div>
        {#if current}
          {#key current}
            {@const session = current}
            <EditorPane
              {session}
              reveal={searchReveal?.listId === selectedId ? searchReveal : null}
              disabled={busy}
              ondirty={() => session.sync.markDirty()}
            />
          {/key}
        {/if}
      {:else if !loading}
        <div class="empty">
          <p>A clear space for your next thought.</p>
          <button disabled={busy} onclick={newList}
            >＋ Create your first list</button
          >
        </div>
      {/if}
    </div>
    <footer>Small thoughts. Clearer days.<span>FORGET ME NOT</span></footer>
  </main>
</div>
