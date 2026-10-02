// Edge function: informe-inspeccion
// Arma el informe técnico de una inspección y, a pedido, propone las órdenes de trabajo que salen de ella.
//
//   { accion: "informe", inspeccion_id }  → guarda el informe en la inspección y la deja "completado"
//   { accion: "ordenes", inspeccion_id }  → devuelve órdenes propuestas (no crea nada: las revisa una persona)
//   { accion: "reintentar" }              → la llama la tarea periódica de la base (fase 7), sin sesión
//
// El informe sale al instante, armado con una plantilla a partir de lo que cargó el inspector: nunca se queda
// sin informe. La redacción con Gemini (plan gratis de Google AI Studio, que se satura seguido) se intenta
// después de responder y, cuando sale, reemplaza a la plantilla. Si no sale, la tarea periódica la reintenta
// cada vez más espaciado (lo decide la base: tomar_informes_pendientes).
//
// "informe" y "ordenes" leen y escriben con la sesión del usuario: valen la RLS de sector y los permisos de rol.
// "reintentar" usa la clave de servicio, que Supabase inyecta sola, y solo toca los informes que la base le entrega.
//
// Secretos (Supabase → Edge Functions → Secrets):
//   GEMINI_API_KEY   opcional. Sin ella, siempre se usa la plantilla.
//   GEMINI_MODEL     opcional. Por defecto gemini-3.8-flash.
// En el plan gratis, Google puede usar lo enviado para mejorar sus productos.
//
// Deploy:  npx supabase functions deploy informe-inspeccion

import { createClient } from 'npm:@supabase/supabase-js@2';

const MODELO = Deno.env.get('GEMINI_MODEL') || 'gemini-3.8-flash';
const MODELO_RESERVA = 'gemini-3.5-flash-lite';
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const MAX_FOTOS = 10;
const ESPERA_MS = 90_000;
const TOTAL_MS = 125_000;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const responder = (cuerpo: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

type Urgencia = 'urgente' | 'importante' | 'leve' | 'sin_issues';
interface Seccion {
  id: string;
  nombre: string;
  urgencia: Urgencia | null;
  transcripcion: string;
  notas_libres: string;
  fotos: string[];
  completada: boolean;
}
interface Inspeccion {
  id: string;
  establecimiento: string;
  direccion: string | null;
  zona: string | null;
  fecha_inspeccion: string;
  inspector_id: string | null;
  secciones: Seccion[] | null;
  informe_generado: string | null;
  informe_ia_token: string | null;
}
interface Orden {
  titulo: string;
  descripcion: string;
  tipo: string;
  prioridad: string;
  lugar: string;
}

const URGENCIA: Record<Urgencia, string> = { urgente: 'URGENTE', importante: 'IMPORTANTE', leve: 'LEVE', sin_issues: 'SIN PROBLEMAS' };
const ORDEN_URGENCIA: Urgencia[] = ['urgente', 'importante', 'leve', 'sin_issues'];
const TIPOS = ['mantenimiento_preventivo', 'mantenimiento_correctivo', 'instalacion', 'inspeccion', 'reparacion', 'emergencia'];
const PRIORIDADES = ['baja', 'media', 'alta', 'urgente'];

const SISTEMA = `Sos un ingeniero con experiencia en inspección edilicia y mantenimiento de edificios públicos en la Ciudad de Buenos Aires.
Redactás informes técnicos a partir de las notas de campo de un inspector. Escribís en español rioplatense formal, claro y concreto.
Reglas:
- Usá solo lo que está en las notas y en las fotos. No inventes hallazgos, medidas ni ubicaciones. Si algo no se relevó, decilo.
- Las notas vienen de dictado por voz: corregí la redacción sin cambiar el contenido.
- Clasificá cada hallazgo con uno de estos cuatro niveles, escritos así: URGENTE, IMPORTANTE, LEVE, SIN PROBLEMAS. No uses otros niveles ni emojis.
- Devolvé únicamente el informe en Markdown, sin texto antes ni después.`;

const ESTRUCTURA = `Estructura obligatoria del informe:

# INFORME TÉCNICO DE INSPECCIÓN EDILICIA

## 1. Datos generales
Tabla con: Establecimiento, Dirección, Inspector, Fecha, Secciones relevadas, Fotos, Estado general (Bueno / Regular / Deficiente / Crítico).

## 2. Resumen ejecutivo
De 5 a 7 oraciones.

## 3. Detalle por sección relevada
Solo las secciones marcadas como revisadas. Para cada una, un título "### 3.N Nombre" con: Estado, Descripción técnica y Hallazgos numerados, cada uno con su nivel.

## 4. Cuadro consolidado de hallazgos
Tabla: N° | Sección | Problema detectado | Ubicación | Urgencia | Acción requerida. Ordenada de mayor a menor urgencia.

## 5. Plan de acción
Tabla: N° | Problema | Acción | Plazo | Responsable. Solo hallazgos URGENTE e IMPORTANTE. Plazo: Inmediato, 7 días o 30 días.

## 6. Conclusión
Puntaje edilicio de 1 a 10, clasificación (APTO / APTO CON OBSERVACIONES / APTO CONDICIONADO / NO APTO) y fecha sugerida para la próxima inspección.

Al final, una línea de firma con el nombre del inspector y la fecha.`;

const ESQUEMA_ORDENES = {
  type: 'object',
  properties: {
    ordenes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          titulo: { type: 'string', description: 'Título corto de la orden, con el trabajo a hacer' },
          descripcion: { type: 'string', description: 'Qué hay que hacer y por qué, con los datos del hallazgo' },
          tipo: { type: 'string', enum: TIPOS },
          prioridad: { type: 'string', enum: PRIORIDADES },
          lugar: { type: 'string', description: 'Sector o lugar dentro del establecimiento' },
        },
        required: ['titulo', 'descripcion', 'tipo', 'prioridad', 'lugar'],
      },
    },
  },
  required: ['ordenes'],
};

