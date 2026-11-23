import { createHash, timingSafeEqual } from 'node:crypto';

// Compare hashed fingerprints to check the secret without ordinary string equality.
export function matchesAccessCode(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string' || !expected) return false;
  const fingerprint = (text) => createHash('sha256').update(text).digest();
  return timingSafeEqual(fingerprint(provided), fingerprint(expected));
}
