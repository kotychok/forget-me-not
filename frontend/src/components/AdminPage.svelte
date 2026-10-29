<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { accountsApi } from '../lib/accounts';
  import type { ManagedAccount, IssuedLink } from '../lib/accounts';
  let { ownerId, onback }: { ownerId: string; onback: () => void } = $props();
  let accounts = $state<ManagedAccount[]>([]);
  let login = $state('');
  let name = $state('');
  let error = $state('');
  let notice = $state('');
  let busy = $state(false);
  let loading = $state(true);
  let issued = $state<IssuedLink | null>(null);
  let dialog = $state<HTMLDialogElement>();
  let linkInput = $state<HTMLInputElement>();
  let copied = $state(false);
  const link = $derived(
    issued
      ? `${location.origin}/activate#token=${encodeURIComponent(issued.token)}`
      : '',
  );
  async function load() {
    accounts = await accountsApi.list();
  }
  async function run(action: () => Promise<void>) {
    if (busy) return;
    busy = true;
    error = '';
    notice = '';
    try {
      await action();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Account operation failed';
    } finally {
      busy = false;
      loading = false;
    }
  }
  onMount(() => {
    void run(load);
  });
  async function showLink(value: IssuedLink) {
    issued = value;
    copied = false;
    await tick();
    dialog?.showModal();
    linkInput?.focus();
    linkInput?.select();
  }
  function closeLink() {
    dialog?.close();
    issued = null;
    copied = false;
  }
  function status(account: ManagedAccount) {
    return {
      active: 'Active',
      disabled: 'Disabled',
      pending: 'Awaiting activation',
      reset_pending: 'Awaiting password reset',
    }[account.status];
  }
</script>

<main class="admin-page">
  <header class="admin-header">
    <div>
      <div class="eyebrow">PRIVATE INSTALLATION</div>
      <h1>People</h1>
    </div>
    <button class="admin-secondary" onclick={onback}>Back to lists</button>
  </header>
  <p class="admin-intro">
    Create access for friends. Their lists stay private. There is no public
    registration.
  </p>
  {#if error}<p class="error-message" role="alert">{error}</p>{/if}
  {#if notice}<p class="transfer-success" role="status">{notice}</p>{/if}
  <section class="admin-create" aria-labelledby="create-friend-title">
    <h2 id="create-friend-title">Add a friend</h2>
    <form
      onsubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          const result = await accountsApi.create(login, name);
          login = '';
          name = '';
          await showLink(result);
          await load();
        });
      }}
    >
      <div>
        <label for="friend-name">Display name</label><input
          id="friend-name"
          bind:value={name}
          maxlength="100"
          required
          autocomplete="off"
        />
      </div>
      <div>
        <label for="friend-login">Login</label><input
          id="friend-login"
          bind:value={login}
          minlength="3"
          maxlength="64"
          pattern="[A-Za-z0-9._\-]+"
          required
          autocomplete="off"
        /><small>Letters, digits, dots, underscores or hyphens.</small>
      </div>
      <button class="admin-primary dialog-primary" disabled={busy}
        >Create activation link</button
      >
    </form>
  </section>
  <section class="admin-users" aria-labelledby="people-title">
    <div class="admin-section-heading">
      <h2 id="people-title">Accounts <span>({accounts.length})</span></h2>
      <button
        class="admin-secondary"
        disabled={busy}
        onclick={() => void run(load)}>Refresh accounts</button
      >
    </div>
    {#if loading}<p role="status">Loading accounts…</p>{/if}
    <div class="admin-account-list">
      {#each accounts as account}<article
          class="admin-account"
          aria-label={`Account ${account.login}`}
        >
          <div class="admin-account-heading">
            <div>
              <h3>{account.displayName}</h3>
              <span class="admin-login"
                >{account.login}{account.id === ownerId ? ' · you' : ''} · {account.role}</span
              >
            </div>
            <span
              class="account-state"
              class:account-disabled={account.status === 'disabled'}
              >{status(account)}</span
            >
          </div>
          <p class="admin-account-meta">
            {account.activeSessions} active {account.activeSessions === 1
              ? 'session'
              : 'sessions'}{account.linkExpiresAt
              ? ` · link expires ${new Date(account.linkExpiresAt * 1000).toLocaleString()}`
              : ''}
          </p>
          {#if account.id !== ownerId}<div class="admin-account-actions">
              {#if account.status === 'disabled'}<button
                  disabled={busy}
                  class="admin-secondary"
                  onclick={() =>
                    void run(async () => {
                      await accountsApi.enabled(account.id, true);
                      await load();
                      notice = `Enabled ${account.login}. Issue a new link if activation or reset is still pending.`;
                    })}>Enable account</button
                >
              {:else}<button
                  disabled={busy}
                  class="admin-secondary"
                  onclick={() =>
                    void run(async () => {
                      if (
                        !confirm(
                          `Disable ${account.login}? All sessions and unused access links will be revoked.`,
                        )
                      )
                        return;
                      await accountsApi.enabled(account.id, false);
                      await load();
                      notice = `Disabled ${account.login}.`;
                    })}>Disable account</button
                >
                <button
                  disabled={busy}
                  class="admin-secondary"
                  onclick={() =>
                    void run(async () => {
                      if (
                        account.status !== 'pending' &&
                        !confirm(
                          `Reset access for ${account.login}? Current password and sessions will stop working until the new link is used.`,
                        )
                      )
                        return;
                      await showLink(await accountsApi.link(account.id));
                      await load();
                    })}
                  >{account.status === 'pending'
                    ? 'New activation link'
                    : 'Reset password'}</button
                >
                <button
                  disabled={busy}
                  class="admin-secondary"
                  onclick={() =>
                    void run(async () => {
                      if (
                        !confirm(
                          `Revoke sessions and unused access links for ${account.login}?`,
                        )
                      )
                        return;
                      await accountsApi.revoke(account.id);
                      await load();
                      notice = `Revoked access sessions and links for ${account.login}.`;
                    })}>Revoke sessions</button
                >
              {/if}
            </div>{:else}<p class="admin-self-hint">
              Use Account to change your password or manage your sessions.
            </p>{/if}
        </article>{/each}
    </div>
  </section>
</main>
<dialog
  class="guide invite-dialog"
  bind:this={dialog}
  aria-labelledby="invite-title"
  oncancel={(event) => {
    event.preventDefault();
    closeLink();
  }}
>
  <div class="guide-header">
    <h2 id="invite-title">
      {issued?.purpose === 'reset' ? 'Password reset link' : 'Activation link'}
    </h2>
    <button class="quiet" aria-label="Close access link" onclick={closeLink}
      >✕</button
    >
  </div>
  <p>
    Send this link privately to <strong>{issued?.login}</strong>. It can be used
    once and is shown only now.
  </p>
  <label for="issued-link">Access link</label><input
    id="issued-link"
    bind:this={linkInput}
    readonly
    value={link}
    onclick={() => linkInput?.select()}
  />
  <p class="admin-account-meta">
    Expires {issued ? new Date(issued.expiresAt * 1000).toLocaleString() : ''}.
    A new link cancels the previous one.
  </p>
  <div class="transfer-actions">
    <button
      class="admin-primary dialog-primary"
      onclick={async () => {
        try {
          await navigator.clipboard.writeText(link);
          copied = true;
        } catch {
          linkInput?.focus();
          linkInput?.select();
        }
      }}>{copied ? 'Copied' : 'Copy link'}</button
    ><button onclick={closeLink}>Done</button>
  </div>
</dialog>
