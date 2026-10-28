<script lang="ts">
  let guide = $state<HTMLDialogElement>();
</script>

<button
  class="quiet"
  onclick={() => guide?.showModal()}
  aria-haspopup="dialog"
  aria-controls="keyboard-guide">Keyboard guide <kbd>?</kbd></button
>
<dialog
  class="guide"
  id="keyboard-guide"
  bind:this={guide}
  aria-labelledby="guide-title"
>
  <div class="guide-header">
    <h2 id="guide-title">Keyboard guide</h2>
    <button
      class="quiet"
      onclick={() => guide?.close()}
      aria-label="Close keyboard guide">✕</button
    >
  </div>
  <p class="guide-intro">Keep your hands on the keyboard.</p>
  <dl>
    <dt>Enter</dt>
    <dd>New item after this branch</dd>
    <dt>Shift + Enter</dt>
    <dd>Line break while editing</dd>
    <dt>Tab / Shift + Tab</dt>
    <dd>Indent / outdent in navigation or editing</dd>
    <dt>Alt + ↑ / ↓</dt>
    <dd>Move a branch</dd>
    <dt>Esc / F2</dt>
    <dd>
      Navigate / edit; Esc cancels an untouched new item. In navigation, Esc
      focuses the toolbar for normal Tab navigation.
    </dd>
    <dt>↑ ↓ ← →</dt>
    <dd>Navigate and collapse in navigation mode</dd>
    <dt>Space</dt>
    <dd>Complete task in navigation mode</dd>
    <dt>T</dt>
    <dd>
      Edit active item tags in navigation. A tag filter locks structural
      commands; Escape clears it.
    </dd>
    <dt>D</dt>
    <dd>Edit the active item due date in navigation mode</dd>
    <dt>N</dt>
    <dd>Open the active item note in navigation mode</dd>
    <dt>L</dt>
    <dd>
      Focus item links; Enter opens, Tab switches links, Esc returns to item
    </dd>
    <dt>Del</dt>
    <dd>Delete branch in navigation mode</dd>
    <dt>Cmd/Ctrl + Z</dt>
    <dd>Undo; add Shift to redo</dd>
  </dl>
</dialog>
