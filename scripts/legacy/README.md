# Legacy test harnesses

These files are preserved only as historical evidence of earlier Vendeo architectures.

They are **not** part of the supported test surface and may reference contracts that no longer exist, including the removed experimental orchestrator, browser-side privileged RPC mocks, or pre-persistent-session assumptions.

Canonical validation is now:

- `npm test`
- `npm run test:architecture`
- `npm run prompt:check`
- `npx tsc --noEmit`
- `npm run build`

Do not change production code to satisfy a legacy harness. If an old scenario is still valuable, port the invariant into `tests/` or a current architecture test first.
