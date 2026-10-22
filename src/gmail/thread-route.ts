const GMAIL_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZbcdfghjklmnpqrstvwxz';
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function convertBase(value: string, source: string, target: string): string {
  let number = 0n;
  for (const character of value) {
    const digit = source.indexOf(character);
    if (digit < 0) throw new Error('Invalid digit');
    number = number * BigInt(source.length) + BigInt(digit);
  }
  let result = '';
  do {
    result = target[Number(number % BigInt(target.length))] + result;
    number /= BigInt(target.length);
  } while (number > 0n);
  return result;
}

/**
 * Restricted inverse of InboxSDK's documented URL alphabet conversion.
 * This is an unsupported Gmail format, not a public API. The caller MUST also
 * corroborate both returned IDs against the one visible conversation heading.
 * Draft IDs, thread-a IDs, noncanonical encodings and unknown forms fail closed.
 */
export function decodeThreadRoute(token: string): { permanentId: string; legacyId: string } | null {
  if (token.length < 20 || token.length > 64 || token.startsWith('B')) return null;
  try {
    const base64 = convertBase(token, GMAIL_ALPHABET, BASE64_ALPHABET);
    const decoded = atob(base64);
    if (!/^f:[1-9]\d{0,19}$/.test(decoded)) return null;
    // Re-encode to reject trailing padding bits and alternative representations.
    if (convertBase(btoa(decoded).replace(/=+$/, ''), BASE64_ALPHABET, GMAIL_ALPHABET) !== token)
      return null;
    const legacyId = BigInt(decoded.slice(2)).toString(16);
    if (!/^[0-9a-f]{16}$/.test(legacyId)) return null;
    return { permanentId: `thread-${decoded}`, legacyId };
  } catch {
    return null;
  }
}
