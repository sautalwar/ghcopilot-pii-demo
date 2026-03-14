// DEMO FILE: Intentionally vulnerable code for demo purposes.
// This file exists so scanners and workflows can detect unsafe SQL patterns.

import { Request, Response } from 'express';

// VULNERABLE: String concatenation in SQL query.
export function searchCitizens(req: Request, res: Response) {
  const searchTerm = req.query.name as string;

  // BAD: SQL Injection vulnerability - user input is concatenated directly.
  const query = `SELECT * FROM citizens WHERE name = '${searchTerm}'`;

  // This would allow: searchTerm = "'; DROP TABLE citizens; --"
  console.log(`Executing query: ${query}`);

  // Simulated execution only.
  res.json({ query, warning: 'This query is vulnerable to SQL injection!' });
}

// VULNERABLE: Another injection point.
export function getCitizenById(req: Request, res: Response) {
  const id = req.params.id;

  // BAD: No parameterization.
  const query = `SELECT * FROM citizens WHERE id = ${id}`;
  console.log(`Executing: ${query}`);

  res.json({ query });
}

// FIXED VERSION (kept here for remediation comparisons during the demo).
export function searchCitizensSafe(req: Request, res: Response) {
  const searchTerm = req.query.name as string;

  // GOOD: Parameterized query.
  const query = 'SELECT * FROM citizens WHERE name = @searchTerm';
  const params = { searchTerm };

  console.log('Executing parameterized query with params:', params);
  res.json({ query, params, safe: true });
}
