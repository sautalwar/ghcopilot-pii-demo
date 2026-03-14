interface CitizenRecord {
  id: string;
  ssn: string;
  email: string;
  phone: string;
}

function maskValue(value: string, visibleCharacters: number): string {
  const hiddenLength = Math.max(0, value.length - visibleCharacters);
  return `${"*".repeat(hiddenLength)}${value.slice(-visibleCharacters)}`;
}

export function exportCitizenRecords(records: CitizenRecord[]): string {
  return JSON.stringify(
    records.map((record) => ({
      ...record,
      ssn: maskValue(record.ssn, 4),
      email: maskValue(record.email, 3),
      phone: maskValue(record.phone, 2),
    })),
  );
}
