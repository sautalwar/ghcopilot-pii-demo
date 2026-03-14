export interface AccessEvent {
  actor: string;
  recordId: string;
  action: string;
  at: string;
}

export function logAccessEvent(event: AccessEvent): string {
  return JSON.stringify({
    ...event,
    logged: true,
  });
}
