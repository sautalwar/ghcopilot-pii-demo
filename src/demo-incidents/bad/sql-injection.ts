export function buildCitizenLookupQuery(ssn: string): string {
  return `SELECT * FROM citizens WHERE ssn = '${ssn}'`;
}
