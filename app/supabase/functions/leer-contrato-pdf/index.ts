// Edge function: leer-contrato-pdf
// Lee el PDF de un ADA, orden de compra o presupuesto con Gemini y devuelve los datos para armar el contrato.
// No guarda nada: el formulario los muestra para que una persona los revise antes de crear el contrato.
//
//   { accion: "leer", path, tipo? }                              → cabecera + ítems + control de la suma
//   { accion: "corregir", path, total_documento, total_items }   → solo los ítems, releídos para que cuadren
//
// `path` es el archivo ya subido al bucket privado "documentos" (carpeta del sector). Se baja con la sesión del
// usuario: si el archivo es de otro sector, para él no existe. Solo gerencia (la que crea contratos) puede usarla.
//
// Igual que en la v1 (extractADA + correctADAItems): la IA lee todo de una pasada, y la suma de cantidad × precio
// se compara con el total que dice el documento. Si no cuadra, el formulario ofrece pedir la corrección.
//
// Secretos (Supabase → Edge Functions → Secrets): GEMINI_API_KEY (el mismo del informe de inspección) y,
// opcional, GEMINI_MODEL. En el plan gratis, Google puede usar lo enviado para mejorar sus productos.
//
// Deploy:  npx supabase functions deploy leer-contrato-pdf

import { createClient } from 'npm:@supabase/supabase-js@2';

