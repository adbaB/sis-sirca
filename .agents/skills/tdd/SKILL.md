---
name: tdd
description: Test-driven development for SIS-SIRCA. Use when building features, pure helpers, or sub-services test-first, when the user mentions "red-green-refactor" or "TDD", or when designing unit/integration tests in Vitest.
---

# Test-Driven Development (SIS-SIRCA)

TDD is the red → green loop. This skill is the reference that makes that loop produce tests worth keeping: what a good test is, where tests go, the anti-patterns, and the rules of the loop. Every section applies on every cycle: consult them before and during the loop, not after.

When exploring the codebase, read [`GLOSSARY.md`](../../../GLOSSARY.md) so test names, fixtures, and interface vocabulary match SIS-SIRCA's domain language (`Contract`, `ContractCoveragePeriod`, `Eventuality`, `Invoice`, `Payment`, `Surplus`), and respect the architecture standards in [`AGENTS.md`](../../../AGENTS.md).

## What a good test is

Tests verify behavior through public interfaces, not implementation details. Code can change entirely; tests shouldn't. A good test reads like a specification: `"approves emergency in PENDING_APPROVAL status and schedules post-commit WhatsApp notification"` tells you exactly what capability exists, and it survives internal refactors because it doesn't care about private methods.

See [tests.md](tests.md) for examples and [mocking.md](mocking.md) for mocking guidelines.

## Seams: where tests go

A **seam** is the public boundary you test at: the interface where you observe behavior without reaching inside. Tests live at seams, never against internals.

In **SIS-SIRCA**, the primary seams are:
1. **Pure Domain Helpers (`src/<feature>/helpers/*.helper.ts`)**: 100% free of NestJS DI and TypeORM. Tested with pure input/output assertions and zero mocks.
2. **Domain Sub-Services (`src/<feature>/services/<feature>-*.service.ts`)**: Tested through their public methods, mocking only external boundaries (repositories, S3, SES, Meta WhatsApp, OpenRouter) and verifying domain outcomes and exceptions (`EntityNotFoundException`, `InvalidDomainOperationException`).
3. **DTO Validation (`src/<feature>/dto/*.dto.ts`)**: Tested with `plainToInstance` + `validate` when custom transforms or complex regex/business rules apply.

**Test only at pre-agreed seams.** Before writing any test, identify the seams under test:
- What is the public interface?
- What domain invariant or edge case does each seam catch?

## Anti-patterns

- **Implementation-coupled**: mocks internal collaborators or private helper functions, tests private methods (`(service as any).privateMethod()`), or asserts on internal query builder call order rather than the observable result. The tell: the test breaks when you refactor but behavior hasn't changed.
- **Tautological**: the assertion recomputes the expected value the same way the production code does (`expect(calculateCoverage(item)).toBe(item.cost * item.rate)`), so it passes by construction and can never catch a formula bug. Expected values must come from an independent source of truth: a known-good literal (`expect(result.coveredAmount).toBe(120.5)`), a worked example from the spec, or [`GLOSSARY.md`](../../../GLOSSARY.md).
- **Horizontal slicing**: writing 20 tests first, then all implementation. Work in **vertical slices** instead: one failing test → minimal implementation to pass → repeat.

## Rules of the loop

- **Red before green.** Write the failing test in Vitest (`pnpm test`) first, then only enough code to pass it. Don't anticipate future tests or add speculative features.
- **One slice at a time.** One seam, one test, one minimal implementation per cycle.
- **Refactoring belongs to the review stage.** Keep files within the strict limits of [`AGENTS.md`](../../../AGENTS.md) ($\le 200$ lines recommended, $\le 300$ lines hard limit for services).
