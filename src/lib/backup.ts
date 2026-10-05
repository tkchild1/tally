import type { ISODate } from './dates';

/**
 * Backup file format (section 11). Pure: takes and returns rows, never touches the DB.
 * Plain: { app, version, exportedAt, tables }.
 * Encrypted: { app, encrypted: true, v, kdf, iter, salt, iv, ct } with AES-GCM and a PBKDF2-SHA256 key.
 */

export const BACKUP_VERSION = 1;
export const PBKDF2_ITERATIONS = 600_000;

export const BACKUP_TABLES = [
  'accounts',
  'balance_snapshots',
  'imports',
  'transactions',
  'merchant_rules',
  'merchant_flags',
  'categories',
  'budgets',
] as const;

export type BackupTableName = (typeof BACKUP_TABLES)[number];
export type BackupRow = Record<string, unknown>;
export type BackupTables = Record<BackupTableName, BackupRow[]>;

export interface BackupData {
  app: 'tally';
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  tables: BackupTables;
}

export interface EncryptedBackup {
  app: 'tally';
  encrypted: true;
  v: 1;
  kdf: 'PBKDF2-SHA256';
  iter: number;
  salt: string;
  iv: string;
  ct: string;
}

export type BackupErrorCode = 'invalid' | 'unsupported_version' | 'needs_passphrase' | 'wrong_passphrase' | 'no_crypto';

/** Messages never include file contents. */
export class BackupError extends Error {
  constructor(
    readonly code: BackupErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'BackupError';
  }
}

export function createBackup(tables: BackupTables, exportedAt: string): BackupData {
  return { app: 'tally', version: BACKUP_VERSION, exportedAt, tables };
}

export function backupFileName(date: ISODate): string {
  return `tally-${date}.budgetbackup.json`;
}

export function backupCounts(data: BackupData): Record<BackupTableName, number> {
  return Object.fromEntries(BACKUP_TABLES.map((t) => [t, data.tables[t].length])) as Record<BackupTableName, number>;
}

/** Serialize a backup, encrypting it when a non-empty passphrase is given. */
export async function serializeBackup(data: BackupData, passphrase?: string): Promise<string> {
  const json = JSON.stringify(data);
  if (!passphrase) return json;
  const subtle = getSubtle();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(subtle, passphrase, salt, PBKDF2_ITERATIONS);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(json)));
  const wrapper: EncryptedBackup = {
    app: 'tally',
    encrypted: true,
    v: 1,
    kdf: 'PBKDF2-SHA256',
    iter: PBKDF2_ITERATIONS,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ct: toBase64(ct),
  };
  return JSON.stringify(wrapper);
}

/** True if the text looks like an encrypted Tally backup (so the UI can ask for the passphrase first). */
export function isEncryptedBackup(text: string): boolean {
  try {
    const v: unknown = JSON.parse(text);
    return isObject(v) && v.app === 'tally' && v.encrypted === true;
  } catch {
    return false;
  }
}

/** Parse (and decrypt if needed) a backup file, validating its shape. */
export async function parseBackup(text: string, passphrase?: string): Promise<BackupData> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new BackupError('invalid', 'This is not a Tally backup file.');
  }
  if (!isObject(value) || value.app !== 'tally') throw new BackupError('invalid', 'This is not a Tally backup file.');

  if (value.encrypted === true) {
    if (!passphrase) throw new BackupError('needs_passphrase', 'This backup is encrypted. Enter its passphrase.');
    value = await decrypt(value, passphrase);
  }
  return validate(value);
}

async function decrypt(wrapper: Record<string, unknown>, passphrase: string): Promise<unknown> {
  const { v, kdf, iter, salt, iv, ct } = wrapper;
  if (v !== 1 || kdf !== 'PBKDF2-SHA256') {
    throw new BackupError('unsupported_version', 'This backup uses an encryption format this version of Tally does not know.');
  }
  if (typeof iter !== 'number' || !Number.isInteger(iter) || iter < 1 || typeof salt !== 'string' || typeof iv !== 'string' || typeof ct !== 'string') {
    throw new BackupError('invalid', 'The encrypted backup is damaged.');
  }
  const subtle = getSubtle();
  let plain: ArrayBuffer;
  try {
    const key = await deriveKey(subtle, passphrase, fromBase64(salt), iter);
    plain = await subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(iv) }, key, fromBase64(ct));
  } catch {
    // AES-GCM authentication fails for a wrong passphrase (or a modified file); both mean "can't open".
    throw new BackupError('wrong_passphrase', 'Wrong passphrase, or the file was modified.');
  }
  try {
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    throw new BackupError('invalid', 'The encrypted backup is damaged.');
  }
}

function validate(value: unknown): BackupData {
  if (!isObject(value) || value.app !== 'tally') throw new BackupError('invalid', 'This is not a Tally backup file.');
  if (value.version !== BACKUP_VERSION) {
    throw new BackupError('unsupported_version', 'This backup was made by a different version of Tally.');
  }
  const tables = value.tables;
  if (!isObject(tables)) throw new BackupError('invalid', 'The backup has no tables.');
  for (const t of BACKUP_TABLES) {
    const rows = tables[t];
    if (!Array.isArray(rows) || !rows.every(isObject)) throw new BackupError('invalid', `The backup's "${t}" table is missing or damaged.`);
  }
  return {
    app: 'tally',
    version: BACKUP_VERSION,
    exportedAt: typeof value.exportedAt === 'string' ? value.exportedAt : '',
    tables: Object.fromEntries(BACKUP_TABLES.map((t) => [t, tables[t]])) as BackupTables,
  };
}

function getSubtle(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new BackupError('no_crypto', 'Encryption needs a secure (HTTPS) page.');
  return subtle;
}

async function deriveKey(subtle: SubtleCrypto, passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const base = await subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  let s: string;
  try {
    s = atob(b64);
  } catch {
    throw new BackupError('invalid', 'The encrypted backup is damaged.');
  }
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
