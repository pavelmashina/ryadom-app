/** Decode a URL-safe, uncompressed P-256 VAPID public key.
 * Reject malformed keys before passing them to PushManager.subscribe().
 */
export function parseVapidPublicKey(value: string): Uint8Array {
  if (typeof value !== "string" || value !== value.trim() ||
      !/^[A-Za-z0-9_-]{87}=?$/.test(value)) {
    throw new Error("Некорректный публичный ключ уведомлений");
  }
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
  } catch {
    throw new Error("Некорректный публичный ключ уведомлений");
  }
  if (bytes.length !== 65 || bytes[0] !== 0x04)
    throw new Error("Некорректный публичный ключ уведомлений");
  return bytes;
}
export async function validateVapidKey(raw: string): Promise<Uint8Array> {
  const bytes = parseVapidPublicKey(raw);
  // The key must be a real point on P-256, not just 65 random bytes.
  try {
    await crypto.subtle.importKey(
      "raw", bytes, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"],
    );
  } catch {
    throw new Error("Некорректный публичный ключ уведомлений");
  }
  return bytes;
}
