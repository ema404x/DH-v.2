// Genera planillas .xlsx de prueba (datos inventados, todo con el prefijo PRUEBA) para probar las tres
// importaciones de la app: directorio, pendientes SAP y calefacción. Sin dependencias: un .xlsx es un zip.
//   node generar.mjs
import { writeFileSync } from 'node:fs';
import { crc32 } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const letra = (i) => (i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26)));

// zip sin compresión
function zip(archivos) {
  const partes = [];
  const central = [];
  let pos = 0;
  for (const [nombre, texto] of archivos) {
    const n = Buffer.from(nombre);
    const d = Buffer.from(texto);
    const crc = crc32(d);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(d.length, 18); local.writeUInt32LE(d.length, 22); local.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(d.length, 20); c.writeUInt32LE(d.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(pos, 42);
    partes.push(local, n, d);
    central.push(c, n);
    pos += 30 + n.length + d.length;
  }
  const cd = Buffer.concat(central);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(archivos.length, 8); fin.writeUInt16LE(archivos.length, 10);
  fin.writeUInt32LE(cd.length, 12); fin.writeUInt32LE(pos, 16);
  return Buffer.concat([...partes, cd, fin]);
}

function xlsx(hojas) {
  const textos = [];
  const idTexto = (s) => { let i = textos.indexOf(s); if (i < 0) i = textos.push(s) - 1; return i; };
  const xmlHoja = (filas) =>
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${filas
      .map((f, r) => `<row r="${r + 1}">${f
        .map((v, c) => (v === '' || v === null ? '' : typeof v === 'number' ? `<c r="${letra(c)}${r + 1}"><v>${v}</v></c>` : `<c r="${letra(c)}${r + 1}" t="s"><v>${idTexto(v)}</v></c>`))
        .join('')}</row>`)
      .join('')}</sheetData></worksheet>`;
  const hojasXml = hojas.map(([, filas]) => xmlHoja(filas));
  const cab = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  return zip([
    ['[Content_Types].xml', `${cab}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${hojas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`],
    ['_rels/.rels', `${cab}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `${cab}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${hojas.map(([n], i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `${cab}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${hojas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${hojas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/><Relationship Id="rId${hojas.length + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ...hojasXml.map((x, i) => [`xl/worksheets/sheet${i + 1}.xml`, x]),
    ['xl/sharedStrings.xml', `${cab}<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${textos.length}" uniqueCount="${textos.length}">${textos.map((t) => `<si><t>${esc(t)}</t></si>`).join('')}</sst>`],
    ['xl/styles.xml', `${cab}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font/></fonts><fills count="1"><fill/></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="1"><xf/></cellXfs></styleSheet>`],
  ]);
}

const planillas = {
  'prueba-directorio.xlsx': [['Escuelas', [
    ['Establecimiento', 'Dirección', 'Jefe de Sitio', 'Comuna', 'Ubicación Técnica', 'M2'],
    ['PRUEBA Escuela 21', 'PRUEBA Av. de Prueba 1234', 'PRUEBA Jefe Uno', 'COMUNA 8A', 'UT-PRUEBA-21', 1200],
    ['PRUEBA Escuela 22', 'PRUEBA Calle Falsa 742', 'PRUEBA Jefe Uno', 'COMUNA 8B1', 'UT-PRUEBA-22', 800],
  ]]],
  'prueba-pendientes-sap.xlsx': [['8A', [
    ['N° DE ORDEN', 'TAREAS A REALIZAR', 'UBICACION', 'ESTABLECIMIENTO', 'INSPECTOR', 'FECHA INICIO', 'FECHA LIMITE SAP', 'CLASE DE ORDEN', 'STATUS'],
    ['PRUEBA-5000001', 'PRUEBA Cambiar vidrio roto', 'Aula 3', 'PRUEBA Escuela 21', 'PRUEBA INSPECTOR', '01/09/2026', '20/10/2026', 'ZM01', 'LIBE'],
    ['PRUEBA-5000002', 'PRUEBA Destapar desagüe del patio', 'Patio', 'PRUEBA Escuela 22', 'PRUEBA INSPECTOR', '05/09/2026', '10/09/2026', 'ZM01', 'LIBE'],
  ]]],
  'prueba-calefaccion.xlsx': [['COMUNA 8A', [
    ['Comuna', 'Escuela', 'Jefe', 'Estufas', '', '', '', 'Radiadores'],
    ['', '', '', 'CANTIDAD', 'FUNCIONA', 'NO FUNCIONA', '%', 'CANTIDAD', 'FUNCIONA', 'NO FUNCIONA'],
    ['8A', 'PRUEBA Escuela 21', 'PRUEBA Jefe Uno', 10, 8, 2, '', 4, 1, 3],
    ['8A', 'PRUEBA Escuela 22', 'PRUEBA Jefe Uno', 6, 6, 0, ''],
  ]]],
  // Planilla de obras de SAP: dos filas de título y los datos por posición (A..V) desde la tercera.
  'prueba-obras.xlsx': [['Obras', [
    ['PLANILLA DE OBRAS (PRUEBA)'],
    ['COM.', 'DIRECCIÓN', 'ESTABLECIMIENTO', 'TÍTULO OBRA EN SAP', 'MONTO', '', '', 'Nº ORDEN', 'ESTADO SAP', 'DETALLE', '', 'PLAZO', 'AI', 'AR', '% AVANCE',
      '', '', '', '', 'JEFE SITIO', 'INSPECTOR', 'SUPERVISOR'],
    ['8A', 'PRUEBA Av. de Prueba 1234', 'PRUEBA Escuela 21', 'PRUEBA Cambio de cubierta', 1000000, '', '', 'PRUEBA-4500001', 'AEJE', 'EN EJECUCION', '', 120,
      '01/06/2026', '01/12/2026', 0.3, '', '', '', '', 'PRUEBA Jefe Uno', 'PRUEBA INSPECTOR', 'PRUEBA Supervisor'],
    ['8B', 'PRUEBA Calle Falsa 742', 'PRUEBA Escuela 22', 'PRUEBA Pintura general', 500000, '', '', 'PRUEBA-4500002', 'APR2', 'CERTIFICADO', '', 60,
      '01/03/2026', '01/05/2026', '100%', '', '', '', '', 'PRUEBA Jefe Uno', 'PRUEBA INSPECTOR', ''],
    ['8A', '', 'PRUEBA Escuela 21', 'PRUEBA Rampa de acceso', 90000, '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
  ]]],
  // Catálogo del pañol, con encabezados como la plantilla de la v1 (y "Stock mínimo" antes que "Stock" a propósito).
  'prueba-catalogo.xlsx': [['Stock Pañol', [
    ['Nombre', 'Código', 'Categoría', 'Unidad', 'Stock mínimo', 'Stock', 'Precio', 'Proveedor', 'Ubicación'],
    ['PRUEBA Cable unipolar 2,5 mm', 'PRUEBA-ELE-1', 'Eléctrico', 'm', 100, 350, '1.234,50', 'PRUEBA Corralón', 'Estante A1'],
    ['PRUEBA Taladro percutor', 'PRUEBA-HER-1', 'Herramientas', 'u', 1, 3, 85000, '', 'Pañol'],
    ['PRUEBA Pintura látex blanca', 'PRUEBA-PIN-1', 'Pintura', 'litros', 20, 8, '1.5', '', 'Estante B2'],
  ]]],
  // Planilla de certificación de obras: una hoja por comuna, con encabezados.
  'prueba-cobros.xlsx': [
    ['COMUNA 8A', [
      ['TITULO DE OBRA EN SAP', 'DIRECCION', 'ESTABLECIMIENTO', 'JEFE DE SITIO', 'INSPECTOR', 'N° MTOM', 'N° MEIN', 'MONTO BASE FEB-23', '%', 'Plazo', 'Acta de inicio', 'Acta de recepcion', 'OBSERVACIONES'],
      ['PRUEBA Cambio de cubierta', 'PRUEBA Av. de Prueba 1234', 'PRUEBA Escuela 21', 'PRUEBA Jefe Uno', 'PRUEBA INSPECTOR', 'PRUEBA-4500001', 'PRUEBA-9001', 1000000, 0.6, 120, '01/06/2026', '01/12/2026', 'Falta cargar actas'],
      ['TOTAL'],
    ]],
    ['COMUNA 8B', [
      ['TITULO DE OBRA EN SAP', 'DIRECCION', 'ESTABLECIMIENTO', 'JEFE DE SITIO', 'INSPECTOR', 'N° MTOM', 'N° MEIN', 'MONTO BASE FEB-23', '%', 'Plazo', 'Acta de inicio', 'Acta de recepcion', 'OBSERVACIONES'],
      ['PRUEBA Pintura general', 'PRUEBA Calle Falsa 742', 'PRUEBA Escuela 22', 'PRUEBA Jefe Uno', 'PRUEBA INSPECTOR', 'PRUEBA-4500002', '', 500000, 1, 60, '01/03/2026', '01/05/2026', 'LISTO PARA CERTIFICAR'],
      ['PRUEBA Baños planta alta', '', 'PRUEBA Escuela 22', 'PRUEBA Jefe Uno', '', 'PRUEBA-4500009', '', 250000, 0, '', '', '', 'Observado por el inspector'],
    ]],
  ],
};

for (const [nombre, hojas] of Object.entries(planillas)) {
  writeFileSync(join(aqui, nombre), xlsx(hojas));
  console.log('listo', nombre);
}
