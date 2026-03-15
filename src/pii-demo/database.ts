import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

import { maskEmail, maskPhone, maskSSN } from "../services/redaction-service";

export interface DemoCitizen {
  id: number;
  first_name: string;
  last_name: string;
  ssn: string;
  date_of_birth: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  zip: string;
}

export interface RedactedDemoCitizen extends Omit<DemoCitizen, "ssn" | "email" | "phone"> {
  ssn: string;
  email: string;
  phone: string;
}

export interface QueryLogEntry {
  id: number;
  timestamp: string;
  operation: string;
  sql: string;
  parameters: Array<string | number>;
  rows_returned: number;
  destination: string;
  copilot_contacted: false;
  outbound_hosts: string[];
  note: string;
}

export interface CitizenSchemaColumn {
  name: string;
  type: string;
  required: boolean;
  primary_key: boolean;
}

interface CitizenSchemaRow {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: unknown;
  pk: number;
}

const dataDirectoryPath = path.resolve(process.cwd(), "data");
const databasePath = path.resolve(dataDirectoryPath, "citizens.db");
const databaseDisplayPath = "data\\citizens.db";
const queryLog: QueryLogEntry[] = [];

const seedCitizens: Array<Omit<DemoCitizen, "id">> = [
  {
    first_name: "Avery",
    last_name: "Example",
    ssn: "000-11-1201",
    date_of_birth: "1987-03-14",
    email: "avery.example@example.test",
    phone: "(555) 010-1201",
    address: "101 Demo Avenue",
    city: "Seattle",
    state: "WA",
    zip: "98101",
  },
  {
    first_name: "Milo",
    last_name: "Placeholder",
    ssn: "000-12-2202",
    date_of_birth: "1991-07-22",
    email: "milo.placeholder@example.test",
    phone: "(555) 010-2202",
    address: "202 Mockingbird Lane",
    city: "Austin",
    state: "TX",
    zip: "73301",
  },
  {
    first_name: "Nora",
    last_name: "Sample",
    ssn: "000-13-3203",
    date_of_birth: "1979-11-03",
    email: "nora.sample@example.test",
    phone: "(555) 010-3203",
    address: "303 Fiction Street",
    city: "Boston",
    state: "MA",
    zip: "02108",
  },
  {
    first_name: "Felix",
    last_name: "Fiction",
    ssn: "000-14-4204",
    date_of_birth: "1983-05-29",
    email: "felix.fiction@example.test",
    phone: "(555) 010-4204",
    address: "404 Nowhere Road",
    city: "Denver",
    state: "CO",
    zip: "80202",
  },
  {
    first_name: "Ivy",
    last_name: "Mockwell",
    ssn: "000-15-5205",
    date_of_birth: "1995-01-18",
    email: "ivy.mockwell@example.test",
    phone: "(555) 010-5205",
    address: "505 Synthetic Court",
    city: "Chicago",
    state: "IL",
    zip: "60601",
  },
  {
    first_name: "Owen",
    last_name: "Pretend",
    ssn: "000-16-6206",
    date_of_birth: "1988-09-09",
    email: "owen.pretend@example.test",
    phone: "(555) 010-6206",
    address: "606 Localhost Drive",
    city: "Phoenix",
    state: "AZ",
    zip: "85004",
  },
  {
    first_name: "Riley",
    last_name: "Demo",
    ssn: "000-17-7207",
    date_of_birth: "1992-12-11",
    email: "riley.demo@example.test",
    phone: "(555) 010-7207",
    address: "707 Runtime Boulevard",
    city: "Nashville",
    state: "TN",
    zip: "37219",
  },
  {
    first_name: "Casey",
    last_name: "Synthetic",
    ssn: "000-18-8208",
    date_of_birth: "1985-04-05",
    email: "casey.synthetic@example.test",
    phone: "(555) 010-8208",
    address: "808 Redaction Way",
    city: "Atlanta",
    state: "GA",
    zip: "30303",
  },
  {
    first_name: "Harper",
    last_name: "Standin",
    ssn: "000-19-9209",
    date_of_birth: "1990-08-27",
    email: "harper.standin@example.test",
    phone: "(555) 010-9209",
    address: "909 Safety Street",
    city: "Portland",
    state: "OR",
    zip: "97204",
  },
  {
    first_name: "Canary",
    last_name: "Testbird",
    ssn: "000-99-0000",
    date_of_birth: "1999-01-01",
    email: "canary.testbird@example.test",
    phone: "(555) 010-0000",
    address: "1000 Proof Point Plaza",
    city: "Raleigh",
    state: "NC",
    zip: "27601",
  },
];

fs.mkdirSync(dataDirectoryPath, { recursive: true });

const database = new Database(databasePath);
database.pragma("journal_mode = WAL");

database.exec(`
  CREATE TABLE IF NOT EXISTS citizens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    ssn TEXT NOT NULL,
    date_of_birth TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL,
    address TEXT NOT NULL,
    city TEXT NOT NULL,
    state TEXT NOT NULL,
    zip TEXT NOT NULL
  )
`);

