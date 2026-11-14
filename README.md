# Delivery Trace Inspector

**A delivery happened. What happened next?**

An original MIT-licensed, offline diagnostic explorer for synthetic or strictly sanitized CRM, webhook, API and AI integration histories. It traces the supplied structural events from receipt to effect commit to acknowledgement, highlighting suspicious repeated effects and missing evidence. It is **not** an event receiver, production monitor or certification tool.

**Part of Sigma Code's Integration Reliability Tools.** Built for developers, integration owners and technical teams reviewing what supplied CRM, webhook, API or AI workflow event records appear to show.

**What it helps you see:** the recorded path from receipt through effect commit and acknowledgement, including potential duplicate-effect evidence, overdue acknowledgements, stalled operations and reconciliation gaps. Export findings for a human investigation or a scoped reliability-testing pilot.

**What it cannot establish:** whether a real production transaction happened twice or whether missing records prove a service failed. Results depend entirely on the synthetic or authorized sanitized event history you provide. The tool is not a live monitor, incident-response service or certification. See the [commercial enquiry](#commercial-enquiry) for a separately scoped review.

**Live demo:** https://esheenj.github.io/integration-delivery-trace-inspector/

## Run locally

Requires Node.js 20+ and uses no third-party runtime packages.

    git clone https://github.com/esheenj/integration-delivery-trace-inspector.git
    cd integration-delivery-trace-inspector
    npm test
    npm run demo
    node src/cli.mjs examples/fictional-delivery-trace.json markdown
    npm run build
    python3 -m http.server 8000 --bind 127.0.0.1 --directory dist

Open http://127.0.0.1:8000. The browser example and the CLI fixture are identical. Every result is evaluated against the fixed supplied asOf timestamp, not your actual current clock.

## Checks

- **Potential duplicate effects:** more than one distinct effectId recorded for a scoped tenant/route/operation. High-priority *record evidence*, not independent proof of duplicated real transactions.
- **Ordinary redelivery:** repeated received records for one delivery ID are informational, not automatically duplicate effects.
- **Overdue acknowledgement:** a committed effect lacks a later acknowledgement beyond the explicit policy threshold.
- **Stale work:** no terminal evidence exists and the last event falls outside the stale window.
- **Retry budget exceeded:** supplied received records exceed the chosen illustrative maximum.
- **Dead-letter work:** terminal failure needs a repair or reconciliation follow-up.
- **Missing receipt or commit:** acknowledgement or effect records lack earlier chain evidence in the supplied window.
- **Contradictory chronology, failure after commit, repeated acknowledgements and duplicate commit telemetry:** separate review or informational findings.

The included fictional fixture has **22 events across 7 operations**, with two high-priority findings, three review items, and two informational notes.

## Strict input contract

The top-level JSON object contains asOf, policy and events. The policy requires ackDeadlineMs and staleAfterMs (positive integers up to 2,592,000,000 milliseconds), and maxDeliveries (1–50). Each event requires id, at, tenant, route, operationId, deliveryId and state. A committed effect also requires effectId; other states must not have it.

Supported states: received, started, effect_committed, acknowledged, failed, dead_lettered, reconciled.

Identifiers must be 1–96 permitted alphanumeric/punctuation characters. Event IDs must be unique. Timestamps require an explicit ISO timezone; future events relative to asOf are rejected. The event count is capped at 500 and CLI input at 1 MiB. **Unknown fields such as payload or customer data are refused**, not silently interpreted.

Use only fictional or authorized sanitized identifiers. Even structural IDs may be commercially sensitive if copied from real systems. The browser stores no session data outside its current tab; only user-triggered exports save derived findings with structural IDs.

## Explicit limits

Only the supplied records are inspected. Missing telemetry, fabricated effects, an incomplete time window, provider-specific no-op acknowledgements and inaccurate event logs can alter every conclusion. Multiple recorded effect IDs do not prove two real-world transactions. A missing recorded acknowledgement does not prove that no acknowledgement occurred.

No real webhook intake, signature verification, event ingestion, payment, financial trading, production monitoring, external reconciliation, live test execution, customer adoption or compliance validation is implemented. Human review of the actual system of record remains necessary.

The app has zero external runtime packages, a strict local-only browser CSP, no telemetry, no storage, no network calls and no authority over private SIGMA, Cortex or Commander systems.

## Commercial enquiry

The free tool is self-service. A small diagnostic/testing pilot can be discussed via [Sigma Code email](mailto:info@sigmacode.co.za?subject=Integration%20delivery%20trace%20pilot%20enquiry) or a [nonsensitive GitHub pilot enquiry](https://github.com/esheenj/integration-delivery-trace-inspector/issues/new?template=pilot.yml). The enquiry is not a booking, sale or payment, and confidentiality/access must be agreed separately.

Companion tools: [Workflow Failure Test Builder](https://esheenj.github.io/workflow-failure-test-builder/), [Webhook Idempotency Lab](https://esheenj.github.io/webhook-idempotency-lab/), and [Integration Reliability Assessment](https://esheenj.github.io/integration-reliability-assessment/).

## Project structure

- src/inspect.mjs — deterministic rules, strict input validation and Markdown export
- src/cli.mjs — offline CLI
- site/ — user-facing browser playground
- examples/ — fictional input records
- scripts/build.mjs — static build and embedded validated example
- tests/ — deterministic unit and negative tests
- .github/workflows/ci-pages.yml — test and GitHub Pages gates

MIT licensed; contributions should use synthetic records and include targeted tests. Optional [public support details](https://esheenj.github.io/compound-intelligence-starter/support.html) do not mean fiat checkout or native GitHub Sponsors is active.

© 2026 Esheen Labs.
