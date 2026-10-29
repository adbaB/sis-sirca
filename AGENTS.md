# Estándares de Arquitectura, Flujo de Trabajo y Gobernanza de Desarrollo (SIS-SIRCA)

> **REGLA DE ORO:** Ningún agente o desarrollador tiene permitido crear ni ampliar "God Classes" (servicios >300 líneas o controladores >250 líneas), ni escribir código de nuevas funcionalidades o refactorizaciones sin pasar primero por el flujo Spec-Driven (`/brainstorming` + `/grill-me`).

---

## 1. Flujo de Trabajo Obligatorio para Todo Cambio (Spec-Driven Lifecycle)

Cada nueva funcionalidad, cambio arquitectónico o refactorización debe cumplir estrictamente estas **5 etapas en orden** (solo hotfixes triviales `<30 líneas` están exentos de los pasos 1 a 3):

1. **Descubrimiento y Entrevista (`/brainstorming` + `/grill-me`)**:
   - Explorar primero el contexto del repositorio (`src/common`, módulos afectados, specs previos) y consultar obligatoriamente el **[Glosario de Dominio (`GLOSSARY.md`)](GLOSSARY.md)** para respetar el lenguaje ubicuo (español ↔ entidades/tablas/enums).
   - Entrevistar al usuario **una pregunta a la vez** (`ask_question`) recorriendo el árbol de decisiones y proponiendo siempre una opción `(Recommended)` fundamentada.
   - **HARD GATE**: Prohibido escribir o modificar código de producción antes de que el diseño esté aprobado.
2. **Especificación Formal (`docs/superpowers/specs/YYYY-MM-DD-<tema>-design.md`)**:
   - Documentar objetivos, diagrama de arquitectura Mermaid, descomposición de componentes (Controladores, Sub-servicios, Helpers puros, DTOs, Entidades/Migraciones), manejo de errores y estrategia de pruebas.
   - Realizar auto-revisión del spec (cero placeholders, cero contradicciones) y solicitar aprobación del usuario.
3. **Plan de Implementación (`docs/superpowers/plans/YYYY-MM-DD-<tema>-plan.md`)**:
   - Dividir el trabajo en fases atómicas, verificables y sin tiempo de inactividad (usando el patrón *Strangler Fig / Facade* cuando se refactorice código heredado).
4. **Implementación Guiada por Reglas de Dominio (`/sirca-module-blueprint` + `/tdd`)**:
   - Seguir el runbook paso a paso de `.agents/skills/sirca-module-blueprint/SKILL.md` y el ciclo *Red → Green* por *seams* de `.agents/skills/tdd/SKILL.md`.
   - Aplicar rigurosamente los estándares de los pilares técnicos detallados en las secciones 2 a 8 de este documento.
5. **Auditoría de Calidad (`/code-review-excellence`)**:
   - Ejecutar `npm run audit:lines`, `npm run check-types`, `npm run test` y verificar el checklist de revisión antes de dar por completada la tarea.

---

## 2. Métricas y Límites Estrictos de Código (Non-Negotiable)

| Elemento | Límite Recomendado | Límite Duro (Alerta Roja) | Acción Obligatoria si se Excede |
| :--- | :--- | :--- | :--- |
| **Servicio (`*.service.ts`)** | ≤ 200 líneas | **300 líneas** | Dividir en sub-servicios de dominio especializados + Fachada |
| **Controlador (`*.controller.ts`)** | ≤ 150 líneas | **250 líneas** | Segregar en múltiples controladores por sub-recurso manteniendo el prefijo de ruta |
| **Inyecciones en Constructor** | ≤ 4 dependencias | **5 dependencias** | Extraer lógica a sub-servicios o helpers puros sin estado |
| **Método o Función** | ≤ 30 líneas | **50 líneas** | Extraer sub-rutinas privadas o funciones puras en `helpers/` o `utils/` |
| **DTO (`*.dto.ts`)** | ≤ 100 líneas | **150 líneas** | Separar en archivos individuales por caso de uso (`create-*`, `update-*`, `find-*`) |
| **Entidad (`*.entity.ts`)** | ≤ 150 líneas | **250 líneas** | Extraer entidades hijas o configuraciones |

---

## 3. Arquitectura y Buenas Prácticas NestJS (`/architecture-patterns` & `/nestjs-best-practices`)

