<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { Snippet } from 'svelte';
  import { downloadJson } from './lib/download';
  let {
    authenticated = false,
    account,
  }: { authenticated?: boolean; account?: Snippet } = $props();
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

  let showBackToTop = $state(false);
  function scrollToTop() {
    (titleEditing ? titleInput : titleButton)?.focus({ preventScroll: true });
    window.scrollTo({
      top: 0,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'instant'
        : 'smooth',
    });
  }
  let searchQuery = $state('');
  let searchSequence = 0;
  function clearSearch() {
    searchReveal = null;
    searchQuery = '';
  }
  let searchReveal = $state<{
    listId: string;
    id: string | null;
    query: string;
    token: number;
    pending: boolean;
    note: boolean;
  } | null>(null);
  let outlinePreferences = $state.raw<{
    collapsedItemIds: string[];
    version: number;
    error: string;
    loading: boolean;
    dirty: boolean;
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
  let remoteChanged = $state(false);
  let refreshError = $state('');
  let picker = $state<HTMLDialogElement>();
  let pickerOpen = $state(false);
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
      const replacing =
        current &&
        workspace.current &&
        current !== workspace.current &&
        selectedId === workspace.selectedId;
      const scroll = replacing ? window.scrollY : null;
      const focusedItem =
        replacing && document.activeElement instanceof HTMLElement
          ? document.activeElement.closest<HTMLElement>('[data-item]')?.dataset
              .item
          : null;
      current = workspace.current;
      if (scroll !== null)
        void tick().then(() => {
          if (focusedItem && current?.editor.state.focus.id === focusedItem)
            document
              .querySelector<HTMLElement>(`[data-item="${focusedItem}"]`)
              ?.focus({ preventScroll: true });
          window.scrollTo({ top: scroll, behavior: 'instant' });
        });
      remoteChanged = !!current?.remoteChanged;
      refreshError = workspace.refreshError;
      const outline = current?.outline;
      outlinePreferences = outline
        ? {
            collapsedItemIds: [...outline.collapsed],
            version: outline.version,
            error: outline.error,
            loading: outline.loading,
            dirty: outline.dirty,
          }
        : null;
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

  export async function pauseForAuthentication() {
    await workspace.pauseForAuthentication();
  }
  export async function resumeAfterAuthentication() {
    await workspace.resumeAfterAuthentication();
  }
  export async function prepareLogout(keepDrafts = false) {
    finishRename();
    await workspace.prepareLogout(keepDrafts);
  }
  export function downloadLocalEdits() {
    finishRename();
    downloadJson(workspace.localEdits(), 'forget-me-not-local-edits');
  }

  function updateUrl() {
    const url = new URL(location.href);
    if (selectedId) url.searchParams.set('list', selectedId);
    else url.searchParams.delete('list');
    window.history.replaceState(null, '', url);
  }
  async function openList(id: string) {
    finishRename();
    if (await workspace.open(id)) {
      updateUrl();
      picker?.close();
      void workspace.refreshRemote();
    }
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
    current.titleEditing = true;
    await tick();
    titleInput?.focus();
    titleInput?.select();
  }
  function finishRename(cancel = false, restoreFocus = false) {
    if (!titleEditing) return;
    titleEditing = false;
    if (current) current.titleEditing = false;
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
    const trackScroll = () => {
      showBackToTop = window.scrollY > 400;
    };
    trackScroll();
    const refreshView = () => {
      if (document.visibilityState === 'visible') {
        void workspace.refreshOutline();
        void workspace.refreshRemote();
      }
    };
    const poll = window.setInterval(refreshView, 15_000);
    window.addEventListener('online', refreshView);
    window.addEventListener('focus', refreshView);
    document.addEventListener('visibilitychange', refreshView);
    window.addEventListener('scroll', trackScroll, { passive: true });
    window.addEventListener('beforeunload', warn);
    return () => {
      clearInterval(poll);
      window.removeEventListener('online', refreshView);
      window.removeEventListener('focus', refreshView);
      document.removeEventListener('visibilitychange', refreshView);
      window.removeEventListener('scroll', trackScroll);
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
    <button
      class="mobile-list-picker"
      aria-haspopup="dialog"
      onclick={() => {
        pickerOpen = true;
        picker?.showModal();
      }}
    >
      <span class="list-name">{selectedId ? title : 'Choose a list'}</span><span
        >▾</span
      >
    </button>
    <nav class="desktop-lists" aria-label="Lists">
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
    <dialog
      class="guide list-picker"
      onclose={() => (pickerOpen = false)}
      bind:this={picker}
      aria-labelledby="list-picker-title"
    >
      <div class="guide-header">
        <h2 id="list-picker-title">Choose a list</h2>
        <button
          class="quiet"
          aria-label="Close list picker"
          onclick={() => picker?.close()}>✕</button
        >
      </div>
      <nav aria-label="Choose a list">
        {#if pickerOpen}
          {#each lists as list (list.id)}
            <button
              class="list-link"
              class:selected={selectedId === list.id}
              disabled={busy}
              aria-current={selectedId === list.id ? 'page' : undefined}
              onclick={() => openList(list.id)}
            >
              <span class="list-name">{list.title}</span><span class="count"
                >{list.itemCount}</span
              >
            </button>
          {/each}
        {/if}
      </nav>
      <button
        class="new-list"
        disabled={busy || loading}
        onclick={() => {
          picker?.close();
          void newList();
        }}>＋ New list</button
      >
    </dialog>
    <SearchDialog
      bind:query={searchQuery}
      onreset={clearSearch}
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
          token: ++searchSequence,
          pending: !!hit.itemId,
          note: hit.field === 'note',
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
    <div class="sidebar-footer" class:has-account={authenticated}>
      {@render account?.()}
      <div class="sidebar-bottom">
        <span class="local-dot"></span>
        {authenticated ? 'Private account' : 'Local only · no login'}
        <span class="version">M11</span>
      </div>
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
            onclick={beginRename}
            >{loadError && !selectedId ? 'Could not load lists' : title}</button
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
        {#if loading}Loading lists…{:else if loadError && !selectedId}Lists
          could not be loaded.{:else if selectedId}
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
      {#if remoteChanged}<p class="remote-notice" role="status">
          This list changed on another device. Local editing is kept; finish
          editing before loading the server version.
        </p>{/if}
      {#if refreshError}<p class="error-message" role="status">
          Remote update check failed: {refreshError}
          <button onclick={() => workspace.refreshRemote()}>Check again</button>
        </p>{/if}
      <RecoveryPanel
        records={draftRecords}
        storageError={draftError}
        conflict={remoteChanged ||
          saveStatus === 'conflict' ||
          saveStatus === 'error'}
        disabled={busy ||
          loading ||
          !!current?.interactionBlocked ||
          titleEditing}
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
              oninteraction={(blocked) =>
                workspace.setInteractionBlocked(session, blocked)}
              preferences={outlinePreferences}
              oncollapse={(id, collapsed) =>
                session.outline?.set(id, collapsed)}
              onretryview={() => void session.outline?.retry()}
              reveal={searchReveal?.listId === selectedId ? searchReveal : null}
              searchQuery={searchReveal?.query ?? ''}
              onclearsearch={clearSearch}
              onrevealed={(token) => {
                if (searchReveal?.token === token)
                  searchReveal = { ...searchReveal, pending: false };
              }}
              disabled={busy}
              ondirty={() => session.sync.markDirty()}
            />
          {/key}
        {/if}
      {:else if !loading && !loadError}
        <div class="empty workspace-empty">
          <h2>Your space starts here</h2>
          <p>
            Create a list for your thoughts, tasks or links. You can add more
            lists whenever you need them.
          </p>
          <button disabled={busy} onclick={newList}
            >＋ Create your first list</button
          >
        </div>
      {/if}
    </div>
    <footer>Small thoughts. Clearer days.<span>FORGET ME NOT</span></footer>
  </main>
</div>

{#if showBackToTop}<button
    class="back-to-top"
    aria-label="Back to top"
    onclick={scrollToTop}>↑ Top</button
  >{/if}
