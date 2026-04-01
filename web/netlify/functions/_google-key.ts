/**
 * _google-key.ts — Clé Google Service Account chiffrée en AES-256-GCM.
 * Déchiffrée au runtime avec la variable d'env GOOGLE_KEY_PASSPHRASE.
 * Préfixe _ = pas déployé comme function Netlify.
 */

import crypto from "crypto";

const ENCRYPTED = {
  salt: "uTAYFs9UwYqQ1GA/D6WaOQ==",
  iv: "lAsEj2ZWp4Pj6yit",
  tag: "A0gWEIGPI5JcPwWMuyCekA==",
  data: "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",
};

let cachedKey: string | null = null;

export function decryptGoogleKey(): string {
  if (cachedKey) return cachedKey;

  const passphrase = process.env.GOOGLE_KEY_PASSPHRASE;
  if (!passphrase) {
    throw new Error("GOOGLE_KEY_PASSPHRASE non définie — ajoute-la dans les variables d'environnement Netlify");
  }

  const salt = Buffer.from(ENCRYPTED.salt, "base64");
  const iv = Buffer.from(ENCRYPTED.iv, "base64");
  const tag = Buffer.from(ENCRYPTED.tag, "base64");
  const encrypted = Buffer.from(ENCRYPTED.data, "base64");

  const derivedKey = crypto.pbkdf2Sync(passphrase, salt, 100000, 32, "sha256");
  const decipher = crypto.createDecipheriv("aes-256-gcm", derivedKey, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(encrypted, undefined, "utf8");
  decrypted += decipher.final("utf8");

  cachedKey = decrypted;
  return decrypted;
}
