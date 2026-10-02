import readXlsxFile from 'read-excel-file/browser';

// Lectura de las planillas de Excel que usa la operación (.xlsx). El archivo se lee en el navegador,
// se convierte a filas limpias y se manda a la base, que es la que decide qué se crea y qué se omite.
// Los formatos son los mismos que aceptaba la v1.

type Celda = string | number | boolean | Date | null | undefined;
interface Hoja {
  nombre: string;
  filas: Celda[][];
}

async function leerHojas(archivo: File): Promise<Hoja[]> {
  if (!/\.xlsx$/i.test(archivo.name)) {
    throw new Error('El archivo tiene que ser .xlsx. Si es .xls o .csv, abrilo en Excel y guardalo como "Libro de Excel (.xlsx)".');
  }
  try {
    const hojas = await readXlsxFile(archivo);
    return hojas.map((h) => ({ nombre: h.sheet, filas: h.data as unknown as Celda[][] }));
  } catch {
    throw new Error('No se pudo leer el archivo. Revisá que sea un Excel (.xlsx) y que no esté protegido con contraseña.');
  }
}

const txt = (c: Celda): string => (c === null || c === undefined ? '' : c instanceof Date ? c.toISOString().slice(0, 10) : String(c)).trim();
const may = (c: Celda): string => txt(c).toUpperCase();
const sinAcentos = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const clave = (c: Celda): string => sinAcentos(may(c)).replace(/\s+/g, ' ');

// Número de una celda. En texto: "1.234,56" (formato argentino), "1.234" (miles) o "1.5" (decimal con punto).
function num(c: Celda): number | null {
  if (typeof c === 'number') return Number.isFinite(c) ? c : null;
  let t = txt(c).replace(/[$\s]/g, '');
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  if (t === '' || Number.isNaN(Number(t))) return null;
  return Number(t);
}

// Fecha de una celda: fecha real de Excel, número de serie o texto DD/MM/AAAA. Cualquier otra cosa, sin fecha.
function fecha(c: Celda): string | null {
  if (c instanceof Date) return Number.isNaN(c.getTime()) ? null : c.toISOString().slice(0, 10);
  if (typeof c === 'number' && c > 20000 && c < 80000) {
    return new Date(Date.UTC(1899, 11, 30) + Math.round(c) * 86400000).toISOString().slice(0, 10);
  }
  const m = txt(c).match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/);
  if (!m) return null;
  const anio = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const d = new Date(Date.UTC(anio, Number(m[2]) - 1, Number(m[1])));
  return d.getUTCMonth() === Number(m[2]) - 1 ? d.toISOString().slice(0, 10) : null;
}

// "COMUNA 8B1" → "8B". "8A" → "8A".
function zonaDe(c: Celda): string {
  const z = may(c).replace(/^COMUNA\s*/, '').replace(/^C\s*(?=\d)/, '');
  return /^\d+[A-Z]1$/.test(z) ? z.slice(0, -1) : z;
}

// índice de la primera columna cuyo encabezado coincide con alguno de los nombres
function columna(encabezados: Celda[], nombres: string[], contiene = false): number {
  const limpios = encabezados.map(clave);
  const buscados = nombres.map((n) => sinAcentos(n.toUpperCase()));
  return limpios.findIndex((e) => buscados.some((b) => (contiene ? e.includes(b) : e === b)));
}

// ------------------------------------------------------------------ directorio

export interface FilaDirectorio {
  direccion: string;
  zona: string;
  establecimiento: string;
  codigo: string;
  m2: number | null;
  jefe: string;
  inspector: string;
}

export interface LecturaDirectorio {
  filas: FilaDirectorio[];
  formato: string;
}

