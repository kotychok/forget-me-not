import { serializePortable } from './portable.ts';
import type { Portable } from './portable.ts';
/** Browser download adapter; no workspace or persistence decisions. */
export function downloadJson(document: Portable, name: string) {
  downloadText(serializePortable(document), name, 'json', 'application/json');
}
export function downloadText(
  text: string,
  name: string,
  extension: string,
  mediaType: string,
) {
  const blob = new Blob([text], { type: mediaType });
  const url = URL.createObjectURL(blob);
  const link = window.document.createElement('a');
  link.href = url;
  link.download = `${
    name
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'list'
  }.${extension}`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
