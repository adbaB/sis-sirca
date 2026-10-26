# Especificación de Diseño: Extractor y Catálogo Enriquecido CIE-10 (Volumen 1 OPS)

**Fecha:** 2026-10-26  
**Módulo:** CIE-10 (`src/cie10`)  
**Estado:** Aprobado  
**Documento Fuente:** CIE-10 Volumen 1 de la Organización Panamericana de la Salud (OPS/OMS): [volume1.pdf](https://ais.paho.org/classifications/chapters/pdf/volume1.pdf)

---

## 1. Visión General y Objetivos

Actualmente, el sistema SIRCA (`sis-sirca`) cuenta con un catálogo CIE-10 básico (`cie10-es.json`) compuesto únicamente por `code`, `description` y `chapter`. Esta estructura no incluye la rica jerarquía diagnóstica ni las anotaciones clínicas del documento oficial de la OPS (inclusiones/sinónimos, exclusiones con códigos de referencia, notas aclaratorias y signos de causalidad/manifestación como dagas † y asteriscos *).

El objetivo de este proyecto es:
1. Implementar un pipeline de extracción reproducible en TypeScript/Node.js que descargue y procese el PDF del Volumen 1 de la OPS (30.3 MB).
2. Generar un archivo de datos estructurado y enriquecido: `src/cie10/data/cie10-rich.json`.
3. Extender la entidad TypeORM `Cie10Code` y la base de datos PostgreSQL para almacenar estos metadatos taxonómicos y clínicos.
4. Mejorar el motor de búsqueda en `Cie10Service` para permitir búsquedas inteligentes por código, descripción y sinónimos (inclusiones), restringiendo por defecto los diagnósticos clínicos a códigos terminales (`isTerminal = true`) y preservando retrocompatibilidad total con las consultas de APS y eventualidades (`eventualities`).

---

## 2. Modelo de Datos y Esquemas

### 2.1. Interfaz de Datos JSON (`Cie10RichItem`)

```typescript
export interface Cie10Exclusion {
  term: string;
  targetCode?: string;
}

export interface Cie10Metadata {
  inclusions?: string[];
  exclusions?: Cie10Exclusion[];
  notes?: string[];
  daggerAsterisk?: 'dagger' | 'asterisk' | null;
}

export interface Cie10RichItem {
  code: string;                      // Ej: "A00.0", "A00", "A00-A09", "I"
  cleanCode: string;                 // Ej: "A000", "A00", "A00A09", "I" (sin puntos ni guiones)
  description: string;               // Título oficial de la condición o categoría
  level: 'chapter' | 'block' | 'category' | 'subcategory';
  isTerminal: boolean;               // true si es diagnosticable directamente en consulta médica
  chapterNumber?: string;            // Número romano: "I", "II", ..., "XXI"
  chapterTitle?: string;             // Nombre del capítulo
  blockCode?: string;                // Rango del bloque: "A00-A09"
  blockTitle?: string;               // Nombre del bloque
  categoryCode?: string;             // Código de 3 caracteres: "A00"
  categoryTitle?: string;            // Nombre de la categoría de 3 caracteres
  metadata: Cie10Metadata;
}
```

### 2.2. Esquema Relacional en PostgreSQL (`cie10_codes`)

La tabla existente `cie10_codes` se actualiza mediante una nueva migración con los siguientes campos e índices:

| Columna | Tipo | Nullable | Default | Descripción |
| :--- | :--- | :--- | :--- | :--- |
| `code` | `varchar(15)` | No (PK) | - | Código oficial formateado (ej. "A00.0") |
| `clean_code` | `varchar(15)` | No | - | Código alfanumérico en mayúsculas (ej. "A000") |
| `description` | `text` | No | - | Título de la afección |
| `chapter` | `varchar(255)` | Sí | NULL | Título o identificador del capítulo |
| `block` | `varchar(255)` | Sí | NULL | Identificador o rango del bloque (ej. "A00-A09") |
| `category` | `varchar(15)` | Sí | NULL | Código de categoría de 3 caracteres (ej. "A00") |
| `level` | `varchar(20)` | No | 'subcategory' | Nivel jerárquico ('chapter', 'block', 'category', 'subcategory') |
| `is_terminal` | `boolean` | No | true | true si es código hoja utilizable en diagnóstico clínico |
| `metadata` | `jsonb` | Sí | '{}'::jsonb | `{ inclusions: string[], exclusions: any[], notes: string[], daggerAsterisk?: string }` |
| `is_active` | `boolean` | No | true | Estado activo/inactivo |
| `created_at` | `timestamptz` | No | now() | Fecha de creación |
| `updated_at` | `timestamptz` | No | now() | Fecha de última actualización |

**Índices:**
- `IDX_cie10_codes_clean_code` sobre `clean_code` (B-tree)
- `IDX_cie10_codes_category` sobre `category` (B-tree)
- `IDX_cie10_codes_is_terminal` sobre `is_terminal` (B-tree)
- `IDX_cie10_codes_description` sobre `description` (ya existente)

---

## 3. Pipeline de Extracción y Parsing (`script/parse-cie10-volume1.ts`)

### 3.1. Descarga y Almacenamiento Local en Caché
- Descarga el archivo de [https://ais.paho.org/classifications/chapters/pdf/volume1.pdf](https://ais.paho.org/classifications/chapters/pdf/volume1.pdf) a `script/data/volume1.pdf`.
- Si el archivo ya existe localmente con el tamaño esperado (~30.3 MB), omite la descarga para acelerar ejecuciones posteriores.

### 3.2. Motor de Lectura por Streaming / Páginas
- Utiliza una librería compatible con Node.js (`pdfjs-dist` o `pdf-parse`) para procesar el documento página a página.
- Mantiene el consumo de memoria acotado (< 300 MB) evitando cargar todo el PDF desestructurado en un único buffer de memoria.
- Salta preliminares (índices generales, introducciones históricas) e identifica el inicio de la **Lista Tabular** (Capítulo I).

### 3.3. Máquina de Estados para Sintaxis Tabular del CIE-10
El parser implementa un autómata con los siguientes estados y transiciones:

1. **Estado CAPÍTULO**: Detecta encabezados tipo `CAPÍTULO [I-XXII]` seguido por su título y rango de códigos.
2. **Estado BLOQUE**: Detecta agrupaciones de categorías en paréntesis o líneas de rango (ej. `(A00-A09) Enfermedades infecciosas intestinales`).
3. **Estado CATEGORÍA 3 CARACTERES**: Detecta códigos de 3 dígitos (ej. `A00 Cólera`). Determina si tiene subcategorías o si es directamente terminal.
4. **Estado SUBCATEGORÍA 4 CARACTERES**: Detecta códigos con punto decimal (ej. `A00.0 Cólera debido a...`). Se marca como `isTerminal = true`.
5. **Estado RECOLECCIÓN DE INCLUSIONES**: Captura bloques encabezados por `Incluye:` y asocia los términos subordinados al nodo actual.
6. **Estado RECOLECCIÓN DE EXCLUSIONES**: Captura bloques `Excluye:`, extrayendo el término y el código referenciado entre paréntesis `(ej. A09)`.
7. **Estado NOTAS Y SIGNOS**: Detecta `Nota:`, marcas de daga (`†`) o asterisco (`*`).

### 3.4. Validación y Métricas
Al finalizar el procesamiento, el script emite un reporte en consola:
- Total de capítulos procesados (esperado: 21 o 22).
- Total de bloques procesados.
- Total de categorías de 3 caracteres (~2.000).
- Total de subcategorías de 4 caracteres (~11.000 a 13.000).
- Conteo de inclusiones y exclusiones asociadas.
- Guarda el resultado en `src/cie10/data/cie10-rich.json`.

---

## 4. Modificaciones en el Servicio y Controlador

### 4.1. `Cie10Service`
- **`ensurePreloaded()`**:
  - Lee `cie10-rich.json` (o hace fallback controlado a `cie10-es.json` si aún no existe).
  - Inserta los registros por lotes (chunk de 500) usando `createQueryBuilder().insert().orUpdate()`.
- **`search(query, limit, onlyTerminal = true)`**:
  - Por defecto filtra por `cie.isTerminal = true`.
  - Si `onlyTerminal = false`, incluye categorías o capítulos agrupadores.
  - Búsqueda multi-criterio:
    - Código exacto o prefijo de código (`code` o `clean_code`).
    - Coincidencia en `description` (insensible a mayúsculas/minúsculas).
    - Coincidencia en sinónimos (`metadata->'inclusions'`).
  - Ordenamiento priorizado: coincidencia exacta de código primero, luego prefijo, luego descripción y sinónimos.

### 4.2. `Cie10Controller`
- Agrega soporte al parámetro opcional en el query string: `@Query('onlyTerminal') onlyTerminal?: string` (por defecto `'true'`).

---

## 5. Estrategia de Pruebas y Validación

1. **Pruebas del Parser**:
   - Test unitario con páginas representativas para verificar la correcta asignación de jerarquía y extracción de inclusiones/exclusiones.
2. **Pruebas de Integración de Base de Datos**:
   - Ejecutar la migración TypeORM.
   - Probar `ensurePreloaded()` asegurando que se persistan columnas y el JSONB de `metadata`.
3. **Pruebas del Motor de Búsqueda**:
   - Búsqueda por código: `A00`, `A00.0`, `A000`.
   - Búsqueda por texto directo: `Cólera`.
   - Búsqueda por sinónimo/inclusión: término incluido bajo un código específico.
4. **Verificación de Regresiones**:
   - Ejecutar la suite de pruebas del proyecto (`pnpm test`) para garantizar que `eventualities` y las consultas APS existentes continúen funcionando sin alteraciones.