// Acepta las dos planillas de la v1:
//   · "Direcciones y jefes": hoja con "escuela" en el nombre; columnas A = jefe, B = comuna, C = dirección, D = escuela.
//   · Planilla con encabezados: Establecimiento, Dirección, Jefe de Sitio, Comuna, Ubicación Técnica, M2 (e Inspector).
export async function leerDirectorio(archivo: File): Promise<LecturaDirectorio> {
  const hojas = await leerHojas(archivo);

  for (const h of hojas) {
    const cab = h.filas[0] ?? [];
    const iEst = columna(cab, ['ESTABLECIMIENTO', 'ESCUELA'], true);
    const iDir = columna(cab, ['DIRECCION'], true);
    if (iEst >= 0 && iDir >= 0 && iEst !== 3) {
      const iJefe = columna(cab, ['JEFE'], true);
      const iZona = columna(cab, ['COMUNA', 'ZONA'], true);
      const iCod = columna(cab, ['UBICACION TECNICA', 'UBIC_TECNICA', 'UBICACION', 'UBIC. TECNICA'], false);
      const iM2 = columna(cab, ['M2', 'SUPERFICIE'], false);
      const iInsp = columna(cab, ['INSPECTOR'], true);
      const filas = h.filas.slice(1)
        .filter((f) => txt(f[iEst]) !== '')
        .map((f) => ({
          establecimiento: txt(f[iEst]), direccion: txt(f[iDir]), zona: iZona >= 0 ? zonaDe(f[iZona]) : '',
          jefe: iJefe >= 0 ? txt(f[iJefe]) : '', codigo: iCod >= 0 ? txt(f[iCod]) : '',
          m2: iM2 >= 0 ? num(f[iM2]) : null, inspector: iInsp >= 0 ? txt(f[iInsp]) : '',
        }));
      if (filas.length > 0) return { filas, formato: `Planilla con encabezados (hoja "${h.nombre}")` };
    }
  }

  const porPosicion = hojas.find((h) => clave(h.nombre).includes('ESCUELA')) ?? hojas[0];
  if (porPosicion) {
    const filas = porPosicion.filas.slice(1)
      .filter((f) => txt(f[0]) !== '' && txt(f[2]) !== '' && txt(f[3]) !== '')
      .map((f) => ({ jefe: txt(f[0]), zona: zonaDe(f[1]), direccion: txt(f[2]), establecimiento: txt(f[3]), codigo: '', m2: null, inspector: '' }));
    if (filas.length > 0) return { filas, formato: `Direcciones y jefes por columnas A a D (hoja "${porPosicion.nombre}")` };
  }
  throw new Error('No se reconoció la planilla. Tiene que traer una columna "Establecimiento" y una "Dirección", o el formato de cuatro columnas: jefe, comuna, dirección, escuela.');
}

// ------------------------------------------------------------------ pendientes SAP

export interface FilaSAP {
  numero_sap: string;
  numero_sap_desaprobado: string;
  descripcion: string;
  sitio: string;
  establecimiento: string;
  inspector: string;
  fecha_inicio: string | null;
  fecha_limite: string | null;
  clase_orden: string;
  status_sap: string;
}

export interface LecturaSAP {
  filas: FilaSAP[];
  hojas: { nombre: string; ordenes: number; formato: string }[];
  inspectores: string[];
}

