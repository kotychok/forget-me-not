<script lang="ts">
  import { authApi } from '../lib/auth';
  import type { AuthUser, BrowserSession } from '../lib/auth';
  let {
    user,
    onended,
    onprepare,
    onresume,
  }: {
    user: AuthUser;
    onended: () => void;
    onprepare: () => Promise<void>;
    onresume: () => Promise<void>;
  } = $props();
  let dialog = $state<HTMLDialogElement>();
  let sessions = $state<BrowserSession[]>([]);
  let error = $state('');
  let busy = $state(false);
  let currentPassword = $state('');
  let newPassword = $state('');
  let confirmation = $state('');
  async function load() {
    sessions = await authApi.sessions();
  }
  async function run(action: () => Promise<void>) {
    if (busy) return;
    busy = true;
    error = '';
    try {
      await action();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Account operation failed';
      await onresume();
    } finally {
      busy = false;
    }
  }
  function close() {
    currentPassword = '';
    newPassword = '';
    confirmation = '';
    dialog?.close();
  }
</script>

<button
  class="quiet"
  onclick={() => {
    dialog?.showModal();
    void run(load);
  }}>Account</button
>
<dialog
  class="guide account-dialog"
  bind:this={dialog}
  aria-labelledby="account-title"
  oncancel={(event) => {
    event.preventDefault();
    if (!busy) close();
  }}
>
  <div class="guide-header">
    <h2 id="account-title">Account: {user.login}</h2>
    <button
      class="quiet"
      aria-label="Close account"
      disabled={busy}
      onclick={close}>✕</button
    >
  </div>
  {#if error}<p class="error-message" role="alert">{error}</p>{/if}
  <h3>Browser sessions</h3>
  <button disabled={busy} onclick={() => void run(load)}
    >Refresh sessions</button
  >
  <p>
    Expires after 7 idle days or 30 days from sign-in. Times use this browser's
    timezone.
  </p>
  <ul class="account-sessions">
    {#each sessions as session}<li>
        <span
          >{session.id === user.sessionId ? 'This browser' : 'Another session'} ·
          last used {new Date(session.lastSeenAt * 1000).toLocaleString()} · expires
          {new Date(session.expiresAt * 1000).toLocaleString()}</span
        >
        <button
          disabled={busy}
          onclick={() =>
            void run(async () => {
              if (session.id === user.sessionId) await onprepare();
              await authApi.revoke(session.id);
              if (session.id === user.sessionId) {
                close();
                onended();
              } else await load();
            })}
          >Revoke {session.id === user.sessionId
            ? 'this session'
            : 'session'}</button
        >
      </li>{/each}
  </ul>
  <button
    disabled={busy}
    onclick={() =>
      void run(async () => {
        await onprepare();
        await authApi.logoutAll();
        close();
        onended();
      })}>Sign out all sessions</button
  >
  <h3>Change password</h3>
  <p>
    At least 12 characters. All sessions, including this one, will be signed
    out.
  </p>
  <form
    onsubmit={(event) => {
      event.preventDefault();
      void run(async () => {
        if (newPassword !== confirmation)
          throw new Error('Passwords do not match');
        await onprepare();
        await authApi.password(currentPassword, newPassword);
        close();
        onended();
      });
    }}
  >
    <label for="current-password">Current password</label><input
      id="current-password"
      type="password"
      autocomplete="current-password"
      bind:value={currentPassword}
      required
    />
    <label for="new-password">New password</label><input
      id="new-password"
      type="password"
      autocomplete="new-password"
      minlength="12"
      bind:value={newPassword}
      required
    />
    <label for="confirm-password">Repeat new password</label><input
      id="confirm-password"
      type="password"
      autocomplete="new-password"
      bind:value={confirmation}
      required
    />
    <button disabled={busy}>Change password and sign out</button>
  </form>
</dialog>