// ------------------------------------------------------------------ Gemini

type Parte = { type: 'text'; text: string } | { type: 'image'; data: string; mime_type: string };

// Motivo por el que no se pudo usar la IA, en palabras para quien usa la app.
// `probarOtro`: el problema puede ser de ese modelo (saturado, sin cupo, no disponible) y vale intentar con el de reserva.
class SinIA extends Error {
  constructor(mensaje: string, readonly probarOtro = false) {
    super(mensaje);
  }
}

// Prueba con el modelo principal y, si está saturado o no disponible, con el de reserva.
async function gemini(clave: string, sistema: string, partes: Parte[], esquema?: Record<string, unknown>): Promise<string> {
  const modelos = [...new Set([MODELO, MODELO_RESERVA])];
  // La función tiene un tiempo de vida limitado: entre los dos modelos no se pasa de TOTAL_MS.
  const limite = Date.now() + TOTAL_MS;
  let ultimo: unknown;
  for (const modelo of modelos) {
    const espera = Math.min(ESPERA_MS, limite - Date.now());
    if (espera < 15_000) break;
    try {
      return await pedirAGemini(modelo, clave, sistema, partes, espera, esquema);
    } catch (e) {
      ultimo = e;
      if (!(e instanceof SinIA) || !e.probarOtro) throw e;
    }
  }
  throw ultimo ?? new SinIA('la IA tardó demasiado en responder');
}