// Los tres formatos de la v1. A diferencia de la v1, el formato se reconoce por el contenido de cada hoja
// (si tiene la fila de encabezados o no), no por la comuna elegida.
export async function leerPendientesSAP(archivo: File): Promise<LecturaSAP> {
  const hojas = await leerHojas(archivo);
  const filas: FilaSAP[] = [];
  const resumen: LecturaSAP['hojas'] = [];
  const vistos = new Set<string>();

  for (const h of hojas) {
    const nombre = clave(h.nombre);
    if (nombre.includes('PARA FORMATO CONDICIONAL') || /^ESC(UELAS)?$/.test(nombre)) continue;
    const cab = h.filas[0] ?? [];
    const iOrden = columna(cab, ['N° DE ORDEN', 'Nº DE ORDEN', 'NRO DE ORDEN', 'N DE ORDEN']);
    const antes = filas.length;
    let formato: string;

    if (iOrden >= 0) {
      formato = 'con encabezados';
      const iTareas = columna(cab, ['TAREAS A REALIZAR', 'TAREA', 'DESCRIPCION']);
      const iUbic = columna(cab, ['UBICACION']);
      const iEst = columna(cab, ['ESTABLECIMIENTO']);
      const iInsp = columna(cab, ['INSPECTOR']);
      const iIni = columna(cab, ['FECHA INICIO']);
      const iLim = columna(cab, ['FECHA LIMITE SAP', 'FECHA LIMITE']);
      const iClase = columna(cab, ['CLASE DE ORDEN']);
      const iStatus = columna(cab, ['STATUS']);
      const iDes = columna(cab, ['DESAPROBADO', 'DESROBADO'], true);
      for (const f of h.filas.slice(1)) {
        const numero = txt(f[iOrden]);
        const tareas = iTareas >= 0 ? txt(f[iTareas]) : '';
        if (!numero || !tareas || vistos.has(numero)) continue;
        vistos.add(numero);
        const inspector = iInsp >= 0 ? txt(f[iInsp]) : '';
        filas.push({
          numero_sap: numero, descripcion: tareas,
          numero_sap_desaprobado: iDes >= 0 ? txt(f[iDes]) : '',
          sitio: iUbic >= 0 ? txt(f[iUbic]) : '', establecimiento: iEst >= 0 ? txt(f[iEst]) : '',
          inspector: inspector === '#N/A' ? '' : inspector,
          fecha_inicio: iIni >= 0 ? fecha(f[iIni]) : null, fecha_limite: iLim >= 0 ? fecha(f[iLim]) : null,
          clase_orden: iClase >= 0 ? txt(f[iClase]) : '', status_sap: iStatus >= 0 ? txt(f[iStatus]) : '',
        });
      }
    } else {
      // Sin encabezados: A inspector, B ubicación, D tareas, E N° de orden, G inicio, H límite, I clase, J status.
      formato = 'por columnas';
      for (const f of h.filas) {
        const numero = txt(f[4]);
        if (!/^\d+$/.test(numero) || !txt(f[3]) || vistos.has(numero)) continue;
        vistos.add(numero);
        filas.push({
          numero_sap: numero, numero_sap_desaprobado: '', descripcion: txt(f[3]), sitio: txt(f[1]), establecimiento: '',
          inspector: txt(f[0]), fecha_inicio: fecha(f[6]), fecha_limite: fecha(f[7]), clase_orden: txt(f[8]), status_sap: txt(f[9]),
        });
      }
    }
    if (filas.length > antes) resumen.push({ nombre: h.nombre, ordenes: filas.length - antes, formato });
  }

  if (filas.length === 0) {
    throw new Error('No se encontraron órdenes en el archivo. Cada fila necesita el número de orden y las tareas a realizar.');
  }
  const inspectores = [...new Set(filas.map((f) => f.inspector.toUpperCase()).filter(Boolean))].sort();
  return { filas, hojas: resumen, inspectores };
}

// ------------------------------------------------------------------ calefacción

export interface FilaCalefaccion {
  escuela: string;
  zona: string;
  jefe: string;
  tipo_equipo: string;
  total: number;
  funciona: number | null;
  no_funciona: number | null;
}

// Cada grupo ocupa tres columnas: cantidad, funciona, no funciona. La columna siguiente (porcentaje) se ignora.
const GRUPOS: [number, string][] = [
  [3, 'estufas'], [7, 'radiadores'], [11, 'conductos'], [15, 'calderas'],
  [19, 'vrv'], [23, 'vrv_bajo_silueta'], [27, 'aire_acondicionado_calor'], [31, 'otros'],
];
const NO_ES_ESCUELA = ['ESCUELA', 'ESTABLECIMIENTO', 'NOMBRE', 'JEFE', 'TOTAL', 'CANTIDAD'];

