<script lang="ts">
  import { onMount, tick } from 'svelte';
  import AdminPage from './components/AdminPage.svelte';
  import ActivationPage from './components/ActivationPage.svelte';
  const activationRoute = location.pathname === '/activate';
  let adminOpen = $state(location.pathname === '/admin');
  import WorkspaceApp from './WorkspaceApp.svelte';
  import AccountDialog from './components/AccountDialog.svelte';
  import { authApi } from './lib/auth';
  import type { AuthUser } from './lib/auth';
  import { ApiError, setApiOwner, suspendApi } from './lib/api';
  let app = $state<WorkspaceApp>();
  let mode = $state<'local' | 'password'>('password');
  let configured = $state(true);
  let ready = $state(false);
  let checking = $state(true);
  let locked = $state(false);
  let busy = $state(false);
  let error = $state('');
  let user = $state<AuthUser | null>(null);
  let login = $state('');
  let password = $state('');
  let generation = $state(0);
  let suspendedDialogs: HTMLDialogElement[] = [];
  let loginInput = $state<HTMLInputElement>();
  async function lock() {
    if (!ready || mode === 'local') return;
    if (!locked) {
      suspendedDialogs = [
        ...document.querySelectorAll<HTMLDialogElement>('dialog[open]'),
      ];
      for (const dialog of suspendedDialogs) dialog.close();
    }
    locked = true;
    suspendApi(true);
    login = user?.login ?? '';
    await app?.pauseForAuthentication();
    await tick();
    loginInput?.focus();
  }
  function ended() {
    adminOpen = false;
    ready = false;
    locked = false;
    user = null;
    login = '';
    password = '';
    generation++;
    suspendedDialogs = [];
    setApiOwner(null);
    suspendApi(false);
    const url = new URL(location.href);
    url.pathname = '/';
    url.searchParams.delete('list');
    history.replaceState(null, '', url);
  }
  async function run(action: () => Promise<void>) {
    if (busy) return;
    busy = true;
    error = '';
    try {
      await action();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Access operation failed';
      if (ready && locked) suspendApi(true);
      else if (ready) {
        try {
          await app?.resumeAfterAuthentication();
        } catch (resumeError) {
          await lock();
          error =
            resumeError instanceof Error
              ? resumeError.message
              : 'Could not resume workspace';
        }
      }
    } finally {
      busy = false;
    }
  }
  async function initialize() {
    checking = true;
    error = '';
    try {
      const status = await authApi.status();
      mode = status.mode;
      configured = status.configured;
      if (mode === 'local') {
        setApiOwner(null);
        ready = true;
        return;
      }
      try {
        user = await authApi.me();
        setApiOwner(user.ownerId);
        ready = true;
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 401)) throw e;
      }
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not check access';
    } finally {
      checking = false;
    }
  }
  async function signIn() {
    const previous = user;
    const result = await authApi.login(login, password);
    password = '';
    if (previous && previous.ownerId !== result.ownerId)
      throw new Error('Sign in as the same account to restore this workspace.');
    setApiOwner(result.ownerId);
    suspendApi(false);
    user = await authApi.me();
    if (locked) {
      await app?.resumeAfterAuthentication();
      locked = false;
      await tick();
      for (const dialog of suspendedDialogs)
        if (dialog.isConnected && !dialog.open) dialog.showModal();
      suspendedDialogs = [];
    }
    ready = true;
  }
  async function signOut(keepDrafts = false) {
    if (document.querySelector('dialog[data-draft-dirty="true"]'))
      throw new Error(
        'An unapplied dialog draft is kept in memory. Sign in again to apply or cancel it before signing out.',
      );
    await app?.prepareLogout(keepDrafts);
    try {
      await authApi.logout();
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401)) throw e;
    }
    ended();
  }
  async function navigateAdmin(open: boolean, historyChange = true) {
    if (open) {
      if (user?.role !== 'admin')
        throw new Error('Administrator access required');
      if (document.querySelector('dialog[data-draft-dirty="true"]'))
        throw new Error('Apply or cancel your dialog draft first.');
      await app?.prepareLogout();
    } else await app?.resumeAfterAuthentication();
    adminOpen = open;
    if (historyChange) {
      const url = new URL(location.href);
      url.pathname = open ? '/admin' : '/';
      history.pushState(null, '', url);
    }
  }
  onMount(() => {
    if (activationRoute) return;
    const pop = () => {
      void run(() => navigateAdmin(location.pathname === '/admin', false));
    };
    window.addEventListener('popstate', pop);
    void initialize();
    const expired = () => {
      void lock();
    };
    const focus = () => {
      if (!ready || locked || mode === 'local') return;
      void authApi
        .me()
        .then((current) => {
          if (current.ownerId !== user?.ownerId) void lock();
          else user = current;
        })
        .catch((e) => {
          if (e instanceof ApiError && e.status === 401) void lock();
        });
    };
    window.addEventListener('fmn:unauthorized', expired);
    window.addEventListener('focus', focus);
    return () => {
      window.removeEventListener('popstate', pop);
      window.removeEventListener('fmn:unauthorized', expired);
      window.removeEventListener('focus', focus);
      setApiOwner(null);
      suspendApi(false);
    };
  });
