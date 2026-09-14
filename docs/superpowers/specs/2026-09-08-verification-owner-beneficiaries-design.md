# Especificación Técnica de Diseño: Búsqueda y Verificación de Beneficiarios por Titular o Pagador (isBillingOwner)

**Fecha:** 2026-09-08  
**Autor:** Antigravity / Alberto Basabe  
**Estado:** Aprobado para Planificación  

---

## 1. Resumen y Contexto

En el sistema de salud SIRCA, las personas pueden estar vinculadas a contratos en distintos roles:
- **AFILIADO:** Persona que disfruta de la cobertura del plan médico (beneficiario).
- **TITULAR:** Persona que suscribe y asume la responsabilidad del contrato.
- **PAGADOR (`isBillingOwner = true`):** Persona o entidad jurídica (RIF) responsable de la facturación y pago del contrato, quien puede o no ser el mismo titular.

Anteriormente, la búsqueda por documento en `ContractVerificationService` (`verifyPersonAffiliation` y `verifyUnified`) únicamente devolvía una lista plana de contratos (`contracts`) donde la persona era afiliada o titular, sin proporcionar los beneficiarios a su cargo en los contratos donde actúa como titular o pagador.

Esta especificación rediseña la respuesta de verificación por documento de identidad (Cédula o RIF) para entregar al frontend dos listas claras, desacopladas y no redundantes:
1. **`beneficiaryContracts` (Lista 1):** Contratos donde la persona consultada disfruta del plan médico como beneficiaria.
2. **`ownerContracts` (Lista 2):** Contratos donde la persona consultada es titular o pagadora (`isBillingOwner = true`), incluyendo en cada contrato el listado detallado de todos sus beneficiarios afiliados (`beneficiaries`), su elegibilidad médica (`isEligible`) y el total de afiliados.

Dado que el frontend será adaptado completamente, se elimina deuda técnica y campos obsoletos/retrocompatibles.

---

## 2. Definición de Tipos e Interfaces TypeScript

Ubicación: `src/contracts/interfaces/person-verification.interface.ts`

```typescript
import { PersonStatus, TypeIdentityCard } from '../../persons/entities/person.entity';
import { Parentesco } from '../entities/contract-person.entity';
import { ContractStatus } from '../entities/contract.entity';

export enum VerificationMode {
  BY_CONTRACT = 'BY_CONTRACT',
  BY_PERSON = 'BY_PERSON',
}

/**
 * Detalle de un beneficiario asociado a un contrato.
 */
export interface ContractBeneficiaryItem {
  contractPersonId: string;
  personId: string;
  name: string;
  typeIdentityCard: TypeIdentityCard;
  identityCard: string;
  birthDate?: Date;
  phone?: string;
  relationship?: Parentesco;
  planName: string | null;
  personStatus: PersonStatus;
  isEligible: boolean;
}

/**
 * Contrato donde la persona consultada figura como beneficiaria directa (Lista 1).
 */
export interface BeneficiaryContractItem {
  id: string;
  code: string;
  status: ContractStatus;
  isSuspended: boolean;
  isEligible: boolean;
  affiliationDate: Date;
  planName: string | null;
}

/**
 * Contrato donde la persona consultada es Titular o Pagadora (isBillingOwner),
 * con su lista anidada de beneficiarios afiliados (Lista 2).
 */
export interface OwnerContractItem {
  id: string;
  code: string;
  status: ContractStatus;
  isSuspended: boolean;
  affiliationDate: Date;
  cutoffDay: number;
  isTitular: boolean;
  isBillingOwner: boolean;
  titular: {
    id: string;
    name: string;
    typeIdentityCard: TypeIdentityCard;
    identityCard: string;
    phone?: string;
  } | null;
  beneficiaries: ContractBeneficiaryItem[];
  totalBeneficiaries: number;
}

/**
 * Resultado de verificación cuando se busca por Cédula o RIF.
 */
export interface PersonVerificationResult {
  mode: VerificationMode.BY_PERSON;
  person: {
    id: string;
    name: string;
    typeIdentityCard: TypeIdentityCard;
    identityCard: string;
    phone?: string;
    birthDate?: Date;
    status: PersonStatus;
  };
  beneficiaryContracts: BeneficiaryContractItem[];
  ownerContracts: OwnerContractItem[];
}

/**
 * Resultado de verificación cuando se busca directamente por código de contrato.
 */
export interface ContractVerificationResult {
  mode: VerificationMode.BY_CONTRACT;
  contract: {
    id: string;
    code: string;
    status: ContractStatus;
    isSuspended: boolean;
    affiliationDate: Date;
    cutoffDay: number;
    titular: {
      id: string;
      name: string;
      typeIdentityCard: TypeIdentityCard;
      identityCard: string;
      phone?: string;
    } | null;
  };
  beneficiaries: ContractBeneficiaryItem[];
  totalBeneficiaries: number;
}

export type UnifiedVerificationResult = ContractVerificationResult | PersonVerificationResult;
```

