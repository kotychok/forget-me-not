/** Encode before sending; a compression failure is safe to fall back from (no HTTP yet). */
export async function encodeSave(
  json: string,
): Promise<{ body: string | ArrayBuffer; encoding?: 'gzip' }> {
  if (typeof CompressionStream === 'undefined') return { body: json };
  const bytes = new TextEncoder().encode(json);
  if (bytes.byteLength < 8192) return { body: json };
  try {
    const body = await new Response(
      new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip')),
    ).arrayBuffer();
    return body.byteLength <= bytes.byteLength * 0.8
      ? { body, encoding: 'gzip' }
      : { body: json };
  } catch {
    return { body: json };
  }
}
