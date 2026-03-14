/**
 * Column-Level Encryption Helpers
 *
 * Demonstrates application-level encryption for PII fields.
 * In production, use SQL Server Always Encrypted or Azure Key Vault.
 * This is a simplified demo to show the concept.
 */

import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

// In production, this key would come from Azure Key Vault or HSM
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');

function getKey(): Buffer {
  return Buffer.from(ENCRYPTION_KEY, 'hex');
}

export function encryptField(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const tag = cipher.getAuthTag();

  // Format: iv:tag:ciphertext (all hex-encoded)
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`;
}

export function decryptField(encryptedValue: string): string {
  const parts = encryptedValue.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted value format');

  const iv = Buffer.from(parts[0], 'hex');
  const tag = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];

  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Demo: Show that even if someone accesses the raw database,
 * encrypted fields are unreadable without the key.
 */
export function demonstrateEncryption(): void {
  const ssn = '123-45-6789';
  const encrypted = encryptField(ssn);
  const decrypted = decryptField(encrypted);

  console.log('=== Column-Level Encryption Demo ===');
  console.log(`Original SSN:  ${ssn}`);
  console.log(`Encrypted:     ${encrypted}`);
  console.log(`Decrypted:     ${decrypted}`);
  console.log(`Match:         ${ssn === decrypted ? '✅ Yes' : '❌ No'}`);
  console.log('');
  console.log('Key point: Even if Copilot or an attacker sees the encrypted value,');
  console.log('they cannot recover the SSN without the encryption key.');
}
