import { validateWorld } from './worldConfig.js';

const PREFIX = 'SS1.';
const MAX_PAYLOAD_LENGTH = 8 * 1024;
const MAX_INPUT_LENGTH = 16 * 1024;

function encodeBytes(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function encodeWorld(config) {
  const canonical = validateWorld(config);
  const payload = encodeBytes(new TextEncoder().encode(JSON.stringify(canonical)));
  if (payload.length > MAX_PAYLOAD_LENGTH)
    throw new Error('World code exceeds the 8 KiB limit.');
  return PREFIX + payload;
}

function extractCode(input) {
  if (typeof input !== 'string')
    throw new Error('Paste a world code or an HTTP(S) share link.');
  if (
    input.length > MAX_INPUT_LENGTH ||
    new TextEncoder().encode(input).length > MAX_INPUT_LENGTH
  )
    throw new Error('Share input exceeds the 16 KiB limit.');
  const text = input.trim();
  if (text.startsWith(PREFIX)) return text;
  if (!/^https?:\/\//i.test(text))
    throw new Error('Paste a supported SS1 world code or an HTTP(S) share link.');
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error('This share link is invalid.');
  }
  const fragment = new URLSearchParams(url.hash.slice(1));
  const codes = fragment.getAll('world');
  if (codes.length !== 1 || !codes[0])
    throw new Error('This share link must contain one world code in its fragment.');
  return codes[0];
}

export function decodeWorld(codeOrLink) {
  const code = extractCode(codeOrLink);
  if (!code.startsWith(PREFIX))
    throw new Error('Unsupported world-code version. Use an SS1 code.');
  const payload = code.slice(PREFIX.length);
  if (payload.length > MAX_PAYLOAD_LENGTH)
    throw new Error('World code exceeds the 8 KiB limit.');
  if (!/^[A-Za-z0-9_-]+$/.test(payload) || payload.length % 4 === 1) {
    throw new Error('World code has invalid base64url encoding.');
  }
  let bytes;
  try {
    const binary = atob(payload.replaceAll('-', '+').replaceAll('_', '/'));
    bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new Error('World code has invalid base64url encoding.');
  }
  if (encodeBytes(bytes) !== payload)
    throw new Error('World code must use canonical base64url encoding.');
  let candidate;
  try {
    const json = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    candidate = JSON.parse(json);
  } catch {
    throw new Error('World code must contain valid UTF-8 JSON. Paste the complete code.');
  }
  return validateWorld(candidate);
}

export function createWorldLink(config, origin) {
  let url;
  try {
    url = new URL(origin);
  } catch {
    throw new Error('A valid HTTP(S) origin is required for a share link.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('A valid HTTP(S) origin is required for a share link.');
  }
  return `${url.origin}/#world=${encodeWorld(config)}`;
}
