# Good and Bad Tests in SIS-SIRCA

## Good Tests

**Behavior-focused at the Public Seam**: Test through public methods of pure helpers or domain sub-services, asserting on observable outputs and domain exceptions.

```typescript
// GOOD: Tests observable domain behavior on a pure helper with independent literals
it('calculates remaining coverage deducting consumed and reserved amounts', () => {
  const result = calculateCoverageSummary({
    initialCoverage: 1000,
    consumedCoverage: 250.25,
    reservedCoverage: 100.75,
  });

  expect(result.remainingCoverage).toBe(649);
});
```

Characteristics:
- Tests behavior callers and business rules care about
- Uses public API only
- Survives internal refactors
- Describes WHAT business invariant holds, not HOW it is computed
- Uses concrete expected literals

## Bad Tests

**Implementation-detail tests**: Coupled to internal structure or private methods.

```typescript
// BAD: Reaches into private methods and asserts internal call counts
it('calls private helper validateBalance when approving payment', async () => {
  const spy = vi.spyOn(paymentService as any, 'validateBalance');
  await paymentService.approvePayment(paymentId);
  expect(spy).toHaveBeenCalledTimes(1);
});
```

Red flags:
- Using `as any` to spy on or invoke private methods
- Mocking pure domain helpers when testing a service
- Test breaks when extracting a private method into a pure helper without changing behavior
- Test name describes HOW (`calls repo.findOne then repo.save`) instead of WHAT (`rejects emergency approval when status is not PENDING_APPROVAL`)

**Tautological tests**: Expected value restates the implementation formula, so the test passes by construction.

```typescript
// BAD: Expected value recomputes the exact formula under test
it('converts USD amount to Bs using exchange rate', () => {
  const amountUsd = 50;
  const rate = 36.5;
  const expected = Number((amountUsd * rate).toFixed(2));
  expect(convertUsdToBs(amountUsd, rate)).toBe(expected);
});

// GOOD: Expected value is an independent, known literal
it('converts USD amount to Bs using exchange rate', () => {
  expect(convertUsdToBs(50, 36.5)).toBe(1825);
});
```
