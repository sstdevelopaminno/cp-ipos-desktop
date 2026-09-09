export type PinCredential = {
  pinHash: string;
  pinSalt: string;
  pinHashAlgorithm: "PBKDF2-SHA256";
  pinHashIterations: number;
};

const PIN_HASH_ITERATIONS = 210_000;
const PIN_HASH_ALGORITHM = "PBKDF2-SHA256" as const;

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const base64ToBytes = (value: string) => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

const constantTimeEqual = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

const deriveHash = async (pin: string, salt: string, iterations: number) => {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: base64ToBytes(salt), iterations },
    material,
    256,
  );
  return bytesToBase64(new Uint8Array(bits));
};

export const createPinCredential = async (pin: string): Promise<PinCredential> => {
  const saltBytes = new Uint8Array(16);
  crypto.getRandomValues(saltBytes);
  const pinSalt = bytesToBase64(saltBytes);
  return {
    pinHash: await deriveHash(pin, pinSalt, PIN_HASH_ITERATIONS),
    pinSalt,
    pinHashAlgorithm: PIN_HASH_ALGORITHM,
    pinHashIterations: PIN_HASH_ITERATIONS,
  };
};

export const verifyPinCredential = async (
  pin: string,
  credential: Partial<PinCredential>,
) => {
  if (
    credential.pinHashAlgorithm !== PIN_HASH_ALGORITHM ||
    !credential.pinHash ||
    !credential.pinSalt ||
    !credential.pinHashIterations
  ) {
    return false;
  }
  const candidate = await deriveHash(pin, credential.pinSalt, credential.pinHashIterations);
  return constantTimeEqual(candidate, credential.pinHash);
};