</script>

{#if activationRoute}<ActivationPage />{:else}
  {#if ready}
    <div hidden={locked} inert={locked || busy}>
      <div hidden={adminOpen}>
        {#key generation}<WorkspaceApp
            bind:this={app}
            authenticated={mode === 'password'}
          >
            {#snippet account()}
              {#if mode === 'password' && user}<div class="account-bar">
                  <span class="account-identity" title={user.login}
                    >Signed in as {user.login}</span
                  >
                  <div class="account-actions">
                    <AccountDialog
                      {user}
                      onprepare={() =>
                        app?.prepareLogout() ?? Promise.resolve()}
                      onresume={() =>
                        app?.resumeAfterAuthentication() ?? Promise.resolve()}
                      onended={ended}
                    />
                    <button
                      class="quiet"
                      onclick={() => void run(() => signOut())}>Sign out</button
                    >
                  </div>
                  {#if user.role === 'admin'}<button
                      class="quiet admin-open"
                      onclick={() => void run(() => navigateAdmin(true))}
                      >Manage people</button
                    >{/if}
                  <button
                    class="quiet account-draft-exit"
                    onclick={() => void run(() => signOut(true))}
                    >Keep drafts and sign out</button
                  >
                </div>{/if}
            {/snippet}
          </WorkspaceApp>{/key}
      </div>
      {#if adminOpen}
        {#if user && user.role === 'admin'}<AdminPage
            ownerId={user.ownerId}
            onback={() => void run(() => navigateAdmin(false))}
          />
        {:else}<main class="access-page">
            <h1>Administrator access required</h1>
            <button onclick={() => void run(() => navigateAdmin(false))}
              >Back to lists</button
            >
          </main>{/if}
      {/if}
    </div>
  {/if}
  {#if checking}<p class="access-message" role="status">Checking access…</p>
  {:else if !ready || locked}
    <main class="access-page">
      <h1>forget me not.</h1>
      {#if !configured}<p>
          No account is configured. Create the first administrator locally with <code
            >make auth-bootstrap LOGIN=your-login</code
          >, then reload.
        </p>
        <button onclick={() => void initialize()}>Check again</button>
      {:else}
        <h2>{locked ? 'Sign in again' : 'Sign in'}</h2>
        {#if locked}<p>
            Your workspace is paused. Sign in as {user?.login} to continue with local
            changes.
          </p>{/if}
        <form
          onsubmit={(event) => {
            event.preventDefault();
            void run(signIn);
          }}
        >
          <label for="login">Login</label><input
            bind:this={loginInput}
            id="login"
            autocomplete="username"
            bind:value={login}
            readonly={locked}
            required
          />
          <label for="password">Password</label><input
            id="password"
            type="password"
            autocomplete="current-password"
            bind:value={password}
            required
          />
          <button disabled={busy}>Sign in</button>
        </form>
        {#if locked}<button
            disabled={busy}
            onclick={() =>
              void run(async () => {
                app?.downloadLocalEdits();
              })}>Download local edits</button
          >
          <button disabled={busy} onclick={() => void run(() => signOut(true))}
            >Keep drafts and sign out</button
          >{/if}
      {/if}
      {#if error}<p class="error-message" role="alert">{error}</p>
        <button disabled={busy} onclick={() => void initialize()}
          >Retry access check</button
        >{/if}
    </main>
  {:else if error}<div class="access-error" role="alert">
      {error}<button onclick={() => (error = '')}>Dismiss</button>
    </div>{/if}
{/if}
