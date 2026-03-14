export function buildCitizenLookupQuery(): string {
  return "SELECT * FROM citizens WHERE ssn = $1";
}

export function buildCitizenLookupParams(ssn: string): string[] {
  return [ssn];
}