### 3.1. Estructura Estándar de Módulos (`src/<feature>/`)
```text
src/<feature>/
├── controllers/
│   ├── <feature>.controller.ts                  # CRUD y flujo principal (<= 200 líneas)
│   ├── <feature>-<subresource>.controller.ts    # Sub-recursos (mismo @Controller('<feature>') para preservar URLs)
├── services/
│   ├── <feature>.service.ts                     # Fachada (Facade) ligera de delegación (~60-100 líneas)
│   ├── <feature>-creation.service.ts            # Creación y validaciones de admisión
│   ├── <feature>-state.service.ts               # Transiciones de estado (approve, reject, finalize)
│   ├── <feature>-query.service.ts               # Consultas complejas, filtros y paginación
├── dto/
│   ├── create-<feature>.dto.ts
│   ├── find-<feature>.dto.ts                    # Extiende de PaginationQueryDto
├── entities/
│   └── <feature>.entity.ts
├── helpers/ (o utils/)
│   ├── <feature>-calculator.helper.ts           # Funciones puras 100% libres de TypeORM/NestJS DI
│   └── <feature>-calculator.helper.spec.ts      # Tests unitarios puros sin mocks pesados
├── interfaces/
│   └── <feature>.interface.ts
└── <feature>.module.ts
```

### 3.2. Transacciones, Contexto ALS y Efectos Secundarios (`src/common`)
- **Prohibido el Scope REQUEST (`@Inject(REQUEST)`)**: **NUNCA** inyectar `@Inject(REQUEST)` en servicios de negocio (destruye el rendimiento de NestJS al volver *request-scoped* todo el subárbol de inyección). Para obtener metadatos de la petición actual, usar siempre `getContextSafe()`, `getContextUser()` o `getRequestId()` respaldados por `AsyncLocalStorage` (`src/common/context/request-context.ts`).
- **Prohibido usar `this.dataSource.transaction()` manual en nuevos servicios** salvo casos de bloqueo pesimista explícito que requieran control manual del `EntityManager`.
- **Uso obligatorio de `@Transactional()`** (`src/common/decorators/transactional.decorator.ts`) apoyado en `AsyncLocalStorage` (`request-context.ts`).
- **Efectos secundarios fuera de la transacción**: Llamadas a APIs externas (WhatsApp, correos SES, colas OCR en segundo plano) **nunca** deben ejecutarse dentro de una transacción abierta de base de datos. Usar `registerPostCommitHook(() => ...)` (`src/common/context/request-context.ts`) o emitir eventos con `@nestjs/event-emitter` una vez confirmada la transacción.

---

## 4. Manejo de Errores Resiliente y Privacidad Clínica Cero-PHI (`/error-handling-patterns`)

- **Excepciones de Dominio Tipadas**: En la capa de servicios y dominio, preferir las excepciones semánticas de `src/common/exceptions/domain-exceptions.ts` (`EntityNotFoundException`, `EntityAlreadyExistsException`, `InvalidDomainOperationException`, `ExternalServiceException`, `UnauthorizedDomainException`) catalogadas en `ErrorCode` (`src/common/exceptions/error-codes.enum.ts`).
- **GlobalExceptionFilter**: Dejar que `GlobalExceptionFilter` y `TypeOrmExceptionFilter` traduzcan las excepciones de dominio y de base de datos a respuestas HTTP estandarizadas.
- **Prohibido silenciar errores**: Ningún bloque `catch` puede estar vacío. Si falla un servicio externo, envolver en `ExternalServiceException` preservando `originalError` y el stack trace.
- **Cero PHI / PII en Logs**:
  - **NUNCA** usar `console.log` en código productivo ni volcar `req.body` completo en logs.
  - **NUNCA** registrar en logs diagnósticos médicos (CIE-10), hallazgos de informes médicos, declaraciones de salud ni cédulas/nombres completos junto a datos clínicos. Registrar únicamente identificadores internos (`eventualityId`, `contractId`, `personId`, `invoiceId`, `requestId`).

---

## 5. Diseño de APIs REST y DTOs (`/api-design-principles`)

- **Preservación de Contratos**: Al dividir un controlador grande en varios controladores especializados (ej. `EventualityDoctorController`, `EventualityDocumentController`), mantener el decorador `@Controller('eventualities')` y las rutas exactas para no romper el cliente Frontend.
- **DTOs como Clases y Sanitización**:
  - **NUNCA** declarar DTOs como `interface` o `type` cuando se usen con `@Body()`, `@Query()` o `@Param()`. Deben ser siempre `class` para que TypeScript emita los metadatos en tiempo de ejecución (`emitDecoratorMetadata`) requeridos por `ValidationPipe`.
  - Sanitizar cadenas de entrada con `@Transform(({ value }) => typeof value === 'string' ? value.trim() : value)` de `class-transformer`.
