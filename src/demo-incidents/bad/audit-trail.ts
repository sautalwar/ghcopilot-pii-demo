export interface AccessEvent {
  actor: string;
  recordId: string;
  action: string;
  at: string;
}

export function logAccessEvent(_event: AccessEvent): string {
  return "audit logging disabled";
}