const MODELO = Deno.env.get('GEMINI_MODEL') || 'gemini-3.8-flash';
const MODELO_RESERVA = 'gemini-3.5-flash-lite';
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const ESPERA_MS = 100_000;
const TOTAL_MS = 140_000;
const MAX_BYTES = 15 * 1024 * 1024;
// Diferencia aceptada entre la suma de los ítems y el total del documento (redondeos del PDF).
const TOLERANCIA = 0.005;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const responder = (cuerpo: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

// ------------------------------------------------------------------ qué se le pide a la IA

const ITEM = {
  type: 'object',
  properties: {
    descripcion: { type: 'string', description: 'Descripción del renglón, tal como figura' },
    um: { type: 'string', description: 'Unidad de medida (mes, m2, gl, u, ...)' },
    cantidad: { type: 'number' },
    importe_unitario: { type: 'number', description: 'Precio unitario, sin símbolo ni separadores de miles' },
  },
  required: ['descripcion', 'um', 'cantidad', 'importe_unitario'],
};

const ESQUEMA_LEER = {
  type: 'object',
  properties: {
    tipo: { type: 'string', enum: ['abono_mensual', 'obra', 'certificado_avance'] },
    contratista: { type: 'string' },
    contratista_cuit: { type: 'string' },
    obra_servicio: { type: 'string', description: 'Nombre de la obra o del servicio contratado' },
    emprendimiento: { type: 'string' },
    ada_numero: { type: 'string' },
    oc_numero: { type: 'string' },
    fecha_inicio: { type: 'string', description: 'AAAA-MM-DD, o vacío' },
    fecha_fin: { type: 'string', description: 'AAAA-MM-DD, o vacío' },
    plazo: { type: 'string' },
    condiciones_pago: { type: 'string' },
    anticipo_pct: { type: 'number' },
    fondo_reparo_pct: { type: 'number' },
    total_documento: { type: 'number', description: 'El TOTAL FINAL del documento, literal (sin IVA si se discrimina aparte)' },
    items: { type: 'array', items: ITEM },
  },
  required: ['tipo', 'contratista', 'obra_servicio', 'items'],
};

const ESQUEMA_CORREGIR = { type: 'object', properties: { items: { type: 'array', items: ITEM } }, required: ['items'] };

const SISTEMA = `Sos experto en contratos de obra y servicios de mantenimiento de la administración pública argentina.
Leés ADA, órdenes de compra, presupuestos y certificados en PDF y extraés los datos exactamente como figuran.
Reglas:
- No inventes datos. Lo que no figura, dejalo vacío (texto) o en 0 (números).
- Números: sin símbolo de moneda ni separadores de miles; coma o punto decimal pasan a punto.
- Fechas en formato AAAA-MM-DD.
- Ítems: SOLO renglones de trabajo individuales (descripción + unidad + cantidad + precio unitario).
  IGNORÁ las filas de "Subtotal", "Total rubro", "Total sección", "Total grupo", IVA y totales generales:
  son agrupaciones, no ítems. Una fila cuyo importe es la suma de las anteriores del mismo grupo es un subtotal.
- Antes de responder, verificá que la suma de cantidad × precio unitario de los ítems dé el total del documento
  (±0,5 %). Si no da, revisá: casi siempre es un subtotal tomado como ítem o un renglón salteado.`;

const TIPOS: Record<string, string> = {
  abono_mensual: 'contrato de servicio o mantenimiento mensual recurrente (los ítems suelen ir por mes)',
  obra: 'contrato, orden de compra o presupuesto de obra con ítems de medición',
  certificado_avance: 'certificado o informe de avance con columnas de acumulado anterior, presente y acumulado',
};

// ------------------------------------------------------------------ Gemini

type Parte = { type: 'text'; text: string } | { type: 'document'; data: string; mime_type: string };

// Motivo por el que no se pudo usar la IA, en palabras para quien usa la app.
// `probarOtro`: el problema puede ser de ese modelo (saturado, sin cupo, no disponible) y vale el de reserva.
class SinIA extends Error {
  constructor(mensaje: string, readonly probarOtro = false) {
    super(mensaje);
  }
}

async function gemini(clave: string, partes: Parte[], esquema: Record<string, unknown>): Promise<string> {
  const limite = Date.now() + TOTAL_MS;
  let ultimo: unknown;
  for (const modelo of [...new Set([MODELO, MODELO_RESERVA])]) {
    const espera = Math.min(ESPERA_MS, limite - Date.now());
    if (espera < 15_000) break;
    try {
      return await pedirAGemini(modelo, clave, partes, espera, esquema);
    } catch (e) {
      ultimo = e;
      if (!(e instanceof SinIA) || !e.probarOtro) throw e;
    }
  }
  throw ultimo ?? new SinIA('la IA tardó demasiado en responder');
}

async function pedirAGemini(modelo: string, clave: string, partes: Parte[], esperaMs: number, esquema: Record<string, unknown>): Promise<string> {
  let r: Response;
  try {
    r = await fetch(GEMINI, {
      method: 'POST',
      headers: { 'x-goog-api-key': clave, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(esperaMs),
      body: JSON.stringify({
        model: modelo,
        system_instruction: SISTEMA,
        input: partes,
        store: false,
        response_format: { type: 'text', mime_type: 'application/json', schema: esquema },
      }),
    });
  } catch {
    throw new SinIA('la IA tardó demasiado en responder', true);
  }
  if (!r.ok) {
    const cuerpo = await r.text().catch(() => '');
    let detalle = '';
    try {
      detalle = String((JSON.parse(cuerpo) as { error?: { message?: string } }).error?.message ?? '');
    } catch { /* la respuesta no era JSON */ }
    console.error(`Gemini ${modelo} respondió ${r.status}: ${cuerpo.slice(0, 1000)}`);
    const cola = detalle ? `: ${detalle.slice(0, 160)}` : '';
    if (r.status === 429) throw new SinIA(`se alcanzó el tope gratis de la IA por ahora${cola}`, true);
    if (r.status === 401 || r.status === 403) throw new SinIA(`la clave de IA no es válida o no tiene permiso${cola}`);
    if (r.status === 404) throw new SinIA(`el modelo de IA ${modelo} no está disponible${cola}`, true);
    throw new SinIA(`el servicio de IA devolvió un error (${r.status}, modelo ${modelo})${cola}`, r.status >= 500);
  }
  const datos = await r.json().catch(() => null) as { steps?: { type?: string; content?: { type?: string; text?: string }[] }[] } | null;
  const texto = (datos?.steps ?? [])
    .filter((s) => s.type === 'model_output')
    .flatMap((s) => s.content ?? [])
    .filter((c) => c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text)
    .join('\n')
    .trim();
  if (!texto) throw new SinIA('la IA no devolvió texto', true);
  return texto;
}

// ------------------------------------------------------------------ limpieza y control

export interface Item {
  descripcion: string;
  um: string;
  cantidad: number;
  importe_unitario: number;
  subtotal_sospechoso: boolean;
}

const texto = (v: unknown, max = 300) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
export function numero(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v !== 'string') return 0;
  // "1.234.567,89" o "1,234,567.89" o "1234567.89"
  let s = v.replace(/[^\d,.\-]/g, '');
  if (s.includes(',') && s.includes('.')) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (s.includes(',')) s = /,\d{3}$/.test(s) && s.split(',').length > 2 ? s.replace(/,/g, '') : s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}
const fecha = (v: unknown) => {
  const s = texto(v, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
};
const pct = (v: unknown) => Math.min(100, Math.max(0, numero(v)));
const redondear = (n: number) => Math.round(n * 100) / 100;

// Los renglones que la IA no debería haber tomado como ítems: se marcan para que la persona los mire.
const PALABRAS_TOTAL = /^\s*(sub\s*-?\s*total|total|iva\b|importe total|monto total)/i;

export function itemsValidos(lista: unknown): Item[] {
  if (!Array.isArray(lista)) return [];
  const items: Item[] = [];
  for (const crudo of lista) {
    const i = (crudo ?? {}) as Record<string, unknown>;
    const descripcion = texto(i.descripcion, 500);
    const cantidad = numero(i.cantidad);
    const importe_unitario = numero(i.importe_unitario);
    if (!descripcion || cantidad <= 0 || importe_unitario < 0) continue;
    items.push({ descripcion, um: texto(i.um, 20) || 'u', cantidad, importe_unitario, subtotal_sospechoso: false });
  }
  // Subtotal disfrazado: su importe es igual a la suma de los renglones anteriores desde el último subtotal.
  let acumulado = 0;
  for (const i of items) {
    const importe = redondear(i.cantidad * i.importe_unitario);
    if (PALABRAS_TOTAL.test(i.descripcion) || (acumulado > 0 && Math.abs(importe - acumulado) <= Math.max(1, acumulado * 0.0005))) {
      i.subtotal_sospechoso = true;
      acumulado = 0;
    } else {
      acumulado = redondear(acumulado + importe);
    }
  }
  return items;
}

export function validar(items: Item[], totalDocumento: number) {
  const total_items = redondear(items.reduce((t, i) => t + i.cantidad * i.importe_unitario, 0));
  const total_documento = totalDocumento > 0 ? redondear(totalDocumento) : null;
  const coincide = total_documento === null ? null : Math.abs(total_items - total_documento) <= total_documento * TOLERANCIA;
  return {
    total_items,
    total_documento,
    coincide,
    diferencia: total_documento === null ? null : redondear(total_items - total_documento),
  };
}

function leerJSON(t: string): Record<string, unknown> | null {
  try {
    return JSON.parse(t.replace(/^```(?:json)?\s*\n/i, '').replace(/\n```\s*$/, ''));
  } catch {
    return null;
  }
}

// deno-lint-ignore no-explicit-any
type Cliente = ReturnType<typeof createClient<any>>;

async function pdfEnBase64(sb: Cliente, path: string): Promise<string> {
  const { data, error } = await sb.storage.from('documentos').download(path);
  if (error || !data) throw new Error('No se encontró el PDF (o no es de tu sector).');
  if (data.size > MAX_BYTES) throw new Error('El PDF pesa más de 15 MB.');
  const bytes = new Uint8Array(await data.arrayBuffer());
  if (String.fromCharCode(...bytes.subarray(0, 5)) !== '%PDF-') throw new Error('El archivo no es un PDF.');
  let binario = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binario);
}

// ------------------------------------------------------------------ función

if (import.meta.main) Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return responder({ error: 'Método no permitido.' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !anon) return responder({ error: 'La función no está configurada.' }, 500);
  const clave = Deno.env.get('GEMINI_API_KEY');
  if (!clave) return responder({ error: 'La lectura con IA no está configurada (falta la clave de Gemini). Cargá el contrato a mano.' }, 503);

  let cuerpo: { accion?: string; path?: string; tipo?: string; total_documento?: number; total_items?: number };
  try {
    cuerpo = await req.json();
  } catch {
    return responder({ error: 'Los datos enviados no son válidos.' }, 400);
  }

  const sb: Cliente = createClient(url, anon, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
  const { data: quien } = await sb.auth.getUser();
  if (!quien.user) return responder({ error: 'Tenés que iniciar sesión.' }, 401);
  const { data: gerencia } = await sb.rpc('es_gerencia');
  if (gerencia !== true) return responder({ error: 'Los contratos los carga gerencia.' }, 403);

  if (!cuerpo.path || (cuerpo.accion !== 'leer' && cuerpo.accion !== 'corregir')) {
    return responder({ error: 'Falta el PDF o la acción.' }, 400);
  }

  let pdf: string;
  try {
    pdf = await pdfEnBase64(sb, cuerpo.path);
  } catch (e) {
    return responder({ error: (e as Error).message }, 400);
  }
  const documento: Parte = { type: 'document', data: pdf, mime_type: 'application/pdf' };

  try {
    if (cuerpo.accion === 'corregir') {
      const doc = numero(cuerpo.total_documento);
      const calc = numero(cuerpo.total_items);
      if (!(doc > 0)) return responder({ error: 'Para corregir hace falta el total del documento.' }, 400);
      const sentido = calc > doc
        ? `La suma de los ítems (${calc}) da MÁS que el total del documento (${doc}): seguramente tomaste subtotales de rubro o grupo como ítems. Sacalos.`
        : `La suma de los ítems (${calc}) da MENOS que el total del documento (${doc}): faltan renglones. Revisá todas las páginas y agregalos.`;
      const respuesta = await gemini(clave, [
        documento,
        { type: 'text', text: `Corrección de los ítems de este documento.\n${sentido}\nLa suma de cantidad × precio unitario tiene que dar ${doc} (±0,5 %). Devolvé la lista completa de ítems corregida.` },
      ], ESQUEMA_CORREGIR);
      const json = leerJSON(respuesta);
      const items = itemsValidos(json?.items);
      if (!items.length) return responder({ error: 'La IA no devolvió ítems legibles. Probá de nuevo o corregilos a mano.' }, 502);
      return responder({ items, validacion: validar(items, doc) });
    }

    const tipo = cuerpo.tipo && TIPOS[cuerpo.tipo] ? cuerpo.tipo : null;
    const pedido = tipo
      ? `El documento es un ${TIPOS[tipo]}: usá tipo "${tipo}".`
      : `Determiná el tipo:\n${Object.entries(TIPOS).map(([k, v]) => `- "${k}": ${v}`).join('\n')}`;
    const respuesta = await gemini(clave, [
      documento,
      { type: 'text', text: `${pedido}\n\nExtraé la cabecera del contrato y todos los ítems.` },
    ], ESQUEMA_LEER);
    const json = leerJSON(respuesta);
    if (!json) return responder({ error: 'La IA devolvió una respuesta que no se pudo leer. Probá de nuevo.' }, 502);

    const items = itemsValidos(json.items);
    const tipoLeido = tipo ?? (TIPOS[texto(json.tipo, 30)] ? texto(json.tipo, 30) : 'obra');
    const datos = {
      tipo: tipoLeido,
      contratista: texto(json.contratista),
      contratista_cuit: texto(json.contratista_cuit, 20),
      obra_servicio: texto(json.obra_servicio),
      emprendimiento: texto(json.emprendimiento),
      ada_numero: texto(json.ada_numero, 40),
      oc_numero: texto(json.oc_numero, 40),
      fecha_inicio: fecha(json.fecha_inicio),
      fecha_fin: fecha(json.fecha_fin),
      plazo: texto(json.plazo, 120),
      condiciones_pago: texto(json.condiciones_pago, 500),
      anticipo_pct: pct(json.anticipo_pct),
      fondo_reparo_pct: pct(json.fondo_reparo_pct),
      items,
    };
    const aviso = tipoLeido === 'certificado_avance'
      ? 'El PDF parece un certificado de avance: se cargan los ítems del contrato, no las mediciones. Elegí si es abono u obra.'
      : !items.length ? 'No se encontraron ítems: cargalos a mano.' : undefined;
    return responder({ datos, validacion: validar(items, numero(json.total_documento)), aviso, modelo: MODELO });
  } catch (e) {
    const motivo = e instanceof SinIA ? e.message : 'la IA falló';
    console.error('leer-contrato-pdf:', e);
    return responder({ error: `No se pudo leer el PDF: ${motivo}. Probá de nuevo en un rato o cargá el contrato a mano.` }, 503);
  }
});