seedDatabaseIfEmpty();

function recordQuery(
  operation: string,
  sql: string,
  parameters: Array<string | number>,
  rowsReturned: number,
  note: string,
): void {
  queryLog.push({
    id: queryLog.length + 1,
    timestamp: new Date().toISOString(),
    operation,
    sql,
    parameters,
    rows_returned: rowsReturned,
    destination: `${databaseDisplayPath} (local SQLite file)`,
    copilot_contacted: false,
    outbound_hosts: [],
    note,
  });
}

function seedDatabaseIfEmpty(): void {
  const countRow = database.prepare("SELECT COUNT(*) AS count FROM citizens").get() as { count: number };

  if (countRow.count > 0) {
    return;
  }

  const insertCitizen = database.prepare(`
    INSERT INTO citizens (
      first_name,
      last_name,
      ssn,
      date_of_birth,
      email,
      phone,
      address,
      city,
      state,
      zip
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = database.transaction((citizens: Array<Omit<DemoCitizen, "id">>) => {
    for (const citizen of citizens) {
      insertCitizen.run(
        citizen.first_name,
        citizen.last_name,
        citizen.ssn,
        citizen.date_of_birth,
        citizen.email,
        citizen.phone,
        citizen.address,
        citizen.city,
        citizen.state,
        citizen.zip,
      );
    }
  });

  insertMany(seedCitizens);
  recordQuery(
    "SEED_DATABASE",
    "INSERT INTO citizens (...) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [],
    seedCitizens.length,
    "Inserted fake demo-only citizens locally. No network calls were required.",
  );
}

function queryCitizens(operation: string, sql: string, parameters: Array<string | number> = []): DemoCitizen[] {
  const rows = database.prepare(sql).all(...parameters) as DemoCitizen[];
  recordQuery(operation, sql, parameters, rows.length, "Read data directly from the local SQLite file. No Copilot or cloud traffic occurred.");
  return rows;
}

function queryCitizen(operation: string, sql: string, parameters: Array<string | number> = []): DemoCitizen | undefined {
  const citizen = database.prepare(sql).get(...parameters) as DemoCitizen | undefined;
  recordQuery(operation, sql, parameters, citizen ? 1 : 0, "Read data directly from the local SQLite file. No Copilot or cloud traffic occurred.");
  return citizen;
}

export function redactCitizenRecord(citizen: DemoCitizen): RedactedDemoCitizen {
  return {
    ...citizen,
    ssn: maskSSN(citizen.ssn),
    email: maskEmail(citizen.email),
    phone: maskPhone(citizen.phone),
  };
}

export function getAllCitizens(): DemoCitizen[] {
  return queryCitizens(
    "GET_ALL_CITIZENS_RAW",
    `
      SELECT id, first_name, last_name, ssn, date_of_birth, email, phone, address, city, state, zip
      FROM citizens
      ORDER BY id ASC
    `,
  );
}

export function getCitizenById(id: number): DemoCitizen | undefined {
  return queryCitizen(
    "GET_CITIZEN_BY_ID",
    `
      SELECT id, first_name, last_name, ssn, date_of_birth, email, phone, address, city, state, zip
      FROM citizens
      WHERE id = ?
    `,
    [id],
  );
}

export function searchCitizens(query: string): DemoCitizen[] {
  const searchTerm = `%${query.trim()}%`;
  return queryCitizens(
    "SEARCH_CITIZENS",
    `
      SELECT id, first_name, last_name, ssn, date_of_birth, email, phone, address, city, state, zip
      FROM citizens
      WHERE first_name LIKE ? OR last_name LIKE ? OR (first_name || ' ' || last_name) LIKE ?
      ORDER BY last_name ASC, first_name ASC
    `,
    [searchTerm, searchTerm, searchTerm],
  );
}

export function getAllCitizensRedacted(): RedactedDemoCitizen[] {
  return queryCitizens(
    "GET_ALL_CITIZENS_REDACTED",
    `
      SELECT id, first_name, last_name, ssn, date_of_birth, email, phone, address, city, state, zip
      FROM citizens
      ORDER BY id ASC
    `,
  ).map(redactCitizenRecord);
}

export function getQueryLog(): QueryLogEntry[] {
  return [...queryLog];
}

export function getCitizenSchema(): CitizenSchemaColumn[] {
  const rows = database.prepare("PRAGMA table_info(citizens)").all() as CitizenSchemaRow[];
  return rows.map((row) => ({
    name: row.name,
    type: row.type,
    required: row.notnull === 1,
    primary_key: row.pk === 1,
  }));
}

export function getDatabaseProof(): {
  path: string;
  absolute_path: string;
  exists: boolean;
  citizen_count: number;
  canary_name: string;
} {
  const countRow = database.prepare("SELECT COUNT(*) AS count FROM citizens").get() as { count: number };

  return {
    path: databaseDisplayPath,
    absolute_path: databasePath,
    exists: fs.existsSync(databasePath),
    citizen_count: countRow.count,
    canary_name: "Canary Testbird",
  };
}