// Relevamiento de calefacción: una hoja por comuna ("COMUNA 8A", "COMUNA 8B", ...), datos por posición de columna.
export async function leerCalefaccion(archivo: File): Promise<{ filas: FilaCalefaccion[]; hojas: string[] }> {
  const hojas = (await leerHojas(archivo)).filter((h) => /^COMUNA\s+\S+/.test(clave(h.nombre)));
  if (hojas.length === 0) {
    throw new Error('El archivo no tiene hojas por comuna. Cada hoja se tiene que llamar "COMUNA 8A", "COMUNA 8B", etc.');
  }
  const filas: FilaCalefaccion[] = [];
  for (const h of hojas) {
    let zona = zonaDe(h.nombre);
    let escuela = '';
    let jefe = '';
    for (const f of h.filas.slice(1)) {
      if (f.every((c) => txt(c) === '')) continue;
      if (may(f[3]) === 'CANTIDAD') continue;
      const a = zonaDe(f[0]);
      if (/^\d+[A-Z]$/.test(a)) zona = a;
      const b = may(f[1]);
      if (NO_ES_ESCUELA.includes(b) || /^(COMUNA\s*)?\d+[A-Z]1?$/.test(b)) continue;
      if (b !== '') {
        // Escuela nueva: su jefe es el de esta fila (si viene vacío, queda vacío; no se arrastra el de la anterior).
        escuela = txt(f[1]);
        jefe = txt(f[2]);
      } else if (txt(f[2]) !== '') {
        jefe = txt(f[2]);
      }
      if (!escuela) continue;
      for (const [col, tipo] of GRUPOS) {
        const total = num(f[col]);
        const funciona = num(f[col + 1]);
        const noFunciona = num(f[col + 2]);
        if (total === null || total <= 0) continue;
        // Sin dato de funcionamiento es una fila de subtotal de la planilla: no se cuenta.
        if ((funciona ?? 0) === 0 && (noFunciona ?? 0) === 0) continue;
        filas.push({ escuela, zona, jefe, tipo_equipo: tipo, total: Math.round(total), funciona, no_funciona: noFunciona });
      }
    }
  }
  if (filas.length === 0) {
    throw new Error('Las hojas por comuna no tienen equipos cargados en las columnas esperadas.');
  }
  return { filas, hojas: hojas.map((h) => h.nombre) };
}

// ------------------------------------------------------------------ obras

// "45 %" puede venir como 45 o como 0,45 (celda con formato de porcentaje). Se devuelve de 0 a 100.
function porcentaje(c: Celda): number | null {
  const n = num(typeof c === 'string' ? c.replace('%', '') : c);
  if (n === null) return null;
  const v = n > 0 && n <= 1 && !(typeof c === 'string' && c.includes('%')) ? n * 100 : n;
  return Math.min(100, Math.max(0, Math.round(v * 100) / 100));
}

export interface FilaObra {
  codigo_sap: string;
  titulo: string;
  establecimiento: string;
  direccion: string;
  zona: string;
  monto_base: number | null;
  estado_sap: string;
  detalle: string;
  plazo_dias: number | null;
  fecha_inicio: string | null;
  fecha_fin: string | null;
  avance: number | null;
  jefe: string;
  inspector: string;
  supervisor: string;
}

