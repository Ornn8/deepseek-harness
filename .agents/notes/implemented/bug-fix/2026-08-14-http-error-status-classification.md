# Agent Note: Webserver error status classification — client 400, internal 500, and narrowed SPA misses

Status: implemented

English | [中文](2026-08-14-http-error-status-classification.zh.md)

## Problem

Two adjacent HTTP error-handling paths masked genuine server-side failures. The SPA dist server caught every `readFile(target)` rejection and served `index.html` with HTTP 200, so a permission error or descriptor exhaustion looked like a successful page load. The webserver request guard answered every rejected route or fallback handler with HTTP 400 before headers were sent, so an internal handler exception was reported as client error. Both hid the original cause and produced confusing downstream browser failures.

## Decision

**`BadRequestError` is the explicit client-error contract at the request guard.** The webserver exports `BadRequestError extends Error`; a route or fallback handler throws it exactly when the client input itself is malformed (a bad %-escape, an unparsable request target). The guard answers `BadRequestError` with 400, every other rejection with 500 — never 400, never a process exit — and destroys the connection when headers are already out, with logging and containment unchanged. The two decode sites that translate URL pathnames for serving (`frontend-static`'s fallback and `client-modules`' bundle route) wrap their `decodeURIComponent` failures in `BadRequestError`; the webserver's own request-target parse classifies the same way.

**The SPA fallback accepts only intentional misses.** `frontend-static` falls back to `index.html` with 200 only for `ENOENT` (no such path) and `EISDIR` (a real directory below the root); every other read failure — `EACCES`, `EMFILE`, transient I/O — propagates to the request guard and answers 500.

## Alternatives considered

- **Classifying on the `URIError` builtin at the guard** — avoids a new type, but the signal is implicit: any handler throwing `URIError` for a non-request reason (an internal `encodeURIComponent` on a lone surrogate) would be misreported as client error. The typed class names the contract at the boundary, matching the package's existing error-class conventions.
- **Keeping the broad fallback and mapping all rejections to 500** — the fallback-to-index-on-any-error path would still mask a broken dist as a successful SPA shell; the 400 branch would lose the legitimate malformed-% case.
- **Letting `client-modules`' decode fall through unclassified** — its malformed bundle URL would regress from 400 to 500; the classification contract is uniform across every decode site.

## Consequences

- A genuine SPA miss still renders `index.html` with 200; a broken static read now surfaces as 500 instead of a successful shell, and an internal handler failure as 500 instead of 400.
- `client-modules` gains a runtime import of the webserver package (`BadRequestError`), which moves the webserver from devDependencies to peerDependencies in that manifest; the composition always mounts both.
- Error responses stay body-less and the server survives every classified failure; the change adds no model-visible or durable behavior.
