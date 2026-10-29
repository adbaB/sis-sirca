# When to Mock in SIS-SIRCA

Mock at **system boundaries** only:

- **Database Repositories** (`Repository<Entity>`) in unit tests of sub-services
- **External APIs**:
  - Meta WhatsApp Cloud API (`MetaWhatsappService`)
  - AWS S3 (`AwsService` / S3 client)
  - AWS SES (`EmailService`)
  - OpenRouter / OCR engines (`OcrService`)
  - Google Sheets / Google Drive APIs
- **Time / Randomness** (when deterministic dates or UUIDs are required)
- **Request Context (`request-context.ts`)**: Use [`test-context.helper.ts`](../../../src/common/context/test-context.helper.ts) when testing `@Transactional()` or `registerPostCommitHook()`.

Don't mock:

- **Pure domain helpers** (`src/<feature>/helpers/*.helper.ts`) — let the service call the real pure function!
- **DTOs, Value Objects, or Transformers** (`decimalTransformer`, `dateColumnTransformer`)
- **Domain Exceptions** (`EntityNotFoundException`, `InvalidDomainOperationException`)

## Designing for Mockability

1. **Extract Pure Calculations First**:
   Instead of embedding 40 lines of math inside a service method that also queries TypeORM and calls S3, extract the calculation to `src/<feature>/helpers/<feature>-calculator.helper.ts`.
   - The helper test needs **zero mocks**.
   - The service test only verifies orchestration and state transitions.

2. **Respect Constructor Dependency Limits ($\le 4$ recommended, $\le 5$ max)**:
   If a service test requires setting up 8 mocks in `beforeEach`, the service violates Single Responsibility Principle (SRP) and [`AGENTS.md`](../../../AGENTS.md). Split the service by domain capability (`*-creation.service.ts`, `*-state.service.ts`, `*-query.service.ts`).
