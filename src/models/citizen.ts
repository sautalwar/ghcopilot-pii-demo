export interface Citizen {
  id: string;
  first_name: string;
  last_name: string;
  ssn: string;
  date_of_birth: Date;
  email: string;
  phone: string;
  street_address: string;
  city: string;
  state: string;
  zip_code: string;
  created_at: Date;
  updated_at: Date;
}

/** A citizen record with PII fields redacted for safe external use */
export interface RedactedCitizen {
  id: string;
  first_name: string;
  last_name: string;
  ssn: string;            // Masked: ***-**-1234
  date_of_birth: string;  // Masked: ****/01/1990
  email: string;          // Masked: j***@example.com
  phone: string;          // Masked: (***) ***-1234
  street_address: string; // Masked: *** Main St
  city: string;
  state: string;
  zip_code: string;
}

export interface AuditLogEntry {
  id: string;
  action: 'READ' | 'WRITE' | 'DELETE' | 'SEARCH';
  table_name: string;
  record_id?: string;
  fields_accessed?: string;
  user_identity: string;
  source: 'API' | 'MCP_SERVER' | 'DIRECT_QUERY' | 'LOCAL_AI';
  pii_accessed: boolean;
  timestamp: Date;
}