async function pedirAGemini(modelo: string, clave: string, sistema: string, partes: Parte[], esperaMs: number, esquema?: Record<string, unknown>): Promise<string> {
  let r: Response;
  try {
    r = await fetch(GEMINI, {
      method: 'POST',
      headers: { 'x-goog-api-key': clave, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(esperaMs),
      body: JSON.stringify({
        model: modelo,
        system_instruction: sistema,
        input: partes,
        // No hace falta que Google guarde la conversación: cada pedido va completo.
        store: false,
        ...(esquema ? { response_format: { type: 'text', mime_type: 'application/json', schema: esquema } } : {}),
      }),
    });
  } catch {
    throw new SinIA('la IA tardó demasiado en responder');
  }

  if (!r.ok) {
    // El detalle que da Google queda en el registro de la función y, resumido, en el aviso de la app.
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
  if (!texto) throw new SinIA('la IA no devolvió texto');
  return texto;
}

// Gemini recibe las fotos dentro del pedido. Una foto que no se puede bajar se saltea: no frena el informe.
async function fotoEnBase64(url: string): Promise<{ data: string; mime_type: string } | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return null;
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (bytes.length === 0 || bytes.length > 4_000_000) return null;
    let binario = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const tipo = r.headers.get('content-type')?.split(';')[0] ?? '';
    return { data: btoa(binario), mime_type: tipo.startsWith('image/') ? tipo : 'image/jpeg' };
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ plantilla (sin IA)

const celda = (t: string) => t.replace(/\|/g, '/').replace(/\s*\n+\s*/g, ' ').trim();
const notasDe = (s: Seccion) => [s.transcripcion?.trim(), s.notas_libres?.trim()].filter(Boolean).join(' ');
const fechaLarga = (iso: string) => {
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
};

function informePorPlantilla(insp: Inspeccion, inspector: string): string {
  const secciones = insp.secciones ?? [];
  const revisadas = secciones.filter((s) => s.completada);
  const fotos = secciones.reduce((t, s) => t + (s.fotos?.length ?? 0), 0);
  const cuenta = (u: Urgencia) => revisadas.filter((s) => s.urgencia === u).length;
  const conProblema = revisadas
    .filter((s) => s.urgencia && s.urgencia !== 'sin_issues')
    .sort((a, b) => ORDEN_URGENCIA.indexOf(a.urgencia!) - ORDEN_URGENCIA.indexOf(b.urgencia!));
  const urgentes = conProblema.filter((s) => s.urgencia === 'urgente' || s.urgencia === 'importante');
  const estado = cuenta('urgente') > 0 ? 'Crítico' : cuenta('importante') > 0 ? 'Regular' : 'Bueno';
  const clasificacion = cuenta('urgente') > 0 ? 'APTO CONDICIONADO' : conProblema.length > 0 ? 'APTO CON OBSERVACIONES' : 'APTO';
  const sinRevisar = secciones.filter((s) => !s.completada).map((s) => s.nombre);
  const sinNivel = revisadas.filter((s) => !s.urgencia).map((s) => s.nombre);

  const l: string[] = [
    '# INFORME TÉCNICO DE INSPECCIÓN EDILICIA',
    '',
    '_Informe armado automáticamente con las notas del inspector, sin redacción por IA._',
    '',
    '## 1. Datos generales',
    '',
    '| Dato | Valor |',
    '|---|---|',
    `| Establecimiento | ${celda(insp.establecimiento)} |`,
    `| Dirección | ${celda(insp.direccion ?? 'sin dato')} |`,
    `| Zona | ${celda(insp.zona ?? 'sin dato')} |`,
    `| Inspector | ${celda(inspector)} |`,
    `| Fecha | ${fechaLarga(insp.fecha_inspeccion)} |`,
    `| Secciones relevadas | ${revisadas.length} de ${secciones.length} |`,
    `| Fotos | ${fotos} |`,
    `| Estado general | ${estado} |`,
    '',
    '## 2. Resumen',
    '',
    `Se relevaron ${revisadas.length} de ${secciones.length} secciones. Por nivel de urgencia: ${cuenta('urgente')} URGENTE, ${cuenta('importante')} IMPORTANTE, ${cuenta('leve')} LEVE y ${cuenta('sin_issues')} SIN PROBLEMAS.`,
  ];
  if (sinNivel.length > 0) l.push('', `Revisadas sin nivel de urgencia indicado: ${sinNivel.join(', ')}.`);
  if (sinRevisar.length > 0) l.push('', `No se relevaron: ${sinRevisar.join(', ')}.`);

  l.push('', '## 3. Detalle por sección relevada');
  revisadas.forEach((s, i) => {
    l.push('', `### 3.${i + 1} ${s.nombre}`, '', `**Nivel:** ${s.urgencia ? URGENCIA[s.urgencia] : 'sin indicar'}`, '');
    l.push(`**Notas del inspector:** ${s.transcripcion?.trim() || 'sin notas.'}`);
    if (s.notas_libres?.trim()) l.push('', `**Observaciones adicionales:** ${s.notas_libres.trim()}`);
    l.push('', `**Fotos:** ${s.fotos?.length ?? 0}`);
  });

  l.push('', '## 4. Cuadro consolidado de hallazgos', '');
  if (conProblema.length === 0) {
    l.push('No se registraron hallazgos que requieran acción.');
  } else {
    l.push('| N° | Sección | Problema detectado | Urgencia |', '|---|---|---|---|');
    conProblema.forEach((s, i) => l.push(`| ${i + 1} | ${celda(s.nombre)} | ${celda(notasDe(s) || 'Sin descripción')} | ${URGENCIA[s.urgencia!]} |`));
  }

  l.push('', '## 5. Plan de acción', '');
  if (urgentes.length === 0) {
    l.push('No hay hallazgos URGENTE ni IMPORTANTE.');
  } else {
    l.push('| N° | Sección | Problema | Plazo |', '|---|---|---|---|');
    urgentes.forEach((s, i) => l.push(`| ${i + 1} | ${celda(s.nombre)} | ${celda(notasDe(s) || 'Sin descripción')} | ${s.urgencia === 'urgente' ? 'Inmediato' : '7 días'} |`));
  }

  l.push(
    '', '## 6. Conclusión', '',
    `Clasificación según los niveles indicados por el inspector: **${clasificacion}**. El puntaje edilicio y la fecha de la próxima inspección quedan a criterio del inspector.`,
    '', `${inspector} — ${fechaLarga(insp.fecha_inspeccion)}`,
  );
  return l.join('\n');
}

// Una orden por cada sección revisada que el inspector marcó con algún problema.
function ordenesPorPlantilla(insp: Inspeccion): Orden[] {
  const prioridad: Record<string, string> = { urgente: 'urgente', importante: 'alta', leve: 'media' };
  return (insp.secciones ?? [])
    .filter((s) => s.completada && s.urgencia && s.urgencia !== 'sin_issues')
    .sort((a, b) => ORDEN_URGENCIA.indexOf(a.urgencia!) - ORDEN_URGENCIA.indexOf(b.urgencia!))
    .map((s) => {
      const notas = notasDe(s);
      const corto = notas.length > 70 ? `${notas.slice(0, 70).trimEnd()}…` : notas;
      return {
        titulo: corto ? `${s.nombre}: ${corto}` : `${s.nombre}: revisar`,
        descripcion: notas || 'Hallazgo de la inspección sin descripción. Revisar en el lugar.',
        tipo: 'mantenimiento_correctivo',
        prioridad: prioridad[s.urgencia!] ?? 'media',
        lugar: s.nombre,
      };
    });
}

function ordenesValidas(texto: string): Orden[] | null {
  try {
    const crudo = JSON.parse(texto) as { ordenes?: unknown };
    if (!Array.isArray(crudo.ordenes)) return null;
    const txt = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
    return (crudo.ordenes as Record<string, unknown>[])
      .filter((o) => o && txt(o.titulo))
      .map((o) => ({
        titulo: txt(o.titulo), descripcion: txt(o.descripcion), lugar: txt(o.lugar),
        tipo: TIPOS.includes(txt(o.tipo)) ? txt(o.tipo) : 'mantenimiento_correctivo',
        prioridad: PRIORIDADES.includes(txt(o.prioridad)) ? txt(o.prioridad) : 'media',
      }));
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ redacción con IA

// Devuelve el informe redactado, o falla con SinIA y el motivo.
async function redactarConIA(clave: string, insp: Inspeccion, inspector: string): Promise<string> {
  const secciones = insp.secciones ?? [];
  const revisadas = secciones.filter((s) => s.completada);
  const fotos = secciones.flatMap((s) => (s.fotos ?? []).map((f) => ({ seccion: s.nombre, url: f })));
  const notas = secciones.map((s) => [
    `=== ${s.nombre.toUpperCase()} ===`,
    `Estado del relevamiento: ${s.completada ? 'REVISADA' : 'SIN REVISAR'}`,
    `Nivel de urgencia indicado por el inspector: ${s.urgencia ? URGENCIA[s.urgencia] : 'sin indicar'}`,
    `Notas dictadas: ${s.transcripcion?.trim() || '(sin notas)'}`,
    `Observaciones adicionales: ${s.notas_libres?.trim() || '(ninguna)'}`,
    `Fotos tomadas: ${s.fotos?.length ?? 0}`,
  ].join('\n')).join('\n\n');
  const datos = [
    `Establecimiento: ${insp.establecimiento}`,
    `Dirección: ${insp.direccion ?? 'sin dato'}`,
    `Zona: ${insp.zona ?? 'sin dato'}`,
    `Inspector: ${inspector}`,
    `Fecha de la inspección: ${insp.fecha_inspeccion}`,
    `Secciones revisadas: ${revisadas.length} de ${secciones.length}`,
    `Fotos totales: ${fotos.length}${fotos.length > MAX_FOTOS ? ` (se adjuntan las primeras ${MAX_FOTOS})` : ''}`,
  ].join('\n');

  const bajadas = await Promise.all(fotos.slice(0, MAX_FOTOS).map(async (f) => ({ seccion: f.seccion, foto: await fotoEnBase64(f.url) })));
  const partes: Parte[] = [];
  bajadas.forEach((b, i) => {
    if (!b.foto) return;
    partes.push({ type: 'text', text: `Foto ${i + 1} — sección "${b.seccion}":` }, { type: 'image', ...b.foto });
  });
  partes.push({ type: 'text', text: `${datos}\n\nNotas de campo por sección:\n\n${notas}\n\n${ESTRUCTURA}` });

  // A veces el modelo envuelve el Markdown en un bloque de código: se le quita.
  const texto = (await gemini(clave, SISTEMA, partes)).replace(/^```(?:markdown)?\s*\n/i, '').replace(/\n```\s*$/, '').trim();
  if (texto.length < 50) throw new SinIA('la IA devolvió un informe vacío');
  return texto;
}

// deno-lint-ignore no-explicit-any
type Cliente = ReturnType<typeof createClient<any>>;

// Intenta la redacción y, si sale, reemplaza la plantilla. El token asegura que una redacción que llega tarde
// no pise un informe que se pidió después. Si no sale, deja anotado el motivo y el pendiente sigue en pie.
async function intentarIA(sb: Cliente, clave: string, insp: Inspeccion, inspector: string, token: string): Promise<boolean> {
  try {
    const informe = await redactarConIA(clave, insp, inspector);
    const { data, error } = await sb.from('inspecciones')
      .update({ informe_generado: informe, informe_origen: 'ia', informe_ia_pendiente: false, informe_ia_motivo: null })
      .eq('id', insp.id).eq('informe_ia_token', token).select('id');
    if (error) console.error(`No se pudo guardar el informe con IA de ${insp.id}: ${error.message}`);
    return !error && (data?.length ?? 0) > 0;
  } catch (e) {
    const motivo = e instanceof SinIA ? e.message : 'la IA falló';
    await sb.from('inspecciones').update({ informe_ia_motivo: motivo }).eq('id', insp.id).eq('informe_ia_token', token);
    return false;
  }
}

// Deja un trabajo corriendo después de responder (Supabase lo mantiene vivo hasta que termina).
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;
function enSegundoPlano(p: Promise<unknown>) {
  const seguro = p.catch((e) => console.error('Falló un trabajo en segundo plano:', e));
  if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(seguro);
}

// ------------------------------------------------------------------ función

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return responder({ error: 'Método no permitido.' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !anon) return responder({ error: 'La función no está configurada.' }, 500);
  const clave = Deno.env.get('GEMINI_API_KEY');

  let cuerpo: { accion?: string; inspeccion_id?: string };
  try {
    cuerpo = await req.json();
  } catch {
    return responder({ error: 'Los datos enviados no son válidos.' }, 400);
  }

  // ------------------------------------------------------------ reintentos (tarea periódica de la base)
  // No lleva sesión ni devuelve datos. Qué informes toca y cada cuánto lo decide la base
  // (tomar_informes_pendientes): llamarla de más no hace nada.
  if (cuerpo.accion === 'reintentar') {
    const servicio = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!clave || !servicio) return responder({ aceptado: false });
    const admin: Cliente = createClient(url, servicio, { auth: { persistSession: false } });
    enSegundoPlano((async () => {
      const { data, error } = await admin.rpc('tomar_informes_pendientes', { p_max: 3 });
      if (error) {
        console.error(`No se pudieron tomar los informes pendientes: ${error.message}`);
        return;
      }
      await Promise.all(((data ?? []) as Inspeccion[]).map(async (insp) => {
        if (!insp.informe_ia_token) return;
        const { data: perfil } = insp.inspector_id
          ? await admin.from('perfiles').select('nombre').eq('id', insp.inspector_id).maybeSingle()
          : { data: null };
        const salio = await intentarIA(admin, clave, insp, perfil?.nombre ?? 'Inspector', insp.informe_ia_token);
        console.log(`Reintento de informe ${insp.id}: ${salio ? 'redactado con IA' : 'todavía no'}`);
      }));
    })());
    return responder({ aceptado: true }, 202);
  }

  const sb: Cliente = createClient(url, anon, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
  const { data: quien } = await sb.auth.getUser();
  if (!quien.user) return responder({ error: 'Tenés que iniciar sesión.' }, 401);

  if (!cuerpo.inspeccion_id || (cuerpo.accion !== 'informe' && cuerpo.accion !== 'ordenes')) {
    return responder({ error: 'Falta la inspección o la acción.' }, 400);
  }

  // Con la sesión del usuario: si la inspección es de otro sector, para él no existe.
  const { data } = await sb.from('inspecciones').select('*').eq('id', cuerpo.inspeccion_id).maybeSingle();
  const insp = data as Inspeccion | null;
  if (!insp) return responder({ error: 'La inspección no existe o no es de tu sector.' }, 404);
  const { data: perfil } = await sb.from('perfiles').select('nombre').eq('id', insp.inspector_id ?? quien.user.id).maybeSingle();
  const inspector = perfil?.nombre ?? 'Inspector';

  // ------------------------------------------------------------ órdenes propuestas
  if (cuerpo.accion === 'ordenes') {
    if (!insp.informe_generado) return responder({ error: 'Primero generá el informe.' }, 400);
    let motivo = 'la IA no está configurada';
    if (clave) {
      try {
        const texto = await gemini(
          clave,
          'Convertís los hallazgos de un informe de inspección edilicia en órdenes de trabajo. Una orden por trabajo concreto. ' +
            'Solo hallazgos que requieren una acción. Prioridad: URGENTE → urgente, IMPORTANTE → alta, LEVE → media o baja. No inventes trabajos que el informe no menciona.',
          // El informe va completo: recortarlo haría perder hallazgos.
          [{ type: 'text', text: `Establecimiento: ${insp.establecimiento}\n\nInforme:\n\n${insp.informe_generado}` }],
          ESQUEMA_ORDENES,
        );
        const ordenes = ordenesValidas(texto);
        if (ordenes) return responder({ ordenes, origen: 'ia' });
        motivo = 'la IA devolvió una respuesta que no se pudo leer';
      } catch (e) {
        motivo = e instanceof SinIA ? e.message : 'la IA falló';
      }
    }
    return responder({
      ordenes: ordenesPorPlantilla(insp), origen: 'plantilla',
      aviso: `Órdenes armadas sin IA (${motivo}): una por cada sección con problemas. Revisalas antes de crearlas.`,
    });
  }

  // ------------------------------------------------------------ informe
  // Sale ya mismo con la plantilla. La redacción con IA se intenta después de responder y, si el servicio
  // está saturado, la sigue intentando la tarea periódica de la base hasta que salga.
  if ((insp.secciones ?? []).every((s) => !s.completada)) {
    return responder({ error: 'Marcá al menos una sección como revisada antes de generar el informe.' }, 400);
  }

  const informe = informePorPlantilla(insp, inspector);
  const token = crypto.randomUUID();
  const pendiente = !!clave;
  const { error: errorGuardar } = await sb.from('inspecciones').update({
    informe_generado: informe, estado: 'completado', informe_origen: 'plantilla',
    informe_ia_pendiente: pendiente, informe_ia_intentos: 0, informe_ia_token: token, informe_ia_motivo: null,
    informe_ia_proximo: pendiente ? new Date(Date.now() + 10 * 60_000).toISOString() : null,
  }).eq('id', insp.id);
  if (errorGuardar) return responder({ error: errorGuardar.message }, 500);

  if (pendiente) enSegundoPlano(intentarIA(sb, clave, insp, inspector, token));
  return responder({ informe, origen: 'plantilla', pendiente });
});