// Planilla de obras de SAP (la misma que importaba la v1): datos desde la tercera fila, por posición de columna.
//   A comuna · B dirección · C establecimiento · D título · E monto · H N° de orden SAP · I estado SAP · J detalle
//   L plazo · M acta de inicio · N acta de recepción · O % de avance · T jefe de sitio · U inspector · V supervisor
export async function leerPlanillaObras(archivo: File): Promise<{ filas: FilaObra[]; hoja: string }> {
  const hojas = await leerHojas(archivo);
  for (const h of hojas) {
    const filas = h.filas.slice(2)
      .filter((f) => txt(f[3]) !== '')
      .map((f) => {
        const plazo = num(f[11]);
        return {
          zona: zonaDe(f[0]), direccion: txt(f[1]), establecimiento: txt(f[2]), titulo: txt(f[3]), monto_base: num(f[4]),
          codigo_sap: txt(f[7]), estado_sap: txt(f[8]), detalle: txt(f[9]),
          plazo_dias: plazo === null ? null : Math.round(plazo), fecha_inicio: fecha(f[12]), fecha_fin: fecha(f[13]), avance: porcentaje(f[14]),
          jefe: txt(f[19]), inspector: txt(f[20]), supervisor: txt(f[21]),
        };
      });
    if (filas.length > 0) return { filas, hoja: h.nombre };
  }
  throw new Error('No se encontraron obras. La planilla tiene que traer el título de la obra en la columna D, desde la tercera fila.');
}

export interface FilaCobro {
  titulo: string;
  direccion: string;
  establecimiento: string;
  zona: string;
  jefe: string;
  inspector: string;
  mtom: string;
  mein: string;
  monto_base: number | null;
  avance: number | null;
  plazo_dias: number | null;
  fecha_inicio: string | null;
  fecha_fin: string | null;
  observaciones: string;
}

// Planilla de certificación de obras: una hoja por comuna, con encabezados (TITULO DE OBRA EN SAP, DIRECCION,
// ESTABLECIMIENTO, JEFE DE SITIO, INSPECTOR, N° MTOM, N° MEIN, MONTO BASE, %, PLAZO, ACTA DE INICIO,
// ACTA DE RECEPCION, OBSERVACIONES). La fila de encabezados se busca en las primeras diez.
export async function leerPlanillaCobros(archivo: File): Promise<{ filas: FilaCobro[]; hojas: { nombre: string; obras: number }[] }> {
  const hojas = await leerHojas(archivo);
  const filas: FilaCobro[] = [];
  const resumen: { nombre: string; obras: number }[] = [];
  for (const h of hojas) {
    const iCab = h.filas.slice(0, 10).findIndex((f) => columna(f, ['TITULO'], true) >= 0);
    if (iCab < 0) continue;
    const cab = h.filas[iCab];
    const iTit = columna(cab, ['TITULO'], true);
    const iDir = columna(cab, ['DIRECCION'], true);
    const iEst = columna(cab, ['ESTABLECIMIENTO'], true);
    const iJefe = columna(cab, ['JEFE'], true);
    const iInsp = columna(cab, ['INSPECTOR'], true);
    const iMtom = columna(cab, ['MTOM'], true);
    const iMein = columna(cab, ['MEIN'], true);
    const iMonto = columna(cab, ['MONTO BASE', 'MONTO'], true);
    const iPct = columna(cab, ['%', 'AVANCE', '% AVANCE']);
    const iPlazo = columna(cab, ['PLAZO'], true);
    const iAi = columna(cab, ['ACTA DE INICIO', 'AI'], false);
    const iAr = columna(cab, ['ACTA DE RECEPCION', 'AR'], false);
    const iObs = columna(cab, ['OBSERVACIONES', 'OBSERVACION'], true);
    const zona = zonaDe(h.nombre);
    const antes = filas.length;
    for (const f of h.filas.slice(iCab + 1)) {
      const titulo = txt(f[iTit]);
      if (!titulo || clave(titulo).startsWith('TOTAL')) continue;
      const plazo = iPlazo >= 0 ? num(f[iPlazo]) : null;
      filas.push({
        titulo, zona, direccion: iDir >= 0 ? txt(f[iDir]) : '', establecimiento: iEst >= 0 ? txt(f[iEst]) : '',
        jefe: iJefe >= 0 ? txt(f[iJefe]) : '', inspector: iInsp >= 0 ? txt(f[iInsp]) : '',
        mtom: iMtom >= 0 ? txt(f[iMtom]) : '', mein: iMein >= 0 ? txt(f[iMein]) : '',
        monto_base: iMonto >= 0 ? num(f[iMonto]) : null, avance: iPct >= 0 ? porcentaje(f[iPct]) : null,
        plazo_dias: plazo === null ? null : Math.round(plazo),
        fecha_inicio: iAi >= 0 ? fecha(f[iAi]) : null, fecha_fin: iAr >= 0 ? fecha(f[iAr]) : null,
        observaciones: iObs >= 0 ? txt(f[iObs]) : '',
      });
    }
    if (filas.length > antes) resumen.push({ nombre: h.nombre, obras: filas.length - antes });
  }
  if (filas.length === 0) {
    throw new Error('No se encontraron obras. Cada hoja necesita una fila de encabezados con "TITULO DE OBRA EN SAP".');
  }
  return { filas, hojas: resumen };
}

