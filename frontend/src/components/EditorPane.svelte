<script lang="ts">
  import { tick, untrack, onDestroy, onMount } from 'svelte';
  import { locate, visibleItems } from '../lib/editor';
  import type { Editor, Item, Command } from '../lib/editor';
  import { textLinks, compactUrl } from '../lib/links';
  import { autoSize } from '../lib/auto-size';
  import MarkdownView from './MarkdownView.svelte';
  import { markdown } from '../lib/markdown';
  import DateDialog from './DateDialog.svelte';
  import { localToday, dueStatus } from '../lib/dates';
  import TagsDialog from './TagsDialog.svelte';
  import { tagNames, taggedItems } from '../lib/tags';
  import NoteDialog from './NoteDialog.svelte';
  import MarkedText from './MarkedText.svelte';
  let {
    session,
    disabled = false,
    ondirty,
    reveal = null,
    searchQuery = '',
    onclearsearch = () => {},
    onrevealed = () => {},
    preferences = null,
    oncollapse = () => {},
    onretryview = () => {},
  }: {
    session: { editor: Editor; collapsed: Set<string> };
    disabled?: boolean;
    ondirty: () => void;
    preferences?: {
      collapsedItemIds: string[];
      version: number;
      error: string;
      loading: boolean;
      dirty: boolean;
    } | null;
    oncollapse?: (id: string, collapsed: boolean) => void;
    onretryview?: () => void;
    reveal?: {
      id: string | null;
      query: string;
      token: number;
      pending: boolean;
      note?: boolean;
    } | null;
    searchQuery?: string;
    onclearsearch?: () => void;
    onrevealed?: (token: number) => void;
  } = $props();
  const initial = untrack(() => session);
  const editor = initial.editor;
  onDestroy(() => {
    initial.collapsed = new Set(collapsed);
  });
  let today = $state(localToday());
  onMount(() => {
    const refresh = () => {
      today = localToday();
    };
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  });
  let dateItem = $state<{ id: string; text: string; dueDate: string } | null>(
    null,
  );
  async function openDate(id: string) {
    const item = locate(editor.state.nodes, id)?.item;
    if (!item) return;
    editor.setFocus({ id, mode: 'navigate', start: 0, end: 0 });
    await render();
    dateItem = { id, text: item.text, dueDate: item.dueDate ?? '' };
  }
  let markdownEnabled = $state(true);
  let tagFilter = $state('');
  let tagItem = $state<{ id: string; text: string; tags: string[] } | null>(
    null,
  );
  async function openTags(id: string) {
    const item = locate(editor.state.nodes, id)?.item;
    if (!item) return;
    editor.setFocus({ id, mode: 'navigate', start: 0, end: 0 });
    await render();
    tagItem = { id, text: item.text, tags: [...(item.tags ?? [])] };
  }
  function setFilter(tag: string, preferredId?: string, restoreFocus = false) {
    capture();
    tagFilter = tag;
    if (!tag) {
      const next = new Set(collapsed);
      for (
        let at = locate(
          editor.state.nodes,
          preferredId ?? editor.state.focus.id,
        );
        at?.parent;
        at = locate(editor.state.nodes, at.parent.id)
      )
        next.delete(at.parent.id);
      collapsed = next;
    }
    const candidates = tag
      ? taggedItems(editor.state.nodes, tag)
      : visibleItems(editor.state.nodes, collapsed);
    const id =
      candidates.find(
        ({ item }) => item.id === (preferredId ?? editor.state.focus.id),
      )?.item.id ??
      candidates.find(({ item }) => item.tags?.includes(tag))?.item.id ??
      candidates[0]?.item.id ??
      null;
    editor.setFocus({ id, mode: 'navigate', start: 0, end: 0 });
    void render(restoreFocus);
  }
  let noteItem = $state<{ id: string; text: string; note: string } | null>(
    null,
  );
  async function openNote(id: string) {
    const item = locate(editor.state.nodes, id)?.item;
    if (!item) return;
    editor.setFocus({ id, mode: 'navigate', start: 0, end: 0 });
    await render();
    noteItem = { id, text: item.text, note: item.note ?? '' };
  }
  let view = $state(editor.state);
  const availableTags = $derived(tagNames(view.nodes));
  let collapsed = $state<Set<string>>(
    new Set(untrack(() => preferences?.collapsedItemIds) ?? initial.collapsed),
  );
  let previousManual = new Set<string>();
  $effect(() => {
    const snapshot = preferences;
    if (!snapshot) return;
    untrack(() => {
      const manual = new Set(snapshot.collapsedItemIds);
      const next = new Set(collapsed);
      for (const id of new Set([...previousManual, ...manual])) {
        if (previousManual.has(id) === manual.has(id)) continue;
        if (manual.has(id)) next.add(id);
        else next.delete(id);
      }
      // Remote preferences must never remove a focused editor from the DOM.
      for (
        let at = locate(editor.state.nodes, editor.state.focus.id);
        at?.parent;
        at = locate(editor.state.nodes, at.parent.id)
      )
        next.delete(at.parent.id);
      previousManual = manual;
      collapsed = next;
    });
  });
  let version = $state(0);
  let announcement = $state('');
  let composing = false;
  let outline = $state<HTMLDivElement>();
  let emptyButton = $state<HTMLButtonElement>();
  let addButton = $state<HTMLButtonElement>();
  let toolbarHeight = $state(0);
  $effect(() => {
    const request = reveal;
    if (request?.id && request.pending)
      untrack(() => {
        // Consume the navigation intent before any await: remounts retain only highlighting.
        onrevealed(request.token);
        void revealItem(request.id!, request.note ?? false);
      });
  });
  async function revealItem(id: string, note = false) {
    tagFilter = '';
    editor.setFocus({ id, mode: 'navigate', start: 0, end: 0 });
    await render();
    outline
      ?.querySelector<HTMLElement>(`[data-item="${id}"]`)
      ?.scrollIntoView({ block: 'center' });
    if (note) await openNote(id);
  }
  const rows = $derived(
    tagFilter
      ? taggedItems(view.nodes, tagFilter)
      : visibleItems(view.nodes, collapsed),
  );
  const active = $derived(locate(view.nodes, view.focus.id));
  const total = $derived(visibleItems(view.nodes, new Set()).length);
  const canUndo = $derived.by(() => {
    void version;
    return editor.past.length > 0;
  });
  const canRedo = $derived.by(() => {
    void version;
    return editor.future.length > 0;
  });

  function capture() {
    const element = document.activeElement;
    if (
      element instanceof HTMLTextAreaElement &&
      element.dataset.item === view.focus.id
    ) {
      editor.setFocus({
        ...editor.state.focus,
        start: element.selectionStart,
        end: element.selectionEnd,
      });
    }
  }

  async function render(restore = true) {
    const focus = { ...editor.state.focus };
    const renderingEditor = editor;
    // Copy out of the model: Svelte proxies never enter history or structuredClone.
    view = structuredClone(editor.state);
    version++;
    if (!restore) return;
    // Reveal ancestors when undo restores an item inside a collapsed branch.
    const path = (nodes: Item[], id: string | null): string[] | null => {
      for (const item of nodes) {
        if (item.id === id) return [];
        const child = path(item.children, id);
        if (child) return [item.id, ...child];
      }
      return null;
    };
    const ancestors = path(editor.state.nodes, editor.state.focus.id) ?? [];
    collapsed = new Set([...collapsed].filter((id) => !ancestors.includes(id)));
    await tick();
    if (editor !== renderingEditor) return;
    editor.setFocus(focus);
    if (!focus.id) {
      emptyButton?.focus();
      return;
    }
    const element = outline?.querySelector<HTMLElement>(
      `[data-item="${focus.id}"]`,
    );
    element?.focus();
    if (element instanceof HTMLTextAreaElement)
      element.setSelectionRange(focus.start, focus.end);
  }

  function focusItem(id: string, edit = false) {
    editor.setFocus({ id, mode: edit ? 'edit' : 'navigate', start: 0, end: 0 });
    void render();
  }

  function command(action: Command) {
    if (composing || disabled) return;
    if (tagFilter && !['convert', 'complete'].includes(action)) {
      announcement = 'Clear the tag filter before changing structure.';
      return;
    }
    capture();
    const parent =
      action === 'indent' && active && active.index > 0
        ? active.siblings[active.index - 1].id
        : null;
    if (editor.execute(action, collapsed)) {
      if (parent) {
        collapsed = new Set(collapsed);
        collapsed.delete(parent);
      }
      announcement =
        action === 'delete'
          ? 'Branch deleted. Undo is available.'
          : `Item ${action}.`;
      ondirty();
      void render();
    }
  }

  function history(redo = false) {
    if (composing || disabled) return;
    capture();
    tagFilter = '';
    if (redo ? editor.redo() : editor.undo()) {
      announcement = redo ? 'Change redone.' : 'Change undone.';
      ondirty();
      void render();
    }
  }

  function collapse(id: string) {
    if (tagFilter) return;
    const at = locate(editor.state.nodes, id);
    if (!at?.item.children.length) return;
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else {
      next.add(id);
      if (locate(at.item.children, editor.state.focus.id)) {
        editor.setFocus({ id, mode: 'navigate', start: 0, end: 0 });
      }
    }
    collapsed = next;
    oncollapse(id, next.has(id));
    void render();
  }

  function input(event: Event) {
    const element = event.currentTarget as HTMLTextAreaElement;
    if (disabled) return;
    if (
      editor.edit(element.value, element.selectionStart, element.selectionEnd)
    )
      ondirty();
    void render(false);
  }

  function selection(event: Event) {
    const element = event.currentTarget as HTMLTextAreaElement;
    // Ignore queued selection events from an editor that has already been left.
    if (
      !element.isConnected ||
      editor.state.focus.mode !== 'edit' ||
      element.dataset.item !== editor.state.focus.id
    )
      return;
    editor.setFocus({
      id: element.dataset.item!,
      mode: 'edit',
      start: element.selectionStart,
      end: element.selectionEnd,
    });
  }

  function keys(event: KeyboardEvent) {
    if (event.isComposing || composing || event.keyCode === 229) return;
    const target = event.target as HTMLElement;
    if (!target.dataset.item) return;
    const edit = target instanceof HTMLTextAreaElement;
    const mod = event.metaKey || event.ctrlKey;
    if (mod && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      history(event.shiftKey);
      return;
    }
    if (mod) return;
    if (event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault();
      command(event.key === 'ArrowUp' ? 'up' : 'down');
      return;
    }
    if (event.altKey) return;
    if (event.key === 'Enter' && !(edit && event.shiftKey)) {
      event.preventDefault();
      command('add');
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      command(event.shiftKey ? 'outdent' : 'indent');
      return;
    }
    if (edit) {
      if (event.key === 'Escape') {
        event.preventDefault();
        capture();
        if (editor.cancelNewItem()) ondirty();
        editor.setFocus({ ...editor.state.focus, mode: 'navigate' });
        void render();
      }
      if (
        [
          'ArrowUp',
          'ArrowDown',
          'ArrowLeft',
          'ArrowRight',
          'Home',
          'End',
        ].includes(event.key)
      )
        editor.breakGroup();
      return;
    }
    const index = rows.findIndex(({ item }) => item.id === view.focus.id);
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const item = rows[index + (event.key === 'ArrowUp' ? -1 : 1)]?.item;
      if (item) focusItem(item.id);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      if (tagFilter) setFilter('', undefined, true);
      else addButton?.focus();
    } else if (event.key.toLowerCase() === 'd') {
      event.preventDefault();
      void openDate(view.focus.id!);
    } else if (event.key.toLowerCase() === 't') {
      event.preventDefault();
      void openTags(view.focus.id!);
    } else if (event.key.toLowerCase() === 'n') {
      event.preventDefault();
      void openNote(view.focus.id!);
    } else if (event.key.toLowerCase() === 'l') {
      const link = target
        .closest('.row')
        ?.querySelector<HTMLAnchorElement>('.item-links a');
      if (link) {
        event.preventDefault();
        link.focus();
      }
    } else if (event.key === 'Delete' && !event.shiftKey) {
      event.preventDefault();
      command('delete');
    } else if (event.key === 'F2') {
      event.preventDefault();
      focusItem(view.focus.id!, true);
    } else if (event.key === ' ') {
      event.preventDefault();
      command('complete');
    } else if (event.key === 'ArrowLeft' && active) {
      event.preventDefault();
      if (tagFilter) {
        if (active.parent) focusItem(active.parent.id);
      } else if (active.item.children.length && !collapsed.has(active.item.id))
        collapse(active.item.id);
      else if (active.parent) focusItem(active.parent.id);
    } else if (event.key === 'ArrowRight' && active) {
      event.preventDefault();
      if (tagFilter) {
        const child = rows[index + 1];
        if (child && child.depth > rows[index].depth) focusItem(child.item.id);
      } else if (collapsed.has(active.item.id)) collapse(active.item.id);
      else if (active.item.children[0]) focusItem(active.item.children[0].id);
    }
  }
