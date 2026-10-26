# Plan de Implementación: Extractor y Catálogo Enriquecido CIE-10 (Volumen 1 OPS)

**Especificación:** [docs/superpowers/specs/2026-10-26-cie10-rich-parser-design.md](file:///c:/Users/User/Proyectos/sirca/sis-sirca/docs/superpowers/specs/2026-10-26-cie10-rich-parser-design.md)  
**Fecha:** 2026-10-26  
**Rama:** `eventuality-emergency`

---

## Tareas

### Fase 1: Entorno y Dependencias
- [x] **1.1**: Instalar `pdf-parse` y `@types/pdf-parse` (o `pdfjs-dist`) en las dependencias de desarrollo con `pnpm add -D pdf-parse @types/pdf-parse`.

### Fase 2: Desarrollo del Script de Extracción
- [x] **2.1**: Crear `script/parse-cie10-volume1.ts` con:
  - Función de descarga segura por streaming de `https://ais.paho.org/classifications/chapters/pdf/volume1.pdf` a `script/data/volume1.pdf` (con verificación de existencia/tamaño local).
  - Extractor de texto por bloques/páginas para no saturar memoria.
  - Autómata de estados finitos que identifique:
    - Capítulos (I al XXI) y sus rangos
    - Bloques de categorías
    - Categorías de 3 caracteres y determinación de `isTerminal`
    - Subcategorías de 4 caracteres
    - Inclusiones (`Incluye:`)
    - Exclusiones (`Excluye:`) con extracción de códigos de referencia
    - Notas y marcas de daga/asterisco (`†`, `*`).
  - Escritura del resultado en `src/cie10/data/cie10-rich.json`.
  - Reporte de validación estadística en consola.
- [x] **2.2**: Agregar script de ejecución en `package.json`: `"cie10:extract": "ts-node -T script/parse-cie10-volume1.ts"`.

### Fase 3: Ejecución de la Extracción y Validación del JSON
- [x] **3.1**: Ejecutar la descarga y extracción del PDF.
- [x] **3.2**: Verificar la integridad y estructura del archivo `src/cie10/data/cie10-rich.json`.

### Fase 4: Modelo de Datos y Migración TypeORM
- [x] **4.1**: Actualizar la entidad `Cie10Code` (`src/cie10/entities/cie10-code.entity.ts`) con las nuevas propiedades: `cleanCode`, `block`, `category`, `level`, `isTerminal`, `metadata`.
- [x] **4.2**: Crear la migración `src/database/migrations/1792700000001-AddRichFieldsToCie10Codes.ts` para agregar las columnas e índices correspondientes en PostgreSQL.

### Fase 5: Actualización de `Cie10Service` y `Cie10Controller`
- [x] **5.1**: Actualizar `ensurePreloaded()` en `Cie10Service` para cargar los nuevos atributos relacionales y el campo `metadata` en lotes eficientes.
- [x] **5.2**: Actualizar `search()` en `Cie10Service` para filtrar por defecto por `isTerminal = true`, y buscar por código, descripción y sinónimos en `metadata->'inclusions'`.
- [x] **5.3**: Actualizar `Cie10Controller` para admitir el parámetro opcional `onlyTerminal`.

### Fase 6: Pruebas y Verificación
- [x] **6.1**: Ejecutar pruebas unitarias de `cie10.service.spec.ts`.
- [x] **6.2**: Verificar compatibilidad con los módulos dependientes (`eventualities`).
- [x] **6.3**: Verificar build con `pnpm build` o `pnpm test`.
