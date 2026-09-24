# Especificación Técnica de Diseño: Corrección de Duplicidad de Titular de Factura (`isBillingOwner`)

## 1. Contexto y Problema

En producción, al cambiar el titular de la factura o al agregar un beneficiario marcándolo como responsable de cobro, el sistema deja múltiples personas asociadas a un contrato con `isBillingOwner = true`. Esto viola la regla de negocio de **un único titular de factura por contrato**.

### Causa Raíz
1. **Fallo en consulta de actualización en `setBillingOwner`:**
   En `src/contracts/services/contract-affiliation.service.ts`:
   ```typescript
   await manager.update(
     ContractPerson,
     { contract: { id: contractId }, deletedAt: IsNull() },
     { isBillingOwner: false },
   );
   ```
   En TypeORM, pasar un objeto de relación anidada `{ contract: { id: contractId } }` dentro de `criteria` de `repository.update()` no garantiza la resolución correcta del WHERE sobre la clave foránea nativa `contract_id` en PostgreSQL, lo cual causaba que los titulares de factura anteriores no fueran desmarcados a nivel de base de datos.
2. **Omisión en `addBeneficiary`:**
   Al crear un nuevo `ContractPerson` con `isBillingOwner: true` a través del modal de beneficiarios, el método `addBeneficiary` no desmarcaba al responsable de facturación existente en el contrato.
3. **Ausencia de restricción en base de datos:**
   No existía un índice único o restricción a nivel de PostgreSQL que impidiera la coexistencia de dos o más filas con `is_billing_owner = true` y `deleted_at IS NULL` para un mismo `contract_id`.

---

## 2. Solución Propuesta (Defensa en Profundidad)

### 2.1. Base de Datos & Migración
- **Comando:** Generada con `pnpm run migrations:create src/database/migrations/EnforceSingleBillingOwnerPerContract`.
- **Saneamiento de datos históricos:**
  Limpiar contratos que actualmente tengan múltiples registros activos con `is_billing_owner = true`, conservando únicamente el más recientemente actualizado y pasando los anteriores a `false`.
  ```sql
  WITH ranked_billing_owners AS (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY contract_id 
             ORDER BY updated_at DESC, created_at DESC
           ) as rn
    FROM contract_persons
    WHERE is_billing_owner = true 
      AND deleted_at IS NULL
  )
  UPDATE contract_persons
  SET is_billing_owner = false
  WHERE id IN (
    SELECT id FROM ranked_billing_owners WHERE rn > 1
  );
  ```
- **Índice Único Parcial:**
  ```sql
  CREATE UNIQUE INDEX IF NOT EXISTS "UQ_contract_person_billing_owner"
  ON "contract_persons" ("contract_id")
  WHERE "is_billing_owner" = true AND "deleted_at" IS NULL;
  ```
- **Reversión (Down):**
  ```sql
  DROP INDEX IF EXISTS "public"."UQ_contract_person_billing_owner";
  ```
- **Entidad `ContractPerson` (`contract-person.entity.ts`):**
  Añadir el decorador:
  ```typescript
  @Index('UQ_contract_person_billing_owner', ['contract'], {
    unique: true,
    where: '"is_billing_owner" = true AND "deleted_at" IS NULL',
  })
  ```

---

### 2.2. Backend (`contract-affiliation.service.ts`)

#### 1. En `setBillingOwner`:
1. Bloquear y verificar al `target` en el contrato.
2. Desmarcar explícitamente a todos los responsables de facturación activos actuales del contrato:
   - En memoria mediante `manager.find` y `manager.save` para actualizar entidades cacheadas.
   - Mediante `QueryBuilder.update(ContractPerson)` directo sobre la columna SQL `contract_id = :contractId` y `id != :targetId` para asegurar ejecución atómica en base de datos.
3. Marcar `target.isBillingOwner = true` y guardar con `manager.save(ContractPerson, target)`.

#### 2. En `addBeneficiary`:
- Si el DTO entrante especifica `isBillingOwner: true`:
  - Desmarcar previamente a cualquier responsable de facturación existente en el contrato antes de crear y guardar el nuevo `ContractPerson`.

#### 3. Pruebas Unitarias:
- Actualizar `contract-affiliation.service.spec.ts` para verificar que:
  - `setBillingOwner` desmarca a los otros responsables y asigna al nuevo.
  - `addBeneficiary` con `isBillingOwner: true` desmarca al titular previo.

---

### 2.3. Frontend (`sirca-front-app`)

1. **[`BeneficiaryFormModal.tsx`](file:///C:/Users/User/Proyectos/sirca/sirca-front-app/components/dashboard/contracts/BeneficiaryFormModal.tsx):**
   - Actualizar el label o descripción del checkbox `isBillingOwner` a:
     *"Responsable del cobro y facturas (reemplazará al titular de factura actual)"*.
2. **[`ContractDetails.tsx`](file:///C:/Users/User/Proyectos/sirca/sirca-front-app/components/dashboard/contracts/ContractDetails.tsx):**
   - Verificar que `handleSetBillingOwner` mantenga el estado de carga y refresque de inmediato (`fetchContract`) la lista para reflejar el cambio del badge sin duplicados visuales.

---

## 3. Plan de Verificación y Pruebas
1. Ejecutar suites de pruebas unitarias backend con `pnpm vitest run src/contracts/tests/contract-affiliation.service.spec.ts`.
2. Verificar compilación y tipos con `pnpm run check-types` o `pnpm build`.
3. Verificar la migración de saneamiento e índice en la base de datos.
