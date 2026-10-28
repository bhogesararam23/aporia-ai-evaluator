# Test Organization

**Status: Implemented for local v0.1.**

The automated suite runs with Node's built-in test runner over TypeScript sources:

- `tests/unit/` — pure core, validation, evidence, metrics, website parsing, reporting/CSV, security helpers, routing, views, configuration, logger, and boundary checks.
- `tests/integration/` — configuration/database, migrations, schema triggers, repositories, HTTP security, project/entity/claim workflows, query-set/run/import workflows, HTML upload/audit, report generation and immutability, and accessibility structure.
- `tests/helpers/` — isolated in-memory/temporary fixtures and HTTP client helpers. These are test-only and are never shipped as application or demo records.

Commands and current results are in [Testing and verification](../docs/TESTING.md). Important rules:

- Use real SQLite transactions and real HTTP form submissions for boundary behavior.
- Preserve failed, unavailable, and contradictory cases in fixtures.
- Do not create production seed data from test fixtures.
- Add a regression test for every defect, metric change, verdict change, eligibility change, or security fix.
- Do not remove a failing test to make the suite green.
