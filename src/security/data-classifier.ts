/**
 * Data Classification Utility
 *
 * Scans records and identifies which fields contain PII.
 * Used in the POC to demonstrate automated PII detection.
 */

export type PIICategory = 'SSN' | 'EMAIL' | 'PHONE' | 'DOB' | 'ADDRESS' | 'NAME';

export interface PIIFieldResult {
  fieldName: string;
  category: PIICategory;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  sampleValue?: string;
  maskedValue?: string;
}

const SSN_PATTERN = /^\d{3}-\d{2}-\d{4}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^[\d\(\)\-\s\+\.]{10,}$/;
const DOB_FIELD_NAMES = ['date_of_birth', 'dob', 'birth_date', 'birthdate'];
const NAME_FIELD_NAMES = ['first_name', 'last_name', 'full_name', 'name'];
const ADDRESS_FIELD_NAMES = ['address', 'street', 'street_address'];

export function classifyRecord(record: Record<string, unknown>): PIIFieldResult[] {
  const results: PIIFieldResult[] = [];

  for (const [key, value] of Object.entries(record)) {
    const lowerKey = key.toLowerCase();

    // Check field name patterns
    if (lowerKey.includes('ssn') || lowerKey.includes('social_security')) {
      results.push({ fieldName: key, category: 'SSN', confidence: 'HIGH' });
      continue;
    }

    if (NAME_FIELD_NAMES.some((n) => lowerKey.includes(n))) {
      results.push({ fieldName: key, category: 'NAME', confidence: 'HIGH' });
      continue;
    }

    if (DOB_FIELD_NAMES.some((n) => lowerKey === n)) {
      results.push({ fieldName: key, category: 'DOB', confidence: 'HIGH' });
      continue;
    }

    if (ADDRESS_FIELD_NAMES.some((n) => lowerKey.includes(n))) {
      results.push({ fieldName: key, category: 'ADDRESS', confidence: 'HIGH' });
      continue;
    }

    if (lowerKey.includes('email')) {
      results.push({ fieldName: key, category: 'EMAIL', confidence: 'HIGH' });
      continue;
    }

    if (lowerKey.includes('phone') || lowerKey.includes('tel')) {
      results.push({ fieldName: key, category: 'PHONE', confidence: 'HIGH' });
      continue;
    }

    // Check value patterns
    if (typeof value === 'string') {
      if (SSN_PATTERN.test(value)) {
        results.push({ fieldName: key, category: 'SSN', confidence: 'MEDIUM' });
      } else if (EMAIL_PATTERN.test(value)) {
        results.push({ fieldName: key, category: 'EMAIL', confidence: 'MEDIUM' });
      } else if (PHONE_PATTERN.test(value)) {
        results.push({ fieldName: key, category: 'PHONE', confidence: 'LOW' });
      }
    }
  }

  return results;
}

export function generateClassificationReport(records: Record<string, unknown>[]): string {
  if (records.length === 0) return 'No records to classify.';

  const sample = records[0];
  const fields = classifyRecord(sample);

  let report = '=== PII Classification Report ===\n\n';
  report += `Records analyzed: ${records.length}\n`;
  report += `Fields scanned: ${Object.keys(sample).length}\n`;
  report += `PII fields detected: ${fields.length}\n\n`;

  if (fields.length > 0) {
    report += 'PII Fields Found:\n';
    for (const field of fields) {
      report += `  ⚠️  ${field.fieldName} → ${field.category} (${field.confidence} confidence)\n`;
    }
  } else {
    report += '✅ No PII fields detected.\n';
  }

  return report;
}