// ------------------------------------------------------------------ catálogo del pañol

export interface FilaMaterial {
  nombre: string;
  codigo: string;
  categoria: string;
  unidad: string;
  stock: number | null;
  stock_minimo: number | null;
  costo_unitario: number | null;
  proveedor: string;
  ubicacion: string;
  notas: string;
}

const CAMPOS_MATERIAL: [keyof FilaMaterial, string[]][] = [
  // el mínimo va antes que el stock: "Stock mínimo" no se tiene que tomar como stock
  ['stock_minimo', ['MINIMO', 'STOCK MINIMO', 'STOCK MIN', 'MIN', 'MIN_STOCK']],
  ['nombre', ['NOMBRE', 'MATERIAL', 'DESCRIPCION', 'ARTICULO', 'PRODUCTO', 'ITEM', 'DETALLE']],
  ['codigo', ['CODIGO', 'COD', 'SKU', 'REFERENCIA', 'REF']],
  ['categoria', ['CATEGORIA', 'RUBRO', 'FAMILIA', 'TIPO']],
  ['unidad', ['UNIDAD', 'UM', 'U.M.', 'MEDIDA', 'UND']],
  ['stock', ['STOCK', 'CANTIDAD', 'EXISTENCIA', 'SALDO', 'DISPONIBLE', 'CANT']],
  ['costo_unitario', ['PRECIO', 'COSTO', 'COSTO UNITARIO', 'PRECIO UNITARIO', 'VALOR', 'P.U.']],
  ['proveedor', ['PROVEEDOR', 'MARCA', 'FABRICANTE']],
  ['ubicacion', ['UBICACION', 'DEPOSITO', 'ESTANTE', 'LUGAR']],
  ['notas', ['NOTAS', 'OBSERVACIONES', 'OBS', 'COMENTARIOS']],
];
const CATEGORIAS_MATERIAL = ['electrico', 'plomeria', 'pintura', 'construccion', 'herreria', 'herramientas', 'seguridad', 'climatizacion', 'limpieza', 'otros'];
const CATEGORIA_DE: [RegExp, string][] = [
  [/HERRAM/, 'herramientas'], [/ELECTR|CABLE|LUZ|LAMPAR|TERMICA/, 'electrico'], [/PLOM|SANIT|CANO|AGUA/, 'plomeria'], [/PINTU|LATEX|ESMALTE/, 'pintura'],
  [/HERRER|METAL|HIERRO|PERFIL/, 'herreria'], [/SEGUR|EPP|PROTEC/, 'seguridad'], [/CLIMA|AIRE|CALEF/, 'climatizacion'], [/LIMPI/, 'limpieza'],
  [/CONSTR|ALBA|CEMENT|ARENA|LADRILL/, 'construccion'],
];
const UNIDAD_DE: [RegExp, string][] = [
  [/^(M2|METRO2|METROS? CUADRADOS?)$/, 'metro2'], [/^(M3|METRO3|METROS? CUBICOS?)$/, 'metro3'], [/^(M|MT|MTS|METROS?|ML)$/, 'metro'],
  [/^(KG|KGS|KILOS?)$/, 'kg'], [/^(L|LT|LTS|LITROS?)$/, 'litro'], [/^BOLSAS?$/, 'bolsa'], [/^CAJAS?$/, 'caja'], [/^ROLLOS?$/, 'rollo'],
  [/^PAR(ES)?$/, 'par'], [/^JUEGOS?$/, 'juego'], [/^(U|UN|UNI|UNID|UNIDAD(ES)?)$/, 'unidad'],
];

