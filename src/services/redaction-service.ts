import { Citizen, RedactedCitizen } from '../models/citizen';

/** Mask an SSN: 123-45-6789 → ***-**-6789 */
export function maskSSN(ssn: string): string {
  if (!ssn || ssn.length < 4) return '***-**-****';
  return `***-**-${ssn.slice(-4)}`;
}

/** Mask an email: john.doe@example.com → j***@example.com */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '***@***.***';
  return `${local[0]}***@${domain}`;
}

/** Mask a phone: (555) 123-4567 → (***) ***-4567 */
export function maskPhone(phone: string): string {
  if (!phone || phone.length < 4) return '(***) ***-****';
  return `(***) ***-${phone.slice(-4)}`;
}

/** Mask a street address: 123 Main St → *** Main St */
export function maskAddress(address: string): string {
  const parts = address.split(' ');
  if (parts.length <= 1) return '***';
  parts[0] = '***';
  return parts.join(' ');
}

/** Mask a date of birth: 1990-01-15 → masked with year hidden */
export function maskDOB(dob: Date): string {
  const month = String(dob.getMonth() + 1).padStart(2, '0');
  const day = String(dob.getDate()).padStart(2, '0');
  return `****/${month}/${day}`;
}

/** Redact all PII fields from a citizen record */
export function redactCitizen(citizen: Citizen): RedactedCitizen {
  return {
    id: citizen.id,
    first_name: citizen.first_name,
    last_name: citizen.last_name,
    ssn: maskSSN(citizen.ssn),
    date_of_birth: maskDOB(citizen.date_of_birth),
    email: maskEmail(citizen.email),
    phone: maskPhone(citizen.phone),
    street_address: maskAddress(citizen.street_address),
    city: citizen.city,
    state: citizen.state,
    zip_code: citizen.zip_code,
  };
}

/** Identify which fields in a record contain PII */
export function identifyPIIFields(record: Record<string, unknown>): string[] {
  const piiFields: string[] = [];
  const piiPatterns: Record<string, RegExp> = {
    ssn: /^\d{3}-\d{2}-\d{4}$/,
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    phone: /[\d\(\)\-\s]{10,}/,
  };
  const piiFieldNames = ['ssn', 'social_security', 'date_of_birth', 'dob', 'email', 'phone', 'address', 'street'];

  for (const [key, value] of Object.entries(record)) {
    if (piiFieldNames.some((name) => key.toLowerCase().includes(name))) {
      piiFields.push(key);
      continue;
    }
    if (typeof value === 'string') {
      for (const [, pattern] of Object.entries(piiPatterns)) {
        if (pattern.test(value)) {
          piiFields.push(key);
          break;
        }
      }
    }
  }
  return piiFields;
}
