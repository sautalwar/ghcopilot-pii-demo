# GitHub Copilot Instructions

## ⚠️ IMPORTANT: This file is NOT a security boundary

These instructions guide Copilot's behavior but are NOT deterministic.
The LLM may ignore, misinterpret, or bypass these rules.
**DO NOT rely on this file for security enforcement.**

Use code-level controls (redaction services, content exclusion, MCP output filtering)
for actual security guarantees.

---

## PII Handling Rules (Best-Effort)

1. **Never output raw Social Security Numbers** in suggestions or chat responses.
2. **Always use parameterized queries** when writing SQL — never concatenate user input.
3. **Prefer the redaction service** when working with citizen data — import from `services/redaction-service`.
4. **Do not hardcode credentials** in source files — use environment variables from `.env`.
5. **When suggesting test data**, use obviously fake values (e.g., SSN: 000-00-0000).
6. **Log all PII access** through the audit logger at `security/audit-logger`.

## Code Patterns to Prefer

- Use `getAllCitizensRedacted()` over `getAllCitizens()` for external-facing code
- Use `maskSSN()`, `maskEmail()`, `maskPhone()` from `services/redaction-service`
- Wrap data access with audit logging from `security/audit-logger`

## Code Patterns to Avoid

- Direct SQL queries without parameterization
- Logging PII values to console in production code
- Returning raw citizen records from API endpoints without redaction option
- Storing PII in plain text configuration files
