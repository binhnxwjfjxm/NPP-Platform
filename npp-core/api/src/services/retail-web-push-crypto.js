import {
  createCipheriv,
  createECDH,
  createHmac,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  randomBytes,
  sign,
} from 'node:crypto';

const PUBLIC_KEY_BYTES = 65;
const PRIVATE_KEY_BYTES = 32;
const AUTH_SECRET_MIN_BYTES = 16;
const RECORD_SIZE = 4096;
const MAX_PAYLOAD_BYTES = 3900;

function b64u(value) {
  return Buffer.from(value).toString('base64url');
}

function decodeB64u(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error('WEB_PUSH_BASE64URL_INVALID');
  }
  return Buffer.from(value, 'base64url');
}

function publicJwkFromRaw(raw) {
  const bytes = Buffer.from(raw);
  if (bytes.length !== PUBLIC_KEY_BYTES || bytes[0] !== 0x04) {
    throw new Error('WEB_PUSH_PUBLIC_KEY_INVALID');
  }
  return {
    kty: 'EC',
    crv: 'P-256',
    x: b64u(bytes.subarray(1, 33)),
    y: b64u(bytes.subarray(33, 65)),
  };
}

function rawFromPublicJwk(jwk) {
  const x = decodeB64u(jwk.x);
  const y = decodeB64u(jwk.y);
  if (x.length !== 32 || y.length !== 32) throw new Error('WEB_PUSH_PUBLIC_KEY_INVALID');
  return Buffer.concat([Buffer.from([0x04]), x, y]);
}

function hkdfExtract(salt, inputKeyMaterial) {
  return createHmac('sha256', salt).update(inputKeyMaterial).digest();
}

function hkdfExpand(prk, info, length) {
  if (!Number.isInteger(length) || length < 1 || length > 32) throw new Error('WEB_PUSH_HKDF_LENGTH_INVALID');
  return createHmac('sha256', prk)
    .update(Buffer.concat([Buffer.from(info), Buffer.from([0x01])]))
    .digest()
    .subarray(0, length);
}

function encodeJwtPart(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function vapidPrivateKey(runtime) {
  const publicRaw = decodeB64u(runtime.publicKey);
  const d = decodeB64u(runtime.privateKey);
  if (d.length !== PRIVATE_KEY_BYTES) throw new Error('WEB_PUSH_VAPID_PRIVATE_KEY_INVALID');
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(d);
  const derivedPublic = ecdh.getPublicKey();
  if (!derivedPublic.equals(publicRaw)) throw new Error('WEB_PUSH_VAPID_KEYPAIR_MISMATCH');
  const publicJwk = publicJwkFromRaw(derivedPublic);
  return createPrivateKey({
    key: {
      ...publicJwk,
      d: runtime.privateKey,
    },
    format: 'jwk',
  });
}

function vapidAuthorization(endpoint, runtime, nowMs = Date.now()) {
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('WEB_PUSH_ENDPOINT_INVALID');
  }
  const header = encodeJwtPart({ typ: 'JWT', alg: 'ES256' });
  const payload = encodeJwtPart({
    aud: url.origin,
    exp: Math.floor(nowMs / 1000) + (12 * 60 * 60),
    sub: runtime.subject,
  });
  const signingInput = `${header}.${payload}`;
  const signature = sign('sha256', Buffer.from(signingInput), {
    key: vapidPrivateKey(runtime),
    dsaEncoding: 'ieee-p1363',
  });
  if (signature.length !== 64) throw new Error('WEB_PUSH_VAPID_SIGNATURE_INVALID');
  return `vapid t=${signingInput}.${b64u(signature)}, k=${runtime.publicKey}`;
}

function encryptedBody(subscription, payloadBuffer) {
  const clientPublic = decodeB64u(subscription.keys.p256dh);
  const authSecret = decodeB64u(subscription.keys.auth);
  if (clientPublic.length !== PUBLIC_KEY_BYTES || clientPublic[0] !== 0x04) {
    throw new Error('WEB_PUSH_SUBSCRIPTION_P256DH_INVALID');
  }
  if (authSecret.length < AUTH_SECRET_MIN_BYTES) {
    throw new Error('WEB_PUSH_SUBSCRIPTION_AUTH_INVALID');
  }
  if (payloadBuffer.length > MAX_PAYLOAD_BYTES) throw new Error('WEB_PUSH_PAYLOAD_TOO_LARGE');

  const ephemeral = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const serverPublicJwk = ephemeral.publicKey.export({ format: 'jwk' });
  const serverPublic = rawFromPublicJwk(serverPublicJwk);
  const clientPublicKey = createPublicKey({
    key: publicJwkFromRaw(clientPublic),
    format: 'jwk',
  });
  const sharedSecret = diffieHellman({
    privateKey: ephemeral.privateKey,
    publicKey: clientPublicKey,
  });

  const prkKey = hkdfExtract(authSecret, sharedSecret);
  const keyInfo = Buffer.concat([
    Buffer.from('WebPush: info\0', 'utf8'),
    clientPublic,
    serverPublic,
  ]);
  const ikm = hkdfExpand(prkKey, keyInfo, 32);
  const salt = randomBytes(16);
  const prk = hkdfExtract(salt, ikm);
  const cek = hkdfExpand(prk, Buffer.from('Content-Encoding: aes128gcm\0', 'utf8'), 16);
  const nonce = hkdfExpand(prk, Buffer.from('Content-Encoding: nonce\0', 'utf8'), 12);

  const plaintext = Buffer.concat([payloadBuffer, Buffer.from([0x02])]);
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);

  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(RECORD_SIZE, 0);
  return Buffer.concat([
    salt,
    rs,
    Buffer.from([serverPublic.length]),
    serverPublic,
    ciphertext,
  ]);
}

export function validateVapidRuntime(runtime) {
  if (!runtime || typeof runtime !== 'object') return false;
  try {
    const publicKey = decodeB64u(runtime.publicKey);
    const privateKey = decodeB64u(runtime.privateKey);
    if (publicKey.length !== PUBLIC_KEY_BYTES || publicKey[0] !== 0x04) return false;
    if (privateKey.length !== PRIVATE_KEY_BYTES) return false;
    const subject = new URL(runtime.subject);
    if (!['https:', 'mailto:'].includes(subject.protocol)) return false;
    vapidPrivateKey(runtime);
    return true;
  } catch {
    return false;
  }
}

export function buildWebPushRequest(subscription, payload, runtime, { nowMs = Date.now() } = {}) {
  const endpoint = String(subscription?.endpoint ?? '').trim();
  const payloadBuffer = Buffer.from(JSON.stringify(payload), 'utf8');
  const body = encryptedBody(subscription, payloadBuffer);
  return Object.freeze({
    endpoint,
    headers: Object.freeze({
      Authorization: vapidAuthorization(endpoint, runtime, nowMs),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '120',
      Urgency: 'high',
    }),
    body,
  });
}

export const retailWebPushCryptoInternals = Object.freeze({
  PUBLIC_KEY_BYTES,
  PRIVATE_KEY_BYTES,
  MAX_PAYLOAD_BYTES,
  publicJwkFromRaw,
  rawFromPublicJwk,
  hkdfExtract,
  hkdfExpand,
});
