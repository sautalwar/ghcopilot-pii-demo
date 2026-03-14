// DEMO FILE: Intentionally contains fake PII patterns for demo purposes.
// All data below is fake test data only.

interface CitizenRecord {
  name: string;
  ssn: string;
  email: string;
  phone: string;
  address: string;
}

// FAKE test data - none of these are real people.
const testCitizens: CitizenRecord[] = [
  {
    name: "John Demo",
    ssn: "000-00-3456",
    email: "john.demo@fakeemail.test",
    phone: "555-123-4567",
    address: "123 Demo Street, Testville, TS 00000"
  },
  {
    name: "Jane Sample",
    ssn: "000-00-4321",
    email: "jane.sample@fakeemail.test",
    phone: "555-987-6543",
    address: "456 Sample Ave, Demotown, DM 00000"
  },
  {
    name: "Bob Testuser",
    ssn: "000-00-2222",
    email: "bob.test@fakeemail.test",
    phone: "(555) 111-2222",
    address: "789 Test Blvd, Mockville, MK 00000"
  }
];

// BAD PRACTICE: Logging fake PII directly to console.
export function processRecords() {
  testCitizens.forEach((citizen) => {
    console.log(`Processing ${citizen.name} - SSN: ${citizen.ssn}`);
  });

  return testCitizens;
}

// BAD PRACTICE: Returning raw fake PII without redaction.
export function getCitizenBySSN(ssn: string) {
  return testCitizens.find((citizen) => citizen.ssn === ssn);
}
