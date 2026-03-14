// DEMO FILE: Remediated version of the SQL injection example.
// These handlers show parameterized queries for remediation workflow demos.

import { Request, Response } from 'express';

interface ParameterizedQuery {
  text: string;
  params: Record<string, string>;
}

function buildCitizenSearchQuery(name: string): ParameterizedQuery {
  return {
    text: 'SELECT * FROM citizens WHERE name = @name',
    params: { name }
  };
}

function buildCitizenByIdQuery(id: string): ParameterizedQuery {
  return {
    text: 'SELECT * FROM citizens WHERE id = @id',
    params: { id }
  };
}

export function searchCitizens(req: Request, res: Response) {
  const searchTerm = String(req.query.name || '');
  const query = buildCitizenSearchQuery(searchTerm);

  console.log('Executing parameterized query:', query);
  res.json({
    query: query.text,
    params: query.params,
    safe: true
  });
}

export function getCitizenById(req: Request, res: Response) {
  const id = String(req.params.id || '');
  const query = buildCitizenByIdQuery(id);

  console.log('Executing parameterized query:', query);
  res.json({
    query: query.text,
    params: query.params,
    safe: true
  });
}
