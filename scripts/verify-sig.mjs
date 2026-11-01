import fs from 'node:fs';
import crypto from 'node:crypto';

/**
 * T12: verify a Tauri updater .sig (minisign) against its binary + .pub.
 * No new dependencies — Node ed25519. Usage:
 *   node scripts/verify-sig.mjs <file> <file.sig> <key.pub>
 */
const [file, sigFile, pubFile] = process.argv.slice(2);
if (!file || !sigFile || !pubFile) {
  console.error('usage: verify-sig.mjs <file> <file.sig> <key.pub>');
  process.exit(2);
}
const b64 = (s) => Buffer.from(s.trim(), 'base64');
// .pub is base64(text) where text ends with base64(sigalg+keynum+pubkey).
const pubText = b64(fs.readFileSync(pubFile, 'utf8').trim()).toString('utf8');
const pubInner = b64(pubText.trim().split('\n').pop());
if (pubInner.length !== 42) throw new Error(`bad pub inner len ${pubInner.length}`);
const pubKey = pubInner.subarray(10); // 32-byte ed25519 key
// .sig is base64(text); text line 2 = base64(sigalg(2) + keynum(8) + global_sig(64)).
const sigLines = b64(fs.readFileSync(sigFile, 'utf8')).toString('utf8').trim().split('\n');
const sigInner = b64(sigLines[1]);
if (sigInner.length !== 74) throw new Error(`bad sig inner len ${sigInner.length}`);
const sigAlg = sigInner.subarray(0, 2).toString('utf8');
const globalSig = sigInner.subarray(10);
const data = fs.readFileSync(file);
// Ground truth (minisign-verify 0.3.0, vendored in D:/cargo): "ED" = prehashed,
// message = BLAKE2b-512(file), then pure Ed25519. "Ed" legacy = raw bytes.
const msg = sigAlg === 'ED' ? crypto.createHash('blake2b512').update(data).digest() : data;
const ok = crypto.verify(null, msg, { key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), pubKey]), format: 'der', type: 'spki' }, globalSig);
console.log(ok ? `SIG-OK [${sigAlg}]: ${file} authentic (ed25519, keynum=${sigInner.subarray(2, 10).toString('hex')})` : 'SIG-FAIL');
process.exit(ok ? 0 : 1);
