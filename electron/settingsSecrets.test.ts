import { describe, it, expect, vi } from "vitest";
import { createRequire } from "module";

// settingsSecrets.js is CommonJS (Electron main process), so load it with
// require rather than an ES import.
const require = createRequire(import.meta.url);
const { MASKED_SECRET, resolveSecretForSave } = require("./settingsSecrets") as {
  MASKED_SECRET: string;
  resolveSecretForSave: (args: {
    incoming: unknown;
    storedRaw: unknown;
    decrypted: string;
    encrypt: (value: string) => string;
  }) => { value: string; stored: string; changed: boolean };
};

const encrypt = vi.fn((value: string) => `enc:v1:${Buffer.from(value).toString("base64")}`);
const ENCRYPTED = "enc:v1:c29tZXRoaW5nLXNlY3JldA==";

describe("resolveSecretForSave", () => {
  it("keeps the raw stored value when the secret is not in the save at all", () => {
    const r = resolveSecretForSave({ incoming: undefined, storedRaw: ENCRYPTED, decrypted: "sk-live", encrypt });
    expect(r).toEqual({ value: "sk-live", stored: ENCRYPTED, changed: false });
  });

  it("keeps the raw stored value when the renderer sends back the mask", () => {
    const r = resolveSecretForSave({ incoming: MASKED_SECRET, storedRaw: ENCRYPTED, decrypted: "sk-live", encrypt });
    expect(r).toEqual({ value: "sk-live", stored: ENCRYPTED, changed: false });
  });

  it("treats a padded mask as the mask", () => {
    const r = resolveSecretForSave({ incoming: ` ${MASKED_SECRET} `, storedRaw: ENCRYPTED, decrypted: "sk-live", encrypt });
    expect(r.stored).toBe(ENCRYPTED);
    expect(r.changed).toBe(false);
  });

  it("does not erase an encrypted key it could not decrypt (safeStorage unavailable)", () => {
    // Decryption failed, so the renderer saw the key as unconfigured and sends
    // '' back on an unrelated save. The stored ciphertext must survive.
    const r = resolveSecretForSave({ incoming: "", storedRaw: ENCRYPTED, decrypted: "", encrypt });
    expect(r).toEqual({ value: "", stored: ENCRYPTED, changed: false });
  });

  it("does not erase an undecryptable key when it is absent from the save", () => {
    const r = resolveSecretForSave({ incoming: undefined, storedRaw: ENCRYPTED, decrypted: "", encrypt });
    expect(r.stored).toBe(ENCRYPTED);
  });

  it("does not erase an undecryptable key when the mask comes back", () => {
    const r = resolveSecretForSave({ incoming: MASKED_SECRET, storedRaw: ENCRYPTED, decrypted: "", encrypt });
    expect(r.stored).toBe(ENCRYPTED);
  });

  it("clears a readable key when the user empties the field", () => {
    const r = resolveSecretForSave({ incoming: "  ", storedRaw: ENCRYPTED, decrypted: "sk-live", encrypt });
    expect(r).toEqual({ value: "", stored: "", changed: true });
  });

  it("encrypts and stores a new key", () => {
    encrypt.mockClear();
    const r = resolveSecretForSave({ incoming: "  sk-new  ", storedRaw: ENCRYPTED, decrypted: "", encrypt });
    expect(encrypt).toHaveBeenCalledWith("sk-new");
    expect(r).toEqual({ value: "sk-new", stored: encrypt("sk-new"), changed: true });
  });

  it("stores a new key when nothing was stored before", () => {
    const r = resolveSecretForSave({ incoming: "sk-first", storedRaw: undefined, decrypted: "", encrypt });
    expect(r.value).toBe("sk-first");
    expect(r.stored).toBe(encrypt("sk-first"));
  });

  it("keeps a legacy plaintext value untouched", () => {
    const r = resolveSecretForSave({ incoming: MASKED_SECRET, storedRaw: "sk-plain", decrypted: "sk-plain", encrypt });
    expect(r).toEqual({ value: "sk-plain", stored: "sk-plain", changed: false });
  });

  it("ignores non-string incoming values", () => {
    const r = resolveSecretForSave({ incoming: 123, storedRaw: ENCRYPTED, decrypted: "", encrypt });
    expect(r.stored).toBe(ENCRYPTED);
  });

  it("writes '' when nothing is stored and nothing is sent", () => {
    const r = resolveSecretForSave({ incoming: "", storedRaw: undefined, decrypted: "", encrypt });
    expect(r).toEqual({ value: "", stored: "", changed: false });
  });
});
