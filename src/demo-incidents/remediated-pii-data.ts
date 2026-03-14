// DEMO FILE: Remediated version of the PII leak example.
// All records below remain fake, but the processing path now redacts sensitive fields.

import { maskSSN, maskEmail, maskPhone } from '../services/redaction-service';

interface CitizenRecord {
  name: string;
  ssn: string;
  email: string;
  phone: string;
  address: string;
}

const testCitizens: CitizenRecord[] = [
  {
    name: 'John Demo',
    ssn: '000-00-3456',
    email: 'john.demo@fakeemail.test',
    phone: '555-123-4567',
    address: '123 Demo Street, Testville, TS 00000'
  },
  {
    name: 'Jane Sample',
    ssn: '000-00-4321',
    email: 'jane.sample@fakeemail.test',
    phone: '555-987-6543',
    address: '456 Sample Ave, Demotown, DM 00000'
  },
  {
    name: 'Bob Testuser',
    ssn: '000-00-2222',
    email: 'bob.test@fakeemail.test',
    phone: '(555) 111-2222',
    address: '789 Test Blvd, Mockville, MK 00000'
  }
];

// FIXED: PII is redacted before logging and before returning results.
export function processRecords() {
  testCitizens.forEach((citizen) => {
    console.log(`Processing ${citizen.name} - SSN: ${maskSSN(citizen.ssn)}`);
  });

  return testCitizens.map((citizen) => ({
    ...citizen,
    ssn: maskSSN(citizen.ssn),
    email: maskEmail(citizen.email),
    phone: maskPhone(citizen.phone)
  }));
}

export function getCitizenBySSN(ssn: string) {
  const citizen = testCitizens.find((record) => record.ssn === ssn);

  if (!citizen) {
    return undefined;
  }

  return {
    ...citizen,
    ssn: maskSSN(citizen.ssn),
    email: maskEmail(citizen.email),
    phone: maskPhone(citizen.phone)
  };
}
