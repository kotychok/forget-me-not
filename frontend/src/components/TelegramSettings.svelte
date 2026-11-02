<script lang="ts">
  import { onMount } from 'svelte';
  import { telegramApi } from '../lib/telegram';
  import type { TelegramStatus } from '../lib/telegram';
  import type { ListSummary } from '../lib/api';
  let status = $state<TelegramStatus>();
  let lists = $state<ListSummary[]>([]);
  let listId = $state('');
  let url = $state('');
  let error = $state('');
  let busy = $state(false);
  let notice = $state('');
  let disposed = false;
  async function load() {
    const next = await telegramApi.status();
    if (disposed) return;
    status = next;
    url = '';
    if (next.enabled) {
      const available = await telegramApi.lists();
      if (disposed) return;
      lists = available;
      listId = next.listId ?? lists[0]?.id ?? '';
    }
  }
  async function run(action: () => Promise<void>) {
    if (busy) return;
    busy = true;
    error = '';
    notice = '';
    try {
      await action();
    } catch (reason) {
      if (!disposed)
        error =
          reason instanceof Error
            ? reason.message
            : 'Telegram operation failed';
    } finally {
      if (!disposed) busy = false;
    }
  }
  onMount(() => {
    void run(load);
    return () => {
      disposed = true;
      url = '';
    };
  });
</script>

<section class="telegram-settings" aria-label="Telegram Inbox">
  <h3>Telegram Inbox</h3>
  {#if error}<p role="alert" class="error-message">{error}</p>{/if}
  {#if !status}<p>Loading Telegram settings…</p>
    <button disabled={busy} onclick={() => run(load)}
      >Retry Telegram settings</button
    >
  {:else if !status.enabled}<p>Telegram is not enabled on this installation.</p>
  {:else}
    <p>
      @{status.botUsername} · {status.telegramId
        ? 'Connected'
        : 'Not connected'}
    </p>
    <p>
      Private text messages and URLs become one item each. Line breaks are kept.
      Connect again after changing your password.
    </p>
    <label for="telegram-inbox">Inbox list</label>
    <select
      id="telegram-inbox"
      bind:value={listId}
      disabled={busy}
      onchange={() => (url = '')}
    >
      <option value="" disabled>Choose a list</option>
      {#each lists as list (list.id)}<option value={list.id}
          >{list.title}</option
        >{/each}
    </select>
    {#if !lists.length}<p>
        Create a list first, then refresh Telegram settings.
      </p>{/if}
    <div class="transfer-actions">
      <button
        disabled={busy || !listId}
        onclick={() =>
          run(async () => {
            url = '';
            const issued = await telegramApi.link(listId);
            if (!disposed) url = issued.url;
          })}>Generate connection link</button
      >
      {#if status.telegramId}
        <button
          disabled={busy || !listId}
          onclick={() =>
            run(async () => {
              await telegramApi.inbox(listId);
              await load();
              notice = 'Inbox updated.';
            })}>Apply Inbox</button
        >
        <button
          disabled={busy}
          onclick={() =>
            run(async () => {
              await telegramApi.disconnect();
              url = '';
              await load();
              notice = 'Telegram disconnected.';
            })}>Disconnect Telegram</button
        >
      {/if}
      <button disabled={busy} onclick={() => run(load)}
        >Refresh Telegram settings</button
      >
    </div>
    {#if url}<p class="telegram-link">
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          referrerpolicy="no-referrer">Open Telegram to connect</a
        >
      </p>
      <p>
        This private link expires in 10 minutes and works once. Open it in your
        own Telegram account and press Start. Refresh settings after connecting;
        generating another link invalidates this one.
      </p>
    {/if}
    {#if notice}<p role="status">{notice}</p>{/if}
  {/if}
</section>
