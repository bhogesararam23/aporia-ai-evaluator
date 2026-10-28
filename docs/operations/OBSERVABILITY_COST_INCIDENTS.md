# Observability, Cost Controls, and Incident Response

## 1. Observability objectives

Every evaluation must be explainable as a sequence of stages. Operational telemetry should make it possible to identify whether a result was caused by source fetch failure, provider outage, response parsing, evaluator logic, report generation, or a genuine observed answer outcome.

## 2. Required events

Record structured events for:
- intake accepted/rejected;
- URL safety decision and fetch outcome;
- source retrieved/failed/changed;
- claim decomposition created/revised;
- query set created/approved;
- provider request queued/started/completed/failed;
- citation parse and source resolution status;
- assessment produced/reviewed/overridden;
- report generated/exported;
- public page previewed/published/updated/withdrawn;
- user dispute or correction;
- cancellation, timeout, rate limit, quota/cost stop, and retry.

Each event carries a timestamp, correlation/run ID, stage, status, and safe error category. Do not log secrets, full private files, or unnecessary personal information.

## 3. Run status semantics

- COMPLETED: all required planned steps completed.
- PARTIAL: some outputs exist but required steps did not complete.
- FAILED: run could not deliver usable evaluation outputs.
- UNAVAILABLE: requested provider/action cannot be accessed or supported.
- CANCELLED: explicitly stopped by user or system.
- BLOCKED_BY_POLICY: a fetch or action was refused by permission or safety policy.

Only eligible completed answer outputs are used for mention/citation metrics. Failure statuses remain visible in the denominator accounting and report.

## 4. Cost controls

- Require per-run query and provider-call budgets.
- Estimate spend before deep runs when pricing information is available.
- Apply hard caps for total calls, retries, wall-clock time, tokens/output size, crawl pages, and upload processing.
- Record estimated versus reported actual usage and note when provider pricing/usage data is unavailable.
- Use caching only where lawful, semantically safe, and consistent with provider terms; cache keys include provider/model/configuration and version.
- Deduplicate identical source fetches where possible.
- Use a cost circuit breaker and per-tenant rate limits.
- Never continue an agentic search loop indefinitely.

## 5. Reliability and retries

Use bounded exponential backoff with jitter for retryable transient failures. Do not retry invalid credentials, policy refusals, or bad request payloads without corrective action. Honour retry-after hints where available. Avoid duplicate billable calls where idempotency is unavailable. Record every retry and whether it may incur cost.

## 6. Service-level indicators

Initially measure:
- run completion rate by provider/stage;
- provider timeout/rate-limit/auth error rates;
- latency by stage and provider;
- malformed response/citation parse rate;
- report generation failures;
- queue depth and job age;
- cost per completed eligible test and per report;
- source fetch errors and safety-block frequency;
- correction/dispute volume and evaluator override rate.

Do not set unsupported service-level objectives until baseline behavior is measured.

## 7. Alerting

Alerts should include repeated provider failures, unexpected cost spikes, queue backlog, elevated error rates, security boundary violations, report export failures, and sudden changes to adapter schema. Avoid alerting on individual negative claim verdicts as though they were operational failures.

## 8. Incident response

For each incident:
1. identify affected systems, tenants, data types, and time window;
2. contain the issue, disable a risky provider/action, or stop affected workers;
3. preserve relevant logs securely;
4. determine whether private data, credentials, or public claims were exposed or corrupted;
5. assess legal/contractual notification duties with appropriate review;
6. restore from known-good state and rotate credentials as needed;
7. correct affected reports or pages with a visible audit event;
8. document root cause, impact, remediation, and preventive actions;
9. add a regression or operational test.

Do not delete incident evidence simply to make dashboards appear healthy.

## 9. Provider outage and drift

A provider outage is not a claim-evaluation verdict. Mark affected tests unavailable. A provider model or search update may change outputs without Aporia changes; record dates/identifiers and use provider drift notes. Compare historical results only with caveats where conditions differ.

## 10. Runbook minimum

Each live integration must have a runbook listing owner, official status/docs URL, credentials path (never values), health checks, limits, common errors, retry rules, cost behavior, disable procedure, rollback, and last verified date. If a runbook is absent, the integration is not production-ready.
