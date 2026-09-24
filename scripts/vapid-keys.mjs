/**
 * Prints a fresh pair of VAPID keys for push notifications, and the two commands that
 * put them where the Worker reads them. Run once; see docs/PUSH.md.
 */

import { webcrypto } from "node:crypto";

const b64 = (bytes) =>
  Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const pair = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
  "sign",
  "verify",
]);
const publicKey = b64(await webcrypto.subtle.exportKey("raw", pair.publicKey));
const { d } = await webcrypto.subtle.exportKey("jwk", pair.privateKey);

console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${d}`);
console.log("");
console.log("The public key goes in wrangler.toml under [vars]; the private key is a secret:");
console.log("");
console.log(`  npx wrangler pages secret put VAPID_PRIVATE_KEY --project-name kesmic-practice-manager`);
console.log("");
console.log("Locally, put both in .dev.vars.");
