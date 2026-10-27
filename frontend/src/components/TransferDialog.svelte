<script lang="ts">
  import { downloadText, downloadJson } from '../lib/download';
  import { ApiError } from '../lib/api';
  import { parsePortable, countItems, MAX_FILE_BYTES } from '../lib/portable';
  import type { Portable } from '../lib/portable';
  let {
    currentTitle,
    hasLists,
    disabled = false,
    onexport,
    onimport,
    onrefresh,
    ondecode,
    onencode,
  }: {
    currentTitle: string | null;
    hasLists: boolean;
    disabled?: boolean;
    onexport: (scope: 'current' | 'all') => Promise<Portable>;
    onimport: (document: Portable) => Promise<number>;
    onrefresh: () => Promise<void>;
    ondecode: typeof import('../lib/api').api.decodeFile;
    onencode: typeof import('../lib/api').api.encodeFile;
  } = $props();
  let dialog = $state<HTMLDialogElement>();
  let fileInput = $state<HTMLInputElement>();
  let preview = $state.raw<Portable>();
  let filename = $state('');
  let error = $state('');
  let message = $state('');
  let busy = $state(false);
  let uncertain = $state(false);
  let readVersion = 0;
  let exportFormat = $state<'json' | 'markdown'>('json');
  let warnings = $state<string[]>([]);
  let reading = $state(false);
  const items = $derived(preview ? countItems(preview) : 0);
  function open() {
    error = '';
    message = '';
    dialog?.showModal();
  }
  async function choose(event: Event) {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    const version = ++readVersion;
    reading = false;
    preview = undefined;
    warnings = [];
    error = '';
    message = '';
    uncertain = false;
    filename = file?.name ?? '';
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      error = '$: File exceeds 8 MiB';
      return;
    }
    try {
      reading = true;
      const text = new TextDecoder('utf-8', { fatal: true }).decode(
        await file.arrayBuffer(),
      );
      const format = /\.(md|markdown)$/i.test(file.name) ? 'markdown' : 'json';
      if (format === 'json') parsePortable(text);
      const result = await ondecode(format, text);
      if (version === readVersion) {
        preview = result.document;
        warnings = result.warnings;
      }
    } catch (reason) {
      if (version === readVersion)
        error =
          reason instanceof Error ? reason.message : 'Could not read file';
    } finally {
      if (version === readVersion) reading = false;
    }
  }
  async function download(scope: 'current' | 'all') {
    busy = true;
    error = '';
    message = '';
    warnings = [];
    try {
      const document = await onexport(scope);
      const name =
        scope === 'current' ? (currentTitle ?? 'list') : 'forget-me-not-lists';
      if (exportFormat === 'json') {
        // Keep local JSON recovery/export available without the conversion service.
        downloadJson(document, name);
      } else {
        const result = await onencode(exportFormat, document);
        downloadText(result.text, name, result.extension, result.mediaType);
        warnings = result.warnings;
      }
      message = `${exportFormat === 'json' ? 'JSON' : 'Markdown'} export downloaded.`;
    } catch (reason) {
      error = reason instanceof Error ? reason.message : 'Export failed';
    } finally {
      busy = false;
    }
  }
  async function apply() {
    if (!preview || busy || reading || uncertain) return;
    busy = true;
    error = '';
    message = '';
    try {
      const count = await onimport(preview);
      message = `Imported ${count} ${count === 1 ? 'list' : 'lists'} as new copies.`;
      preview = undefined;
      filename = '';
      if (fileInput) fileInput.value = '';
    } catch (reason) {
      uncertain = !(reason instanceof ApiError);
      error = reason instanceof Error ? reason.message : 'Import failed';
      if (uncertain && fileInput) fileInput.value = '';
      if (uncertain)
        error +=
          ' The response was not confirmed; import may have completed. Check your lists before selecting the file again. The request will not be retried automatically.';
    } finally {
      busy = false;
    }
  }
  async function refresh() {
    busy = true;
    try {
      await onrefresh();
      message =
        'List index refreshed. Check the sidebar for imported copies before importing again.';
    } catch (reason) {
      error =
        reason instanceof Error ? reason.message : 'Could not refresh lists';
    } finally {
      busy = false;
    }
  }
</script>

<button
  class="new-list"
  {disabled}
  onclick={open}
  aria-haspopup="dialog"
  aria-controls="json-transfer">⇅ Import / export</button
>
<dialog
  class="guide transfer"
  id="json-transfer"
  bind:this={dialog}
  aria-labelledby="transfer-title"
  onclose={() => {
    readVersion++;
    reading = false;
  }}
  oncancel={(event) => {
    if (busy) event.preventDefault();
  }}
>
  <div class="guide-header">
    <h2 id="transfer-title">Import / export</h2>
    <button
      class="quiet"
      disabled={busy}
      onclick={() => dialog?.close()}
      aria-label="Close import and export">✕</button
    >
  </div>
  <section aria-label="Export files">
    <h3>Export</h3>
    <p>
      Current list includes your latest edits, even if they are not saved yet.
      Export all saves pending edits first, then downloads all saved lists.
    </p>
    <label
      >Export format <select bind:value={exportFormat} disabled={busy}>
        <option value="json">JSON — complete portable format</option>
        <option value="markdown">Markdown — one outline</option>
      </select></label
    >
    {#if exportFormat === 'markdown'}<p>
        Markdown omits IDs and normalizes bullets. Export one list at a time;
        use JSON for all lists.
      </p>{/if}
    <div class="transfer-actions">
      <button
        disabled={busy || reading || !currentTitle}
        onclick={() => download('current')}>Export current list</button
      ><button
        disabled={busy || reading || !hasLists || exportFormat === 'markdown'}
        onclick={() => download('all')}>Export all lists</button
      >
    </div>
  </section>
  <section aria-label="Import files">
    <h3>Import new copies</h3>
    <p>
      Existing lists stay unchanged. Every imported list and item receives a new
      ID. JSON or outline Markdown, up to 8 MiB.
    </p>
    <label class="file-label"
      >Choose JSON or Markdown file<input
        bind:this={fileInput}
        type="file"
        accept=".json,.md,.markdown,application/json,text/markdown"
        disabled={busy}
        onchange={choose}
      /></label
    >
    {#if reading}<p role="status">Preparing preview…</p>{/if}
    {#if preview}
      <div class="import-preview" aria-label="Import preview">
        <strong>{filename}</strong>
        <p>
          {preview.lists.length}
          {preview.lists.length === 1 ? 'list' : 'lists'} · {items}
          {items === 1 ? 'item' : 'items'}
        </p>
        <ul>
          {#each preview.lists as list (list.id)}<li>{list.title}</li>{/each}
        </ul>
      </div>
      <button
        class="import-confirm"
        disabled={busy || uncertain}
        onclick={apply}>{busy ? 'Importing…' : 'Import as new copies'}</button
      >
    {/if}
  </section>
  {#if warnings.length}<ul class="transfer-warnings" aria-label="Format notes">
      {#each warnings as warning}<li>{warning}</li>{/each}
    </ul>{/if}
  {#if error}<p class="error-message" role="alert">{error}</p>{/if}
  {#if uncertain}<button
      class="import-confirm"
      disabled={busy}
      onclick={refresh}>Refresh list index</button
    >{/if}
  {#if message}<p class="transfer-success" role="status">{message}</p>{/if}
</dialog>
