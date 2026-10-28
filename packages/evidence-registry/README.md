# Evidence Registry

**Status: Planned package — no persistence code is implemented yet.**

This package will store or access source records, evidence items, claim relationships, provenance, review events, and snapshots using interfaces that can be implemented with the chosen database/object store.

Requirements:
- tenant/project authorization enforced at every access boundary;
- distinguish user-supplied sources from independently discovered sources;
- preserve contradictions and source independence status;
- keep a source locator, retrieval date, and version reference for material findings;
- support correction and supersession without silently rewriting historic reports;
- apply defined retention and deletion rules;
- do not treat a URL, repository ownership, or structured-data field as proof of factual truth;
- keep invoice/plan data and commercial customer notes out of evaluator-domain records.
