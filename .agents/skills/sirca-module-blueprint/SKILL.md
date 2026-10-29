---
name: sirca-module-blueprint
description: Step-by-step runbook and checklist for creating or refactoring NestJS domain modules, TypeORM entities, migrations, DTOs, pure helpers, sub-services, segregated controllers, and Vitest tests in SIS-SIRCA. Activate whenever creating a new module, adding an entity/table, or decomposing a large service/controller in SIS-SIRCA.
---

# SIS-SIRCA Module & Refactoring Blueprint

Use this skill whenever adding a new domain module, creating a database table, or refactoring an existing module in **SIS-SIRCA** (`contracts`, `billing`, `eventualities`, `plans`, `persons`, `doctors`, `cie10`, etc.).

## 1. Pre-Flight Checklist

1. **Ubiquitous Language**: Check [`GLOSSARY.md`](../../../GLOSSARY.md) to ensure the module name, entity class, table name (`snake_case` plural), and enum values match the official domain vocabulary.
2. **Non-Negotiable Code Limits** ([`AGENTS.md`](../../../AGENTS.md)):
   - **Service (`*.service.ts`)**: $\le 200$ lines recommended (**300 lines hard limit**).
   - **Controller (`*.controller.ts`)**: $\le 150$ lines recommended (**250 lines hard limit**).
   - **Constructor dependencies**: $\le 4$ recommended (**5 hard limit**).
   - **Method length**: $\le 30$ lines recommended (**50 lines hard limit**).
   - **DTO (`*.dto.ts`)**: $\le 100$ lines recommended (**150 lines hard limit**).

---

## 2. Step-by-Step Implementation

### Step 1: Create or Update the Entity (`src/<feature>/entities/<singular>.entity.ts`)

- Define table and column names explicitly in `snake_case` (`name: 'snake_case_col'`).
- **Money / Financial amounts**: Always use `type: 'decimal', precision: 10, scale: 2` (or `12, 2`) with `transformer: decimalTransformer` (`src/common/transformers/decimal.transformer.ts`). Never use `float`.
- **Timestamps & Dates**: Use `type: 'timestamptz'` for events/timestamps; use `type: 'date'` with `dateColumnTransformer` only for calendar dates without time.
- **Explicit Foreign Key Indexes**: PostgreSQL does not auto-index foreign keys. Every `@ManyToOne` must have an explicit `@Index('IDX_<table>_<fk_column>')` and `foreignKeyConstraintName`.
- **Database Invariants**: Add `@Check('CHK_<table>_<rule>', '...')` for non-negative amounts (`>= 0`) and valid status enums.

```typescript
import {
  Check,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { decimalTransformer } from '../../common/transformers/decimal.transformer';

@Entity('medical_orders')
@Index('IDX_medical_orders_eventuality_id', ['eventuality'])
@Check('CHK_medical_orders_estimated_cost', '"estimated_cost" >= 0')
export class MedicalOrder {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne('Eventuality', { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'eventuality_id',
    foreignKeyConstraintName: 'FK_medical_orders_eventuality',
  })
  eventuality: Eventuality;

  @Column({ type: 'uuid', name: 'eventuality_id' })
  eventualityId: string;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 0,
    name: 'estimated_cost',
    transformer: decimalTransformer,
  })
  estimatedCost: number;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ type: 'timestamptz', name: 'deleted_at' })
  deletedAt?: Date | null;
}
```

### Step 2: Create the Database Migration (`src/database/migrations/<timestamp>-<Name>.ts`)

- Every schema change requires an explicit migration in `src/database/migrations/`.
- Include all `CREATE INDEX`, `CONSTRAINT FK_...`, and `CONSTRAINT CHK_...` statements in `up()`, and drop them cleanly in `down()`.

### Step 3: Create DTOs as Classes (`src/<feature>/dto/*.dto.ts`)

- **MUST** be `class` (never `interface` or `type`) so `emitDecoratorMetadata` and the global `ValidationPipe` (`whitelist: true`, `forbidNonWhitelisted: true`, `transform: true`) work at runtime.
- Declare payload properties as `readonly`.
- Decorate every property with `class-validator`, `@ApiProperty` / `@ApiPropertyOptional`, and sanitize string inputs with `@Transform` from `class-transformer`.
- Paginated query DTOs **MUST** extend `PaginationQueryDto` (`src/common/dto/pagination-query.dto.ts`).

```typescript
import { IsNotEmpty, IsNumber, IsString, IsUUID, Min } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class CreateMedicalOrderDto {
  @ApiProperty({ description: 'UUID de la eventualidad asociada' })
  @IsUUID()
  readonly eventualityId: string;

  @ApiProperty({ description: 'Descripción clínica de la orden' })
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  readonly description: string;

  @ApiProperty({ description: 'Costo estimado en USD', minimum: 0 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  readonly estimatedCost: number;
}
```

### Step 4: Extract Pure Domain Helpers (`src/<feature>/helpers/<feature>-calculator.helper.ts`)

- Keep financial formulas, baremo calculations, coverage deductions, and data transformations in pure functions 100% free of NestJS DI and TypeORM.
- Write unit tests in `<feature>-calculator.helper.spec.ts` following the [`tdd`](../tdd/SKILL.md) skill.

### Step 5: Create Focused Sub-Services & Facade (`src/<feature>/services/*.service.ts`)

- Organize services by responsibility (`<feature>-creation.service.ts`, `<feature>-state.service.ts`, `<feature>-query.service.ts`) and expose a lightweight `<feature>.service.ts` Facade if needed.
- **Transactions**: Use `@Transactional()` (`src/common/decorators/transactional.decorator.ts`) for multi-table writes.
- **Side Effects Outside Transactions**: Never call WhatsApp, AWS SES, AWS S3, or OCR inside an open DB transaction. Always wrap external side effects in `registerPostCommitHook(() => ...)` (`src/common/context/request-context.ts`).
- **Context Propagation**: Never use `@Inject(REQUEST)`. Read request metadata via `getContextSafe()`, `getContextUser()`, or `getRequestId()` from `src/common/context/request-context.ts`.
- **No DTO Spread**: Never spread DTO class instances (`...dto`). Assign entity fields explicitly.
- **Object Relations Syntax**: Prefer `relations: { person: true, coveragePeriod: true }` over `relations: ['person']`.
- **Typed Domain Exceptions**: Throw semantic exceptions from `src/common/exceptions/domain-exceptions.ts` (`EntityNotFoundException`, `EntityAlreadyExistsException`, `InvalidDomainOperationException`, `ExternalServiceException`).
- **Zero PHI in Logs**: Never use `console.log` and never log clinical diagnoses, medical report text, or full patient PII. Log only internal UUIDs (`eventualityId`, `contractId`, `personId`, `invoiceId`).

### Step 6: Create Segregated Controllers (`src/<feature>/controllers/*.controller.ts`)

- Keep controllers $\le 150$ lines. Split by sub-resource (`<feature>.controller.ts`, `<feature>-doctor.controller.ts`, `<feature>-billing.controller.ts`) while keeping `@Controller('<feature>')` to preserve Frontend API contracts.
- Always validate UUID route params with `@Param('id', ParseUUIDPipe) id: string`.
- Protect endpoints with `@RequirePermissions(...)`.

### Step 7: Mandatory Verification Suite

Before finishing any module or refactoring task, run:

```powershell
pnpm run audit:lines
pnpm run check-types
pnpm test
pnpm run build
```