---

## 3. Arquitectura y Lógica de Consulta en `ContractVerificationService`

Ubicación: `src/contracts/services/contract-verification.service.ts`

### 3.1 Búsqueda por Documento (`verifyPersonAffiliation`)
1. **Búsqueda de la Persona:**
   - Se consulta a través de `personsService.findByIdentityCard(cleanNumber, typeIdentityCard)`.
   - Si no existe, lanza `NotFoundException`.
2. **Población de Lista 1 (`beneficiaryContracts`):**
   - Se consultan afiliaciones en `contractPersonsRepository` con `where: { person: { id: person.id }, role: PersonRole.AFILIADO }`.
   - Se deducen contratos duplicados.
   - Cada contrato calcula `isEligible = contract.status === ACTIVE && person.status === ACTIVE`.
   - Se ordenan por prioridad de estado (`ACTIVE` -> `SUSPENDED` -> `INACTIVE`) y fecha más reciente.
3. **Población de Lista 2 (`ownerContracts`):**
   - Se consultan afiliaciones en `contractPersonsRepository` con `where: [{ person: { id: person.id }, role: PersonRole.TITULAR }, { person: { id: person.id }, isBillingOwner: true }]`.
   - Se extraen los `contract.id` únicos registrando los roles observados (`isTitular`, `isBillingOwner`).
   - **Prevención de N+1:** Se ejecuta una sola consulta `contractsRepository.find({ where: { id: In(contractIds) }, relations: ['contractPersons', 'contractPersons.person', 'contractPersons.plan', 'contractPersons.person.plan'] })`.
   - Para cada contrato:
     - Se extrae el titular responsable (`role === TITULAR || isBillingOwner === true`).
     - Se filtran los beneficiarios (`role === AFILIADO`) y se mapean a `ContractBeneficiaryItem` evaluando `isEligible`.
     - Se crea el `OwnerContractItem`.
   - Se ordenan los contratos con la misma prioridad de estados (`ACTIVE` -> `SUSPENDED` -> `INACTIVE`).
4. **Retorno:**
   - Devuelve `PersonVerificationResult` con `mode: VerificationMode.BY_PERSON`, `person`, `beneficiaryContracts` y `ownerContracts`.

### 3.2 Búsqueda Unificada (`verifyUnified`)
- Si el texto corresponde a un código de contrato, delega a `verifyContractByCode(code)`.
- Si el texto corresponde a un documento de identidad (o coincide con candidatos en la base de datos):
  - Al evaluar candidatos, se comprueba si el candidato tiene afiliaciones en cualquiera de las 2 listas:
    `if (res.beneficiaryContracts.length > 0 || res.ownerContracts.length > 0) return res;`
  - Esto garantiza que pagadores corporativos (RIF J-...) o titulares que no son beneficiarios directos sean devueltos con sus contratos.

---

## 4. Pruebas y Validación

1. **Pruebas Unitarias en `contract-verification.service.spec.ts`:**
   - Persona que solo es beneficiaria.
   - Persona que solo es titular de contratos.
   - Persona que solo es `isBillingOwner` (ej. empresa / RIF).
   - Persona mixta (beneficiaria en un contrato y titular/pagadora en otro).
   - Titular con múltiples contratos (verificar sin duplicados y carga completa de beneficiarios).
   - Validación de ordenamiento y cálculo de `isEligible`.
2. **Pruebas en `contracts.controller.spec.ts`:**
   - Adaptar las aserciones a la nueva estructura `PersonVerificationResult`.
3. **Suite Completa:**
   - Ejecutar `npm test` verificando que toda la suite del proyecto compile y pase en verde.
