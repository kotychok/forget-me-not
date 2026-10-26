<script lang="ts">
  import type { Draft } from '../lib/draft-storage';
  import type { Portable } from '../lib/portable';
  import { visibleItems } from '../lib/editor';
  import { downloadJson } from '../lib/download';
  let {
    records,
    storageError,
    conflict,
    disabled = false,
    onrefresh,
    onretry,
    onrecover,
    ondiscard,
    oncopy,
    onload,
    onexport,
    onindex,
  }: {
    records: Draft[];
    storageError: string;
    conflict: boolean;
    disabled?: boolean;
    onrefresh: () => Promise<void>;
    onretry: () => Promise<void>;
    onrecover: (record: Draft) => Promise<void>;
    ondiscard: (record: Draft) => Promise<void>;
    oncopy: () => Promise<void>;
    onload: () => Promise<void>;
    onexport: () => Portable;
    onindex: () => Promise<void>;
  } = $props();
  let dialog = $state<HTMLDialogElement>();
  let working = $state(false);
  let error = $state('');
  let message = $state('');
  async function run(action: () => Promise<void>, success: string) {
    working = true;
    error = '';
    message = '';
    try {
      await action();
      message = success;
    } catch (reason) {
      error =
        reason instanceof Error ? reason.message : 'Recovery action failed';
    } finally {
      working = false;
    }
  }
  function download(record?: Draft) {
    try {
      downloadJson(
        record ? { schemaVersion: 1, lists: [record.document] } : onexport(),
        record?.document.title ?? 'local-version',
      );
    } catch (reason) {
      error =
        reason instanceof Error
          ? reason.message
          : 'Could not download local JSON';
    }
  }
  function discard(record: Draft) {
    if (
      confirm(
        `Discard the local draft “${record.document.title}”? This does not delete the server list.`,
      )
    )
      void run(() => ondiscard(record), 'Local draft discarded.');
  }
</script>

<div class="recovery-tools">
  <button
    class="quiet"
    disabled={disabled || working}
    onclick={() => {
      error = '';
      message = '';
      dialog?.showModal();
    }}>Recover drafts ({records.length})</button
  >
</div>
{#if storageError}<section
    class="error-message"
    aria-label="Local draft storage error"
  >
    <strong>Local draft storage needs attention.</strong>
    <p>
      {storageError} Server saving can still work. Download your local JSON before
      leaving if changes are not saved.
    </p>
    <button
      disabled={disabled || working}
      onclick={() => run(onretry, 'Local draft storage retried.')}
      >Retry local storage</button
    ><button disabled={disabled || working} onclick={() => download()}
      >Download local JSON</button
    >
  </section>{/if}
{#if conflict}<section class="recovery-alert" aria-label="Conflict resolution">
    <strong>Keep both versions.</strong>
    <p>
      Your local edits have not replaced the server version. Save them as a
      separate list, or load the server version after preserving a local draft.
    </p>
    <div class="transfer-actions">
      <button
        disabled={disabled || working}
        onclick={() => run(oncopy, 'Local version saved as a new list.')}
        >Save local as new list</button
      ><button
        disabled={disabled || working}
        onclick={() =>
          run(
            onload,
            'Server version loaded; local edits were kept as a draft.',
          )}>Load server version</button
      ><button disabled={disabled || working} onclick={() => download()}
        >Download local JSON</button
      ><button
        disabled={disabled || working}
        onclick={() =>
          run(onindex, 'List index refreshed. No local edits were replaced.')}
        >Refresh list index</button
      >
    </div>
  </section>{/if}
{#if error}<p class="error-message" role="alert">
    {error} If a copy response was lost, check the list index before trying to copy
    again.
  </p>{/if}
{#if message}<p
    class="transfer-success"
    role="status"
    aria-label="Recovery result"
  >
    {message}
  </p>{/if}
<dialog
  class="guide recovery-dialog"
  bind:this={dialog}
  aria-labelledby="recovery-title"
  oncancel={(event) => {
    if (working) event.preventDefault();
  }}
>
  <div class="guide-header">
    <h2 id="recovery-title">Recover local drafts</h2>
    <button
      class="quiet"
      disabled={working}
      onclick={() => dialog?.close()}
      aria-label="Close draft recovery">✕</button
    >
  </div>
  <p class="guide-intro">
    Retained versions from previous sessions or other tabs on this browser.
    Recovering creates a new list; the original is never overwritten.
  </p>
  <button
    class="quiet"
    disabled={working}
    onclick={() => run(onrefresh, 'Local drafts refreshed.')}
    >Refresh drafts</button
  >
  {#if !records.length}<p>
      No recoverable drafts for this server and user.
    </p>{/if}
  {#each records as record (`${record.scope}:${record.id}:${record.token}`)}
    <article class="draft-card" aria-label={`Draft ${record.document.title}`}>
      <h3>{record.document.title}</h3>
      <p>Local copy from {new Date(record.updatedAt).toLocaleString()}</p>
      <details>
        <summary>Preview local content</summary>
        <ul class="draft-preview">
          {#each visibleItems(record.document.nodes, new Set()).slice(0, 8) as { item, depth } (item.id)}<li
              style:margin-left={`${depth * 14}px`}
            >
              {item.kind === 'task'
                ? item.completed
                  ? '☑ '
                  : '☐ '
                : '• '}{item.text.slice(0, 240) || 'Empty item'}
            </li>{/each}
        </ul>
        <small>Preview shows up to 8 items; recovery keeps the full list.</small
        >
      </details>
      <div class="transfer-actions">
        <button
          disabled={working}
          onclick={() =>
            run(() => onrecover(record), 'Draft recovered as a new list.')}
          >Recover as new list</button
        ><button disabled={working} onclick={() => download(record)}
          >Download draft JSON</button
        ><button
          class="danger"
          disabled={working}
          onclick={() => discard(record)}>Discard draft</button
        >
      </div>
    </article>
  {/each}
  {#if error}<p class="error-message" role="alert">
      {error} If a copy response was lost, check the list index before retrying.
    </p>{/if}
  {#if message}<p class="transfer-success" role="status">{message}</p>{/if}
</dialog>