</script>

<div inert={disabled} style:--outline-toolbar-height={`${toolbarHeight}px`}>
  <div
    class="toolbar"
    aria-label="Item actions"
    bind:clientHeight={toolbarHeight}
  >
    {#if preferences}<div
        class="outline-preferences"
        role="status"
        aria-label="Outline preferences"
      >
        {#if preferences.error}<span
            >Outline preferences not synced: {preferences.error}</span
          ><button onclick={onretryview}>Retry view sync</button>
        {:else if preferences.loading}Loading outline preferences…{:else if preferences.dirty}Saving
          outline preferences…{:else}Outline preferences saved{/if}
      </div>{/if}
    {#if searchQuery}<div
        class="search-context-bar"
        aria-label="Search context"
      >
        <span>Search result: <strong>{searchQuery}</strong></span>
        <button
          onclick={() => {
            onclearsearch();
            void render();
          }}>Clear search</button
        >
      </div>{/if}
    <button
      bind:this={addButton}
      onclick={() => command('add')}
      disabled={!!tagFilter}>＋ Add item</button
    >
    <span class="divider"></span>
    <button onclick={() => history()} disabled={!canUndo} aria-label="Undo"
      >↶ Undo</button
    >
    <button onclick={() => history(true)} disabled={!canRedo} aria-label="Redo"
      >↷ Redo</button
    >
    <span class="divider"></span>
    <button
      onclick={() => command('indent')}
      disabled={!!tagFilter || !active || active.index === 0}>Indent →</button
    >
    <button
      onclick={() => command('outdent')}
      disabled={!!tagFilter || !active?.parent}>← Outdent</button
    >
    <button
      onclick={() => command('up')}
      disabled={!!tagFilter || !active || active.index === 0}
      aria-label="Move branch up">↑</button
    >
    <button
      onclick={() => command('down')}
      disabled={!!tagFilter ||
        !active ||
        active.index === active.siblings.length - 1}
      aria-label="Move branch down">↓</button
    >
    <button
      disabled={!active}
      onclick={() => active && void openNote(active.item.id)}>Note</button
    >
    <button
      disabled={!active}
      onclick={() => active && void openTags(active.item.id)}>Tags</button
    >
    <button
      disabled={!active}
      onclick={() => active && void openDate(active.item.id)}>Date</button
    >
    <label class="markdown-toggle"
      ><input type="checkbox" bind:checked={markdownEnabled} /> Markdown preview</label
    >
    {#if availableTags.length || tagFilter}<div class="tag-filter-bar">
        <label
          >Filter by tag <select
            value={tagFilter}
            onchange={(event) => setFilter(event.currentTarget.value)}
          >
            <option value="">All items</option>
            {#if tagFilter && !availableTags.includes(tagFilter)}<option
                value={tagFilter}>{tagFilter}</option
              >{/if}
            {#each availableTags as tag}<option value={tag}>{tag}</option
              >{/each}
          </select></label
        >
        {#if tagFilter}<span
            >{rows.filter(({ item }) => item.tags?.includes(tagFilter)).length} matches
            · ancestors shown · structure locked</span
          ><button onclick={() => setFilter('', undefined, true)}
            >Clear tag filter</button
          >{/if}
      </div>{/if}
  </div>

  <div
    class="outline"
    bind:this={outline}
    role="group"
    aria-label="List editor"
  >
    {#each rows as { item, depth } (item.id)}
      {@const parts = textLinks(item.text)}
      {@const links = markdownEnabled
        ? markdown(item.text).links
        : [
            ...new Set(parts.flatMap((part) => (part.href ? [part.href] : []))),
          ].map((href) => ({ href, label: new URL(href).hostname }))}
      <div
        class="row"
        class:active={view.focus.id === item.id}
        class:completed={item.completed}
        class:search-match={reveal?.id === item.id}
        class:filter-context={!!tagFilter && !item.tags?.includes(tagFilter)}
        style:--depth={depth}
      >
        <button
          class="collapse"
          disabled={!!tagFilter}
          class:invisible={!item.children.length}
          tabindex={item.children.length ? 0 : -1}
          aria-label={`${collapsed.has(item.id) ? 'Expand' : 'Collapse'} ${item.text || 'empty item'}`}
          aria-expanded={item.children.length
            ? !!tagFilter || !collapsed.has(item.id)
            : undefined}
          onclick={() => collapse(item.id)}
          >{!tagFilter && collapsed.has(item.id) ? '▸' : '▾'}</button
        >
        {#if item.kind === 'task'}
          <input
            type="checkbox"
            aria-label={`Complete ${item.text || 'empty task'}`}
            checked={item.completed}
            onchange={() => {
              editor.setFocus({
                id: item.id,
                mode: 'navigate',
                start: 0,
                end: 0,
              });
              command('complete');
            }}
          />
        {:else}<span class="bullet">•</span>{/if}
        {#if view.focus.id === item.id && view.focus.mode === 'edit'}
          <textarea
            use:autoSize={item.text}
            data-item={item.id}
            aria-label="Item text"
            onkeydown={keys}
            rows={Math.max(1, item.text.split('\n').length)}
            value={item.text}
            onbeforeinput={selection}
            oninput={input}
            onselect={selection}
            onclick={() => editor.breakGroup()}
            oncompositionstart={() => {
              composing = true;
              editor.breakGroup();
            }}
            oncompositionend={(event) => {
              composing = false;
              input(event);
              editor.breakGroup();
            }}
            onblur={() => editor.breakGroup()}></textarea>
        {:else}
          <div class="item-content">
            <button
              class="item-text"
              onkeydown={keys}
              data-item={item.id}
              onfocus={() => {
                if (editor.state.focus.id !== item.id) {
                  editor.setFocus({
                    id: item.id,
                    mode: 'navigate',
                    start: 0,
                    end: 0,
                  });
                  void render(false);
                }
              }}
              onclick={() => focusItem(item.id, true)}
              >{#if item.text}{#if markdownEnabled}<MarkdownView
                    text={item.text}
                    query={reveal?.id === item.id ? reveal.query : ''}
                  />{:else}{#each parts as part}{#if part.href}<span
                        title={part.text}
                        ><MarkedText
                          text={compactUrl(part.text)}
                          query={reveal?.id === item.id ? reveal.query : ''}
                        /></span
                      >{:else}<MarkedText
                        text={part.text}
                        query={reveal?.id === item.id ? reveal.query : ''}
                      />{/if}{/each}{/if}{:else}Empty item{/if}</button
            >
            {#if item.tags?.length}<div
                class="item-tags"
                aria-label={`Tags for ${item.text || 'empty item'}`}
              >
                {#each item.tags as tag}<button
                    class:tag-selected={tagFilter === tag}
                    aria-label={`Filter by tag ${tag}`}
                    onclick={() => setFilter(tag, item.id, true)}
                    ><MarkedText
                      text={tag}
                      query={reveal?.id === item.id ? reveal.query : ''}
                    /></button
                  >{/each}
              </div>{/if}
            {#if tagFilter && !item.tags?.includes(tagFilter)}<span
                class="tag-context-label">Context</span
              >{/if}
            {#if links.length}
              <div class="item-links" aria-label="Item links">
                {#each links as link}
                  {@const href = link.href}
                  <a
                    {href}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={href}
                    aria-label={`Open ${href} in a new tab`}
                    onkeydown={(event) => {
                      if (event.key === 'Escape') {
                        event.preventDefault();
                        focusItem(item.id);
                      }
                    }}>↗ {link.label}</a
                  >
                {/each}
              </div>
            {/if}
          </div>
        {/if}
        {#if item.dueDate}
          {@const status = dueStatus(item.dueDate, item.completed, today)}
          <button
            class="due-date"
            class:due-overdue={status === 'overdue'}
            class:due-today={status === 'today'}
            class:due-done={status === 'done'}
            aria-label={`Edit due date for ${item.text || 'empty item'}`}
            onclick={() => void openDate(item.id)}
            title="Edit due date"
          >
            <MarkedText
              text={item.dueDate}
              query={reveal?.id === item.id ? reveal.query : ''}
            />{status === 'overdue'
              ? ' · Overdue'
              : status === 'today'
                ? ' · Today'
                : status === 'done'
                  ? ' · Done'
                  : ''}
          </button>
        {/if}
        {#if item.tags?.length}<button
            class="note-indicator"
            aria-label={`Edit tags for ${item.text || 'empty item'}`}
            onclick={() => void openTags(item.id)}>⌗</button
          >{/if}
        {#if item.note}<button
            class="note-indicator"
            aria-label={`Edit note for ${item.text || 'empty item'}`}
            title="Item has a note"
            onclick={() => void openNote(item.id)}>▤</button
          >{/if}
      </div>
    {/each}
    {#if tagFilter && !rows.length}<div class="empty">
        <p>No items match this tag.</p>
        <button onclick={() => setFilter('', undefined, true)}
          >Clear tag filter</button
        >
      </div>
    {:else if !rows.length}<div class="empty">
        <p>A clear page. What’s on your mind?</p>
        <button bind:this={emptyButton} onclick={() => command('add')}
          >＋ Add your first item</button
        >
      </div>{/if}
  </div>

  <div class="item-footer">
    <span
      >{total}
      {total === 1 ? 'item' : 'items'} <span class="footer-dot">·</span>
      {view.focus.mode === 'edit' ? 'Editing' : 'Navigation'}</span
    >
    <div>
      <button
        class="quiet"
        disabled={!active}
        onclick={() => command('convert')}
        >{active?.item.kind === 'task'
          ? 'Make plain item'
          : 'Make task'}</button
      ><button
        class="quiet danger"
        disabled={!!tagFilter || !active}
        onclick={() => command('delete')}>Delete branch</button
      >
    </div>
  </div>

  <p class="hint">
    <kbd>Enter</kbd> to add <span>·</span> <kbd>Tab</kbd> / <kbd>Shift+Tab</kbd>
    to indent / outdent
    <span>·</span> <kbd>Esc</kbd> to navigate
  </p>
</div>
<div class="sr-only" aria-live="polite">{announcement}</div>

<NoteDialog
  item={noteItem}
  onapply={(id, note) => {
    if (editor.setNote(id, note)) {
      ondirty();
      void render(false);
    }
  }}
  onclose={() => {
    noteItem = null;
    void render();
  }}
/>

<TagsDialog
  item={tagItem}
  suggestions={availableTags}
  onapply={(id, tags) => {
    if (editor.setTags(id, tags)) {
      if (tagFilter && !tags.includes(tagFilter)) tagFilter = '';
      ondirty();
      void render(false);
    }
  }}
  onclose={() => {
    tagItem = null;
    void render();
  }}
/>

<DateDialog
  item={dateItem}
  onapply={(id, date) => {
    if (editor.setDueDate(id, date)) {
      ondirty();
      void render(false);
    }
  }}
  onclose={() => {
    dateItem = null;
    void render();
  }}
/>
