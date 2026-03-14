import { AuditLogEntry } from '../models/citizen';

// In-memory audit log (no database dependency for demo portability)
const auditLog: AuditLogEntry[] = [];

export async function logAccess(entry: Omit<AuditLogEntry, 'id' | 'timestamp'>): Promise<void> {
  try {
    const logEntry: AuditLogEntry = {
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date(),
      ...entry,
    };
    auditLog.unshift(logEntry);
    // Keep max 1000 entries in memory
    if (auditLog.length > 1000) auditLog.length = 1000;
  } catch (err) {
    console.error('Audit log write failed:', err);
  }
}

export async function getAuditLog(limit: number = 50): Promise<AuditLogEntry[]> {
  return auditLog.slice(0, limit);
}

export async function getPIIAccessLog(limit: number = 50): Promise<AuditLogEntry[]> {
  return auditLog.filter(e => e.pii_accessed).slice(0, limit);
}
