import { serializePortable } from './portable.ts';
import type { Portable } from './portable.ts';
/** Browser download adapter; no workspace or persistence decisions. */
export function downloadJson(document: Portable, name: string) {
  const blob = new Blob([serializePortable(document)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const link = window.document.createElement('a');
  link.href = url;
  link.download = `${
    name
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'list'
  }.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
