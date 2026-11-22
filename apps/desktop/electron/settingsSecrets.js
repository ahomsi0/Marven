// electron/settingsSecrets.js
//
// Pure decision logic for how a secret setting (API key) is written back to
// settings.json when the user saves settings. Kept free of Electron imports so
// it can be unit-tested.

// What the renderer sees (and sends back) in place of a configured secret.
const MASKED_SECRET = '••••••••';

/**
 * Decide what to keep in memory and what to write to disk for one secret on
 * save.
 *
 * The renderer never holds real secret values: every save sends back the
 * public settings, where a configured secret is MASKED_SECRET and anything
 * else is ''. When safeStorage is unavailable (or decryption fails), a stored
 * `enc:v1:` value decrypts to '' and looks unconfigured, so the renderer sends
 * '' back for it. Re-encrypting the decrypted value in that case would write
 * '' and permanently erase the key, so an untouched secret always keeps its
 * raw stored value byte-for-byte.
 *
 * @param {object} args
 * @param {unknown} args.incoming   Value the renderer sent for this key (undefined, the mask, '', or a new key).
 * @param {unknown} args.storedRaw  Raw value currently in settings.json (plaintext, 'enc:v1:...', or missing).
 * @param {string}  args.decrypted  What decrypting storedRaw produced ('' when absent or unreadable).
 * @param {(value: string) => string} args.encrypt  Encrypts a new plaintext secret for storage.
 * @returns {{ value: string, stored: string, changed: boolean }}
 *   value:   plaintext to use in memory (env vars) after this save
 *   stored:  what to write to settings.json for this key
 *   changed: whether the stored value was replaced
 */
function resolveSecretForSave({ incoming, storedRaw, decrypted, encrypt }) {
  const keepRaw = typeof storedRaw === 'string' ? storedRaw : '';
  const readable = typeof decrypted === 'string' ? decrypted : '';
  const keep = { value: readable, stored: keepRaw, changed: false };

  if (typeof incoming !== 'string') return keep;
  const next = incoming.trim();
  if (next === MASKED_SECRET) return keep;

  if (next === '') {
    // The user can only clear a key they could see (shown as the mask). If we
    // couldn't read the stored value it was shown as empty, so an empty value
    // coming back means "untouched", not "delete".
    if (!readable) return keep;
    return { value: '', stored: '', changed: true };
  }

  return { value: next, stored: encrypt(next), changed: true };
}

module.exports = { MASKED_SECRET, resolveSecretForSave };
