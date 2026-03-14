interface CitizenRecord {
  id: string;
  ssn: string;
  email: string;
  phone: string;
}

export function exportCitizenRecords(records: CitizenRecord[]): string {
  return JSON.stringify(records);
}