// Catálogo del pañol: la primera hoja, con encabezados (la plantilla de la v1: nombre, codigo, categoria, unidad, stock,
// minimo, precio, proveedor, ubicacion, notas, o variantes). Cada columna se toma una sola vez, primero por nombre
// exacto y después por parecido: así "Stock mínimo" no se lee como stock ni "Unidad" como código (pasaba en la v1).
export async function leerCatalogoMateriales(archivo: File): Promise<{ filas: FilaMaterial[]; hoja: string; columnas: string[] }> {
  const hojas = await leerHojas(archivo);
  const h = hojas[0];
  const iCab = h ? h.filas.slice(0, 10).findIndex((f) => f.some((c) => /^(NOMBRE|MATERIAL|DESCRIPCION|ARTICULO|PRODUCTO)$/.test(clave(c)))) : -1;
  if (!h || iCab < 0) {
    throw new Error('No se encontró la fila de encabezados. La planilla necesita una columna "Nombre" (o "Material", "Descripción").');
  }
  const cab = h.filas[iCab].map(clave);
  const usadas = new Set<number>();
  const indice: Partial<Record<keyof FilaMaterial, number>> = {};
  for (const parecido of [false, true]) {
    for (const [campo, nombres] of CAMPOS_MATERIAL) {
      if (indice[campo] !== undefined) continue;
      const i = cab.findIndex((e, n) => !usadas.has(n) && e !== '' && nombres.some((b) => (parecido ? b.length >= 3 && e.includes(b) : e === b)));
      if (i >= 0) { indice[campo] = i; usadas.add(i); }
    }
  }
  const de = (f: Celda[], campo: keyof FilaMaterial) => (indice[campo] === undefined ? '' : txt(f[indice[campo]!]));
  const numDe = (f: Celda[], campo: keyof FilaMaterial) => (indice[campo] === undefined ? null : num(f[indice[campo]!]));
  const filas = h.filas.slice(iCab + 1)
    .filter((f) => de(f, 'nombre') !== '')
    .map((f) => {
      const cat = sinAcentos(de(f, 'categoria').toUpperCase());
      const uni = sinAcentos(de(f, 'unidad').toUpperCase()).replace(/\.$/, '');
      return {
        nombre: de(f, 'nombre'), codigo: de(f, 'codigo'),
        categoria: CATEGORIAS_MATERIAL.find((k) => k === cat.toLowerCase()) ?? CATEGORIA_DE.find(([re]) => re.test(cat))?.[1] ?? (cat ? 'otros' : ''),
        unidad: UNIDAD_DE.find(([re]) => re.test(uni))?.[1] ?? (uni ? 'unidad' : ''),
        stock: numDe(f, 'stock'), stock_minimo: numDe(f, 'stock_minimo'), costo_unitario: numDe(f, 'costo_unitario'),
        proveedor: de(f, 'proveedor'), ubicacion: de(f, 'ubicacion'), notas: de(f, 'notas'),
      };
    });
  if (filas.length === 0) throw new Error('La planilla no tiene materiales debajo de los encabezados.');
  const columnas = (Object.keys(indice) as (keyof FilaMaterial)[]).map((k) => `${k} ← "${txt(h.filas[iCab][indice[k]!])}"`);
  return { filas, hoja: h.nombre, columnas };
}