const fs = require('fs');
const path = require('path');

const MAX_RECOMMENDED_LINES = 250;
const HARD_CAP_LINES = 300;
const SRC_DIR = path.join(__dirname, '..', 'src');

function getAllTsFiles(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getAllTsFiles(fullPath));
    } else if (file.endsWith('.ts') && !file.endsWith('.spec.ts')) {
      results.push(fullPath);
    }
  }
  return results;
}

const files = getAllTsFiles(SRC_DIR);
const report = [];

for (const file of files) {
  const content = fs.readFileSync(file, 'utf-8');
  const lines = content.split('\n').length;
  if (lines > MAX_RECOMMENDED_LINES) {
    const relative = path.relative(path.join(__dirname, '..'), file);
    report.push({ file: relative, lines, severity: lines > HARD_CAP_LINES ? 'CRÍTICO' : 'ALERTA' });
  }
}

report.sort((a, b) => b.lines - a.lines);

console.log('\n======================================================');
console.log(' AUDITORÍA DE TAMAÑO DE ARCHIVOS - SIS-SIRCA');
console.log(` Límite recomendado: ${MAX_RECOMMENDED_LINES} líneas | Límite duro: ${HARD_CAP_LINES} líneas`);
console.log('======================================================\n');

if (report.length === 0) {
  console.log(' ¡Excelente! Ningún archivo supera el límite recomendado.');
} else {
  console.table(report);
  console.log(`\n Total de archivos excedidos: ${report.length}`);
  console.log(' Revisa docs/architecture/GUIA_DESARROLLO_ARQUITECTURA.md para las pautas de descomposición.\n');
}