- **Pipes de Validación Obligatorios**:
  - Todo parámetro `:id` UUID en ruta debe llevar `@Param('id', ParseUUIDPipe) id: string`.
  - Toda consulta paginada debe usar un DTO que extienda `PaginationQueryDto` (`src/common/dto/pagination-query.dto.ts`). Prohibido parsear `@Query('page')` manualmente con `parseInt` en el controlador.
- **Semántica HTTP y Serialización**:
  - Usar verbos y códigos HTTP semánticos (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`).
  - Documentar cada endpoint y DTO con decoradores `@ApiProperty` / `@ApiPropertyOptional` de Swagger.

---

## 6. Tipado Avanzado en TypeScript (`/typescript-advanced-types`)

- **Tolerancia Cero a `any`**: Prohibido usar `any`. Utilizar `unknown` con *type guards*, tipos genéricos con restricciones (`<T extends ...>`), o tipos utilitarios (`Pick`, `Omit`, `Partial`, `Readonly`, `Record`).
- **Inmutabilidad en Contratos**: Propiedades de DTOs, eventos e interfaces de respuesta deben declararse con `readonly` cuando representen payloads de entrada/salida.
- **Prohibido el Spread de Instancias de Clases (`no-misused-spread`)**: **NUNCA** usar el operador spread sobre instancias de DTOs (`...dto`) al construir o actualizar entidades TypeORM, ya que copia metadatos/prototipos no deseados y oculta el mapeo de campos. Asignar cada propiedad explícitamente.
- **Uniones Discriminadas**: Para resultados complejos o estados con metadatos variables, usar *Discriminated Unions* (ej. `{ status: 'EXTRACTED'; data: ExtractedData } | { status: 'FAILED'; error: string }`) en lugar de objetos con campos opcionales ambiguos.

---

## 7. Diseño de Tablas y Consultas PostgreSQL (`/postgresql-table-design`)

- **Convenciones de Nombres**: Identificadores de tablas y columnas siempre en `snake_case` (definir `name: 'snake_case_col'` en `@Column` y `@JoinColumn`) y alineados con [`GLOSSARY.md`](GLOSSARY.md).
- **Sintaxis de Relaciones en TypeORM**: En nuevos servicios o refactorizaciones, preferir la sintaxis de objeto (`relations: { person: true, coveragePeriod: true }`) en lugar de arrays de strings (`relations: ['person']`).
- **Tipos de Datos**:
  - Dinero y montos financieros: **Siempre `NUMERIC(12, 2)`** (o precisión requerida) junto con `transformer: decimalTransformer` (`src/common/transformers/decimal.transformer.ts`). Prohibido usar `float` o `double` para dinero.
  - Fechas y horas de eventos: **Siempre `TIMESTAMPTZ`** (`type: 'timestamptz'`). Usar `DATE` solo para fechas de calendario sin hora.
  - Textos: Preferir `TEXT` o `VARCHAR` con límites justificados.
- **Integridad e Índices**:
  - PostgreSQL **no indexa claves foráneas automáticamente**: toda columna `@ManyToOne` / FK debe tener su `@Index('IDX_tabla_columna_id')` explícito y su `foreignKeyConstraintName`.
  - Definir `@Check(...)` constraints en la entidad y migración para estados válidos y montos no negativos (`>= 0`).
  - Todo cambio de esquema requiere su migración explícita en `src/database/migrations/`.

---

## 8. Excelencia en Revisión de Código (`/code-review-excellence`)

Antes de dar por finalizada cualquier tarea o PR, el agente o desarrollador debe ejecutar la autoevaluación de revisión:
- 🔴 **[Blocking]**: ¿Algún archivo creado o editado supera las 300 líneas? (`npm run audit:lines`)
- 🔴 **[Blocking]**: ¿Algún servicio tiene más de 5 dependencias en el constructor o usa `@Inject(REQUEST)`?
- 🔴 **[Blocking]**: ¿Hay operaciones multi-tabla sin `@Transactional()` o efectos secundarios (WhatsApp/S3/OCR) ejecutándose dentro de la transacción de BD?
- 🔴 **[Blocking]**: ¿Existen tipos `any`, spread de DTOs (`...dto`), parámetros UUID sin `ParseUUIDPipe`, queries N+1 o fuga de PHI/diagnósticos en logs?
- 🟡 **[Important]**: ¿Se extrajo la lógica matemática/transformación a helpers puros con su respectivo `.spec.ts` siguiendo [`/tdd`](.agents/skills/tdd/SKILL.md)?
- 🟢 **[Verification]**: ¿Pasan `npm run check-types`, `npm run test` y `npm run build` sin errores?
