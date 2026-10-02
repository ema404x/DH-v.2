// Migración DH1 v1 (Base44) → DH1 v2 (Supabase). Corre con Deno.
//
//   deno run -A migracion/migrar.ts                      simulacro: lee, transforma y reporta. NO escribe.
//   deno run -A migracion/migrar.ts --apply              escribe en Supabase.
//   deno run -A migracion/migrar.ts --solo=ubicaciones   una sola entidad (sectores, perfiles, ubicaciones, activos,
//                                                        plantillas, ots, certificados, rutinas, pendientes,
//                                                        emergencias, calefaccion, inspecciones, gente, obras, panol, control, admin)
//   --desde=<carpeta>          lee <Entidad>.json de una carpeta en vez de la API de Base44
//   --sector-de=Entidad:clave  sector para una entidad que en la v1 no lo tiene (LocationQR, OTTemplate).
//                              Es una decisión explícita, por entidad, y queda en el reporte.
//
// Reglas (ver CLAUDE.md §6):
//   · Nada sin sector se carga. No hay sector por defecto: lo que no tiene sector se reporta y queda afuera.
//   · Re-ejecutable: todo va por upsert sobre id_origen.
//   · Los certificados entran como historia, con sus valores, sin recalcular.
//   · Los perfiles no se crean acá (necesitan cuenta de Auth): quedan en perfiles_pendientes.json para invitarlos.
//
// Variables de entorno (ver migracion/README.md). La service_role key se usa SOLO en este script.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

type Reg = Record<string, any>;

// ------------------------------------------------------------------ argumentos
const args = Deno.args;
const APPLY = args.includes('--apply');
const SOLO = args.find((a) => a.startsWith('--solo='))?.split('=')[1] ?? null;
const DESDE = args.find((a) => a.startsWith('--desde='))?.split('=')[1] ?? null;
const SECTOR_DE = new Map<string, string>(
  args.filter((a) => a.startsWith('--sector-de=')).map((a) => a.slice('--sector-de='.length).split(':') as [string, string]),
);
const PASOS = ['sectores', 'perfiles', 'ubicaciones', 'activos', 'plantillas', 'ots', 'certificados',
  'rutinas', 'pendientes', 'emergencias', 'calefaccion', 'inspecciones', 'gente', 'obras', 'panol', 'control', 'admin'];
if (SOLO && !PASOS.includes(SOLO)) {
  console.error(`--solo=${SOLO} no existe. Opciones: ${PASOS.join(', ')}`);
  Deno.exit(1);
}
const corre = (paso: string) => !SOLO || SOLO === paso;

const AQUI = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SALIDA = `${AQUI}salida`;

// ------------------------------------------------------------------ origen: Base44
const B44_APP = Deno.env.get('BASE44_APP_ID');
const B44_KEY = Deno.env.get('BASE44_API_KEY');
const B44_URL = Deno.env.get('BASE44_API_URL') ?? 'https://app.base44.com/api/apps';

async function leerEntidad(entidad: string): Promise<Reg[]> {
  if (DESDE) {
    try {
      const datos = JSON.parse(await Deno.readTextFile(`${DESDE}/${entidad}.json`));
      return Array.isArray(datos) ? datos : datos.data ?? datos.items ?? [];
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) {
        console.warn(`  (no está ${entidad}.json en ${DESDE}: se toma como vacía)`);
        return [];
      }
      throw e;
    }
  }
  if (!B44_APP || !B44_KEY) {
    throw new Error('Faltan BASE44_APP_ID y BASE44_API_KEY (o usá --desde=<carpeta> con los JSON exportados).');
  }
  const todos: Reg[] = [];
  const LOTE = 500;
  for (let salto = 0; ; salto += LOTE) {
    const r = await fetch(`${B44_URL}/${B44_APP}/entities/${entidad}?limit=${LOTE}&skip=${salto}`, {
      headers: { api_key: B44_KEY, 'Content-Type': 'application/json' },
    });
    if (!r.ok) throw new Error(`Base44 respondió ${r.status} al leer ${entidad}: ${await r.text()}`);
    const lote = (await r.json()) as Reg[];
    todos.push(...lote);
    if (lote.length < LOTE) break;
  }
  return todos;
}

// ------------------------------------------------------------------ destino: Supabase
const SB_URL = Deno.env.get('SUPABASE_URL');
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
let sb: SupabaseClient | null = null;
if (SB_URL && SB_KEY) {
  sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
} else if (APPLY) {
  console.error('Para --apply hacen falta SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.');
  Deno.exit(1);
}

async function subir(tabla: string, filas: Reg[], onConflict = 'id_origen'): Promise<void> {
  if (!APPLY || !sb || filas.length === 0) return;
  for (let i = 0; i < filas.length; i += 500) {
    // defaultToNull: false → una columna que falta en alguna fila toma su valor por defecto, no null.
    const { error } = await sb.from(tabla).upsert(filas.slice(i, i + 500), { onConflict, defaultToNull: false });
    if (error) throw new Error(`Error al cargar ${tabla}: ${error.message}`);
  }
}

// id_origen → id de v2. En simulacro (o si la tabla está vacía) devuelve ids de mentira: alcanzan para contar.
async function mapaIds(tabla: string, origenes: string[]): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  if (sb) {
    for (let desde = 0; ; desde += 1000) {
      const { data, error } = await sb.from(tabla).select('id, id_origen').not('id_origen', 'is', null).range(desde, desde + 999);
      if (error) throw new Error(`Error al leer ${tabla}: ${error.message}`);
      for (const f of data ?? []) mapa.set(f.id_origen, f.id);
      if (!data || data.length < 1000) break;
    }
  }
  if (!APPLY) for (const o of origenes) if (!mapa.has(o)) mapa.set(o, `simulacro:${o}`);
  return mapa;
}

// ------------------------------------------------------------------ utilidades
const norm = (s: unknown) =>
  String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
const texto = (s: unknown) => (String(s ?? '').trim() === '' ? null : String(s).trim());
const numero = (n: unknown) => (n === null || n === undefined || n === '' || Number.isNaN(Number(n)) ? null : Number(n));
const fecha = (f: unknown) => (texto(f) ? String(f).slice(0, 10) : null);
const enLista = <T extends string>(v: unknown, lista: readonly T[], otro: T): T => (lista.includes(v as T) ? (v as T) : otro);

interface Resumen {
  origen: number;
  cargar: number;
  sinSector: number;
  descartados: number;
  avisos: string[];
}
const reporte: Record<string, Resumen> = {};
const nuevoResumen = (paso: string, origen: number): Resumen => (reporte[paso] = { origen, cargar: 0, sinSector: 0, descartados: 0, avisos: [] });
function aviso(r: Resumen, mensaje: string) {
  if (r.avisos.length < 200) r.avisos.push(mensaje);
}

// ------------------------------------------------------------------ 1. sectores
const sectores = new Map<string, string>(); // clave → id v2

async function migrarSectores() {
  const origen = await leerEntidad('Sector');
  const r = nuevoResumen('sectores', origen.length);
  const filas = origen
    .filter((s) => texto(s.clave) && texto(s.nombre))
    .map((s) => ({
      clave: norm(s.clave).replace(/[^a-z0-9_]/g, '_'),
      nombre: s.nombre,
      descripcion: texto(s.descripcion),
      color: texto(s.color),
      icono: texto(s.icono),
      config: s.config ?? {},
      activo: s.activo !== false,
      orden: numero(s.orden) ?? 0,
    }));
  r.cargar = filas.length;
  r.descartados = origen.length - filas.length;
  if (APPLY && sb && corre('sectores')) {
    const { error } = await sb.from('sectores').upsert(filas, { onConflict: 'clave' });
    if (error) throw new Error(`Error al cargar sectores: ${error.message}`);
  }
  if (sb) {
    const { data, error } = await sb.from('sectores').select('id, clave');
    if (error) throw new Error(`Error al leer sectores: ${error.message}`);
    for (const s of data ?? []) sectores.set(s.clave, s.id);
  }
  if (!APPLY) for (const f of filas) if (!sectores.has(f.clave)) sectores.set(f.clave, `simulacro:${f.clave}`);
}

// Sector de un registro de la v1. Sin sector → null: el registro se reporta y NO se carga.
function sectorDe(entidad: string, reg: Reg): string | null {
  const clave = texto(reg.sector_id) ? norm(reg.sector_id) : SECTOR_DE.get(entidad) ?? null;
  return clave ? sectores.get(clave) ?? null : null;
}

// ------------------------------------------------------------------ 2. perfiles
const perfilPorEmail = new Map<string, string>();
const perfilPorNombre = new Map<string, string>();
const sectorDePerfil = new Map<string, string>(); // perfil v2 → su sector
const ROL_V2: Record<string, string> = {
  admin: 'admin', gerente: 'gerente', gerencia: 'gerente', administrativo: 'gerente',
  jefe_sitio: 'jefe_sitio', 'jefe de sitio': 'jefe_sitio', inspector: 'inspector',
};

function buscarPerfil(...pistas: unknown[]): string | null {
  for (const p of pistas) {
    const n = norm(p);
    if (!n) continue;
    const id = perfilPorEmail.get(n) ?? perfilPorNombre.get(n);
    if (id) return id;
  }
  return null;
}

async function migrarPerfiles() {
  const empleados = await leerEntidad('Employee');
  const r = nuevoResumen('perfiles', empleados.length);

  const existentes = new Map<string, Reg>();
  if (sb) {
    const { data, error } = await sb.from('perfiles').select('id, email, nombre, id_origen, sector_id');
    if (error) throw new Error(`Error al leer perfiles: ${error.message}`);
    for (const p of data ?? []) {
      existentes.set(norm(p.email), p);
      perfilPorEmail.set(norm(p.email), p.id);
      perfilPorNombre.set(norm(p.nombre), p.id);
      sectorDePerfil.set(p.id, p.sector_id);
    }
  }

  const pendientes: Reg[] = [];
  for (const e of empleados) {
    if (e.status === 'inactivo') { r.descartados++; continue; }
    const email = norm(e.email);
    const sector = sectorDe('Employee', e);
    if (!email) { r.descartados++; aviso(r, `${e.full_name}: sin correo, no puede tener usuario.`); continue; }
    if (!sector) { r.sinSector++; aviso(r, `${e.full_name} (${email}): sin sector.`); continue; }
    const ya = existentes.get(email);
    if (ya) {
      // Ya tiene usuario en v2: solo se deja la referencia al origen, y su nombre sirve para enganchar las OTs.
      perfilPorNombre.set(norm(e.full_name), ya.id);
      if (APPLY && sb && corre('perfiles') && !ya.id_origen) {
        await sb.from('perfiles').update({ id_origen: e.id }).eq('id', ya.id);
      }
      r.cargar++;
    } else {
      pendientes.push({
        email, nombre: e.full_name, rol: ROL_V2[norm(e.role)] ?? 'operario', rol_v1: e.role,
        sector_id: sector, sector_clave: norm(e.sector_id), id_origen: e.id,
      });
    }
  }
  if (corre('perfiles')) {
    await Deno.writeTextFile(`${AQUI}perfiles_pendientes.json`, JSON.stringify(pendientes, null, 2));
    aviso(r, `${pendientes.length} empleados sin usuario en v2: quedaron en migracion/perfiles_pendientes.json para invitarlos.`);
  }
}

// ------------------------------------------------------------------ 3. ubicaciones
let ubicaciones = new Map<string, string>(); // id_origen → id v2
const ubicacionPorNombre = new Map<string, string>(); // sector|nombre → id_origen

// Responsable (jefe de sitio o inspector): por id si ya tiene usuario en v2; si no, se conserva el nombre.
const responsable = (nombre: unknown) => {
  const id = buscarPerfil(nombre);
  return { id, nombre: id ? null : texto(nombre) };
};

async function migrarUbicaciones() {
  const domicilios = await leerEntidad('Direccion');
  const escuelas = await leerEntidad('LocationData');
  const qrs = await leerEntidad('LocationQR');
  const r = nuevoResumen('ubicaciones', domicilios.length + escuelas.length + qrs.length);
  const filas: Reg[] = [];

  // Direcciones primero: son el nivel de arriba (la v1 no les ponía sector: --sector-de=Direccion:<clave>).
  const filasDir: Reg[] = [];
  for (const d of domicilios) {
    const sector = sectorDe('Direccion', d);
    if (!sector) { r.sinSector++; aviso(r, `Direccion ${d.direccion ?? d.id}: sin sector.`); continue; }
    if (!texto(d.direccion)) { r.descartados++; continue; }
    const jefe = responsable(d.jefe_sitio);
    const insp = responsable(d.inspector);
    filasDir.push({
      id_origen: d.id, sector_id: sector, direccion: d.direccion, zona: texto(d.comuna),
      jefe_sitio_id: jefe.id, jefe_sitio_nombre: jefe.nombre, inspector_id: insp.id, inspector_nombre: insp.nombre,
      m2: numero(d.m2), sup: numero(d.sup), activa: d.estado !== 'inactivo', notas: texto(d.notas),
    });
  }
  if (corre('ubicaciones')) await subir('direcciones', filasDir);
  const direcciones = await mapaIds('direcciones', filasDir.map((f) => f.id_origen));

  for (const u of escuelas) {
    const sector = sectorDe('LocationData', u);
    if (!sector) { r.sinSector++; aviso(r, `LocationData ${u.establecimiento ?? u.id}: sin sector.`); continue; }
    if (!texto(u.establecimiento)) { r.descartados++; continue; }
    const jefe = responsable(u.jefe_sitio);
    const insp = responsable(u.inspector);
    filas.push({
      id_origen: u.id, origen_entidad: 'LocationData', sector_id: sector,
      nombre: u.establecimiento, codigo: texto(u.ubic_tecnica), zona: texto(u.comuna), m2: numero(u.m2),
      lat: numero(u.gps_latitude), lng: numero(u.gps_longitude), activa: u.estado !== 'inactivo',
      direccion_id: direcciones.get(u.direccion_id) ?? null, elem_pep: texto(u.elem_pep),
      jefe_sitio_id: jefe.id, jefe_sitio_nombre: jefe.nombre, inspector_id: insp.id, inspector_nombre: insp.nombre,
      datos: {},
    });
    ubicacionPorNombre.set(`${sector}|${norm(u.establecimiento)}`, u.id);
  }
  for (const u of qrs) {
    // LocationQR no tenía sector en la v1: hay que indicarlo con --sector-de=LocationQR:<clave>.
    const sector = sectorDe('LocationQR', u);
    if (!sector) { r.sinSector++; aviso(r, `LocationQR ${u.name ?? u.id}: sin sector.`); continue; }
    if (!texto(u.name)) { r.descartados++; continue; }
    filas.push({
      id_origen: u.id, origen_entidad: 'LocationQR', sector_id: sector,
      nombre: u.name, codigo: null, zona: null, m2: null, direccion: texto(u.address), descripcion: texto(u.description),
      lat: numero(u.latitude), lng: numero(u.longitude), activa: u.is_active !== false, jefe_sitio_id: null,
      datos: { proyecto: u.project_name ?? null, cuadrilla: u.assigned_employees ?? [] },
    });
    ubicacionPorNombre.set(`${sector}|${norm(u.name)}`, u.id);
  }
  r.cargar = filasDir.length + filas.length;
  // PostgREST pide las mismas columnas en todo el lote.
  const completas = filas.map((f) => ({
    direccion: null, descripcion: null, direccion_id: null, elem_pep: null, jefe_sitio_nombre: null, inspector_id: null, inspector_nombre: null, ...f,
  }));
  if (corre('ubicaciones')) await subir('ubicaciones', completas);
  ubicaciones = await mapaIds('ubicaciones', filas.map((f) => f.id_origen));
}

// ------------------------------------------------------------------ 4. activos
let activos = new Map<string, string>();
const activoPorNombre = new Map<string, string>(); // sector|nombre → id_origen

const TIPOS_ACTIVO = ['equipo_electrico', 'equipo_mecanico', 'instalacion_hvac', 'instalacion_sanitaria', 'estructura', 'vehiculo',
  'herramienta', 'sistemas_informaticos', 'mobiliario', 'seguridad', 'otro'] as const;

async function migrarActivos() {
  const origen = await leerEntidad('Asset');
  const r = nuevoResumen('activos', origen.length);
  const filas: Reg[] = [];
  for (const a of origen) {
    const sector = sectorDe('Asset', a);
    if (!sector) { r.sinSector++; aviso(r, `Asset ${a.name ?? a.id}: sin sector.`); continue; }
    if (!texto(a.name)) { r.descartados++; continue; }
    const lugar = ubicacionPorNombre.get(`${sector}|${norm(a.sede)}`) ?? ubicacionPorNombre.get(`${sector}|${norm(a.location)}`);
    if (!lugar && (texto(a.sede) || texto(a.location))) {
      aviso(r, `Asset ${a.name}: la ubicación "${a.sede ?? a.location}" no coincide con ninguna ubicación migrada; queda sin ubicación (el texto va a "área").`);
    }
    const frecuencia = numero(a.maintenance_frequency_days);
    filas.push({
      id_origen: a.id, sector_id: sector, nombre: a.name, codigo: texto(a.code),
      tipo: enLista(a.type, TIPOS_ACTIVO, 'otro'), marca: texto(a.brand), modelo: texto(a.model), numero_serie: texto(a.serial_number),
      ubicacion_id: lugar ? ubicaciones.get(lugar) ?? null : null,
      area: [a.sede, a.area, a.location].map(texto).filter(Boolean).join(' · ') || null,
      estado: enLista(a.status, ['operativo', 'en_mantenimiento', 'fuera_de_servicio', 'baja'] as const, 'operativo'),
      criticidad: enLista(a.criticality, ['baja', 'media', 'alta', 'critica'] as const, 'media'),
      fecha_compra: fecha(a.purchase_date), garantia_hasta: fecha(a.warranty_expiry),
      ultimo_mantenimiento: fecha(a.last_maintenance), proximo_mantenimiento: fecha(a.next_maintenance),
      frecuencia_mant_dias: frecuencia && frecuencia > 0 ? Math.round(frecuencia) : null,
      costo_compra: numero(a.purchase_cost), responsable_id: buscarPerfil(a.jefe_sitio),
      documentos: a.documents ?? [], notas: texto(a.notes),
    });
    activoPorNombre.set(`${sector}|${norm(a.name)}`, a.id);
  }
  r.cargar = filas.length;
  if (corre('activos')) await subir('activos', filas);
  activos = await mapaIds('activos', filas.map((f) => f.id_origen));
}

// ------------------------------------------------------------------ 5. plantillas
const TIPOS_OT = ['mantenimiento_preventivo', 'mantenimiento_correctivo', 'instalacion', 'inspeccion', 'reparacion', 'emergencia'] as const;
const PRIORIDADES = ['baja', 'media', 'alta', 'urgente'] as const;
const tareas = (lista: unknown) =>
  (Array.isArray(lista) ? lista : [])
    .filter((t: Reg) => texto(t.task))
    .map((t: Reg, i: number) => ({ id: String(t.id ?? i + 1), tarea: t.task, hecho: t.completed === true, nota: texto(t.notes) ?? undefined, foto_url: texto(t.photo_url) ?? undefined }));

async function migrarPlantillas() {
  const origen = await leerEntidad('OTTemplate');
  const r = nuevoResumen('plantillas', origen.length);
  const filas: Reg[] = [];
  for (const p of origen) {
    // OTTemplate no tenía sector en la v1: --sector-de=OTTemplate:<clave>.
    const sector = sectorDe('OTTemplate', p);
    if (!sector) { r.sinSector++; aviso(r, `OTTemplate ${p.nombre ?? p.id}: sin sector.`); continue; }
    filas.push({
      id_origen: p.id, sector_id: sector, nombre: p.nombre ?? p.title, titulo: p.title ?? p.nombre,
      tipo: enLista(p.type, TIPOS_OT, 'mantenimiento_correctivo'), prioridad: enLista(p.priority, PRIORIDADES, 'media'),
      descripcion: texto(p.description), horas_estimadas: numero(p.estimated_hours),
      checklist: tareas(p.checklist).map((t) => ({ ...t, hecho: false })), requiere_fotos: p.require_photos === true,
    });
  }
  r.cargar = filas.length;
  if (corre('plantillas')) await subir('plantillas_ot', filas);
}

// ------------------------------------------------------------------ 6. órdenes de trabajo
let otsMigradas = new Map<string, string>(); // id_origen → id v2 (lo usan rutinas, emergencias y horas)
const otSector = new Map<string, string>(); // id_origen → sector (lo usan las horas)
const ESTADOS_OT =['pendiente', 'asignada', 'en_progreso', 'pendiente_validacion', 'completada', 'cancelada'] as const;

async function migrarOTs() {
  const origen = await leerEntidad('WorkOrder');
  const r = nuevoResumen('ots', origen.length);
  const filas: Reg[] = [];
  const fotos: Reg[] = [];
  let sinAsignar = 0;
  let enObra = 0;

  for (const o of origen) {
    const sector = sectorDe('WorkOrder', o);
    if (!sector) { r.sinSector++; aviso(r, `WorkOrder ${o.code ?? o.id} "${o.title}": sin sector.`); continue; }
    if (!texto(o.title)) { r.descartados++; continue; }

    // La v1 vinculaba al operario por nombre (assigned_name). Se busca por correo y por nombre;
    // lo que no coincide queda sin asignar y se reporta.
    const asignado = buscarPerfil(o.assigned_to, o.assigned_name);
    if (!asignado && (texto(o.assigned_to) || texto(o.assigned_name))) {
      sinAsignar++;
      aviso(r, `OT ${o.code ?? o.id}: "${o.assigned_name ?? o.assigned_to}" no tiene usuario en v2; queda sin asignar.`);
    }
    // "obra" era un estado de la v1 que en v2 no existe: pasa a en_progreso.
    if (o.status === 'obra') enObra++;
    let estado = o.status === 'obra' ? 'en_progreso' : enLista(o.status, ESTADOS_OT, 'pendiente');
    if (estado === 'asignada' && !asignado) estado = 'pendiente';

    const activo = activoPorNombre.get(`${sector}|${norm(o.asset_name)}`);
    otSector.set(o.id, sector);
    filas.push({
      id_origen: o.id, sector_id: sector, titulo: o.title, descripcion: texto(o.description),
      // Se conserva el código de la v1; si no tenía, uno estable derivado del id (la migración es re-ejecutable).
      codigo: texto(o.code) ?? `V1-${String(o.id).slice(-8)}`,
      tipo: enLista(o.type, TIPOS_OT, 'mantenimiento_correctivo'), prioridad: enLista(o.priority, PRIORIDADES, 'media'), estado,
      ubicacion_id: ubicaciones.get(o.location_qr_id) ?? null,
      activo_id: activo ? activos.get(activo) ?? null : null,
      asignado_a: asignado, fecha_programada: fecha(o.scheduled_date),
      horas_estimadas: numero(o.estimated_hours), horas_reales: numero(o.actual_hours),
      checklist: tareas(o.checklist), requiere_fotos: o.require_photos === true,
      motivos_incompleto: (o.motivos_incompleto ?? []).filter((m: Reg) => texto(m.texto)).map((m: Reg, i: number) => ({ id: String(m.id ?? i + 1), texto: m.texto })),
      materiales_faltantes: (o.materiales_faltantes ?? []).map((m: Reg) => ({ material: m.material_name, cantidad: numero(m.cantidad_faltante), motivo: texto(m.motivo) })),
      notas: [texto(o.notes), !ubicaciones.get(o.location_qr_id) && texto(o.location) ? `Ubicación en la v1: ${o.location}` : null].filter(Boolean).join('\n') || null,
      rechazo_comentario: texto(o.rechazo_comentario),
      fecha_inicio_real: texto(o.fecha_inicio_real), fecha_validacion: texto(o.fecha_validacion),
      fecha_fin_real: estado === 'completada' || estado === 'pendiente_validacion' ? texto(o.completed_date) : null,
      validado_por: buscarPerfil(o.validado_por),
      gps_lat: numero(o.gps_latitude), gps_lng: numero(o.gps_longitude), gps_precision: numero(o.gps_accuracy),
      origen: 'migracion', created_at: texto(o.created_date) ?? new Date().toISOString(),
    });
    (o.photos ?? []).forEach((url: string, i: number) => {
      if (texto(url)) fotos.push({ id_origen: `${o.id}:${i}`, sector_id: sector, ot_origen: o.id, path: url, url });
    });
  }
  r.cargar = filas.length;
  if (enObra) aviso(r, `${enObra} órdenes en estado "obra" pasan a "en_progreso".`);
  if (sinAsignar) aviso(r, `${sinAsignar} órdenes quedan sin asignar porque su operario no tiene usuario en v2.`);
  if (!corre('ots')) {
    otsMigradas = await mapaIds('ordenes_trabajo', filas.map((f) => f.id_origen));
    return;
  }

  await subir('ordenes_trabajo', filas);
  const ots = await mapaIds('ordenes_trabajo', filas.map((f) => f.id_origen));
  otsMigradas = ots;
  await subir('ot_fotos', fotos.map(({ ot_origen, ...f }) => ({ ...f, ot_id: ots.get(ot_origen) })).filter((f) => f.ot_id));
  aviso(r, `${fotos.length} fotos referenciadas (siguen alojadas en Base44: conviene copiarlas al bucket antes de dar de baja la v1).`);
}

// ------------------------------------------------------------------ 7. certificados (historia, sin recalcular)
async function migrarCertificados() {
  const origen = await leerEntidad('Certificado');
  const r = nuevoResumen('certificados', origen.length);
  let borradores = 0;
  let informes = 0;
  // En orden de número: los contratos y sus ítems se van armando con el primero de cada ADA/OC.
  origen.sort((a, b) => (numero(a.numero) ?? 0) - (numero(b.numero) ?? 0));

  for (const c of origen) {
    const sector = sectorDe('Certificado', c);
    if (!sector) { r.sinSector++; aviso(r, `Certificado ${c.id} (${c.contratista} N° ${c.numero}): sin sector.`); continue; }
    if (c.tipo === 'informe') { informes++; r.descartados++; continue; }
    if (c.estado !== 'emitido' && c.estado !== 'aprobado') { borradores++; r.descartados++; continue; }

    const paquete = {
      sector_id: sector, id_origen: c.id, tipo: c.tipo ?? 'abono_mensual', estado: c.estado, numero: numero(c.numero),
      contratista: c.contratista, obra_servicio: c.obra_servicio ?? c.emprendimiento, emprendimiento: c.emprendimiento,
      ada_numero: c.ada_numero, oc_numero: c.oc_numero, fecha_inicio: fecha(c.fecha_inicio), fecha_fin: fecha(c.fecha_finalizacion),
      plazo: c.plazo_obra, condiciones_pago: c.condiciones_pago, periodo: c.mes_periodo, fecha_certificado: fecha(c.fecha_certificado),
      numero_recepcion: c.numero_recepcion, notas: c.notas, subtotal: numero(c.subtotal),
      anticipo_pct: numero(c.anticipo_pct) ?? 0, anticipo_monto: numero(c.anticipo_monto_manual),
      fondo_reparo_pct: numero(c.fondo_reparo_pct) ?? 0, fondo_reparo_monto: numero(c.fondo_reparo_monto_manual),
      fondo_reparo_label: c.fondo_reparo_label, fondo_reparo_aplicar: c.fondo_reparo_aplicar === true,
      porcentaje_avance: numero(c.porcentaje_avance), aprobado_at: texto(c.fecha_aprobacion),
      firma_url: texto(c.firma_gerente_url), pdf_url: texto(c.pdf_url), ada_pdf_url: texto(c.ada_pdf_url),
      created_at: texto(c.created_date), items: c.items ?? [], original: c,
    };
    if (!texto(c.contratista) || paquete.numero === null) {
      r.descartados++;
      aviso(r, `Certificado ${c.id}: sin contratista o sin número, no se importa.`);
      continue;
    }
    if (APPLY && sb && corre('certificados')) {
      const { error } = await sb.rpc('importar_certificado_historico', { p: paquete });
      if (error) { r.descartados++; aviso(r, error.message); continue; }
    }
    r.cargar++;
  }
  if (borradores) aviso(r, `${borradores} certificados en borrador no se migran (se rehacen en v2 desde el contrato).`);
  if (informes) aviso(r, `${informes} certificados de tipo "informe" no se migran: en v2 no son certificados de avance.`);
}

// ------------------------------------------------------------------ 8. rutinas
const CICLOS = ['Semanal', 'Quincenal', 'Mensual', 'Bimestral', 'Trimestral', 'Cuatrimestral', 'Semestral', 'Anual', 'Bienal'] as const;
const ubicacionDe = (sector: string, ...nombres: unknown[]) => {
  for (const n of nombres) {
    const origen = ubicacionPorNombre.get(`${sector}|${norm(n)}`);
    if (origen && ubicaciones.get(origen)) return ubicaciones.get(origen)!;
  }
  return null;
};

async function migrarRutinas() {
  const catalogo = await leerEntidad('RutinaCatalogo');
  const edificios = await leerEntidad('Edificio');
  const asignaciones = await leerEntidad('RutinaEdificio');
  const ordenes = await leerEntidad('OrdenRutina');
  const r = nuevoResumen('rutinas', catalogo.length + asignaciones.length + ordenes.length);

  // Catálogo: en la v1 no tenía sector (--sector-de=RutinaCatalogo:<clave>).
  const filasCat: Reg[] = [];
  const sectorDeRutina = new Map<string, string>();
  for (const c of catalogo) {
    const sector = sectorDe('RutinaCatalogo', c);
    if (!sector) { r.sinSector++; aviso(r, `RutinaCatalogo ${c.objeto ?? c.id}: sin sector.`); continue; }
    if (!texto(c.rubro_nombre) || !texto(c.objeto) || !CICLOS.includes(c.ciclo)) { r.descartados++; aviso(r, `RutinaCatalogo ${c.id}: sin rubro, objeto o ciclo válido.`); continue; }
    sectorDeRutina.set(c.id, sector);
    filasCat.push({
      id_origen: c.id, sector_id: sector, rubro_id: texto(c.rubro_id), rubro_nombre: c.rubro_nombre, item: texto(c.item), objeto: c.objeto,
      acciones: texto(c.acciones), observaciones_tom: texto(c.observaciones_tom), tipo: c.tipo === 'informe' ? 'informe' : 'mantenimiento', ciclo: c.ciclo,
      // La frecuencia sale del ciclo (la calcula la base): no se confía en el dato suelto de la v1.
      estacionalidad: String(c.estacionalidad ?? '').split(',').map((m) => Number(m.trim())).filter((m) => m >= 1 && m <= 12),
      plazo_dias: numero(c.plazo_dias) && Number(c.plazo_dias) > 0 ? Math.round(Number(c.plazo_dias)) : 15,
      requiere_informe_matriculado: c.requiere_informe_matriculado === true, carga_sismesc: c.carga_sismesc === true, activa: c.activa !== false,
    });
  }
  if (corre('rutinas')) await subir('rutinas_catalogo', filasCat);
  const rutinas = await mapaIds('rutinas_catalogo', filasCat.map((f) => f.id_origen));

  // "Edificio" era una copia de las escuelas: en v2 las rutinas cuelgan directo de la ubicación.
  const ubicacionDeEdificio = new Map<string, string>();
  for (const e of edificios) {
    const u = ubicaciones.get(e.location_id) ?? [...sectores.values()].map((s) => ubicacionDe(s, e.nombre)).find(Boolean);
    if (u) ubicacionDeEdificio.set(e.id, u);
  }

  const filasAsig: Reg[] = [];
  const vistas = new Set<string>();
  for (const a of asignaciones) {
    const ubic = ubicacionDeEdificio.get(a.edificio_id);
    const rutina = rutinas.get(a.rutina_id);
    const sector = sectorDeRutina.get(a.rutina_id);
    if (!ubic || !rutina || !sector) { r.descartados++; aviso(r, `RutinaEdificio ${a.id}: su edificio o su rutina no se migró.`); continue; }
    if (vistas.has(`${ubic}|${rutina}`)) { r.descartados++; continue; }
    vistas.add(`${ubic}|${rutina}`);
    filasAsig.push({
      id_origen: a.id, sector_id: sector, ubicacion_id: ubic, rutina_id: rutina, activa: a.activa !== false,
      ultima_ejecucion: fecha(a.ultima_ejecucion),
      // En la v1 muchas asignaciones no tenían próxima fecha y por eso nunca generaban órdenes: arrancan hoy.
      proxima_ejecucion: fecha(a.proxima_ejecucion) ?? new Date().toISOString().slice(0, 10),
    });
  }
  if (corre('rutinas')) await subir('rutinas_ubicacion', filasAsig);
  const asignadas = await mapaIds('rutinas_ubicacion', filasAsig.map((f) => f.id_origen));

  // Órdenes de rutina: una sola abierta por asignación (la v1 las duplicaba). Queda la más nueva.
  const ABIERTAS = ['pendiente', 'en_proceso', 'vencida'];
  const abiertaDe = new Set<string>();
  const filasOrd: Reg[] = [];
  let duplicadas = 0;
  for (const o of [...ordenes].sort((a, b) => String(b.fecha_generada ?? '').localeCompare(String(a.fecha_generada ?? '')))) {
    const asig = asignadas.get(o.rutina_edificio_id);
    const ubic = ubicacionDeEdificio.get(o.edificio_id);
    const rutina = rutinas.get(o.rutina_id);
    const sector = sectorDeRutina.get(o.rutina_id);
    if (!asig || !ubic || !rutina || !sector) { r.descartados++; continue; }
    const estado = enLista(o.estado, ['pendiente', 'en_proceso', 'ejecutada', 'vencida', 'derivada_tom'] as const, 'pendiente');
    if (ABIERTAS.includes(estado)) {
      if (abiertaDe.has(asig)) { duplicadas++; r.descartados++; continue; }
      abiertaDe.add(asig);
    }
    const generada = fecha(o.fecha_generada) ?? fecha(o.created_date) ?? new Date().toISOString().slice(0, 10);
    const plazo = numero(o.plazo_dias) && Number(o.plazo_dias) > 0 ? Math.round(Number(o.plazo_dias)) : 15;
    filasOrd.push({
      id_origen: o.id, sector_id: sector, asignacion_id: asig, ubicacion_id: ubic, rutina_id: rutina, estado,
      fecha_generada: generada, fecha_limite: fecha(o.fecha_limite) ?? generada, fecha_ejecucion: fecha(o.fecha_ejecucion), plazo_dias: plazo,
      responsable_id: buscarPerfil(o.responsable_nombre), matricula_profesional: texto(o.matricula_profesional), observaciones: texto(o.observaciones),
      adjuntos: o.adjuntos ?? [], ot_id: otsMigradas.get(o.work_order_id) ?? null,
    });
  }
  if (duplicadas) aviso(r, `${duplicadas} órdenes de rutina abiertas repetidas para la misma rutina y edificio: se migra solo la más nueva.`);
  if (corre('rutinas')) await subir('ordenes_rutina', filasOrd);
  r.cargar = filasCat.length + filasAsig.length + filasOrd.length;
}

// ------------------------------------------------------------------ 9. pendientes SAP
async function migrarPendientes() {
  const origen = await leerEntidad('Pendiente');
  const r = nuevoResumen('pendientes', origen.length);
  const filas: Reg[] = [];
  const numeros = new Set<string>();
  let repetidos = 0;
  for (const p of origen) {
    const sector = sectorDe('Pendiente', p);
    if (!sector) { r.sinSector++; aviso(r, `Pendiente ${p.numero_sap ?? p.id}: sin sector.`); continue; }
    if (!texto(p.descripcion)) { r.descartados++; continue; }
    const sap = texto(p.numero_sap);
    if (sap) {
      if (numeros.has(`${sector}|${sap}`)) { repetidos++; r.descartados++; continue; }
      numeros.add(`${sector}|${sap}`);
    }
    const jefe = responsable(p.jefe_sitio);
    filas.push({
      id_origen: p.id, sector_id: sector, numero_sap: sap, numero_sap_desaprobado: texto(p.numero_sap_desaprobado), descripcion: p.descripcion,
      ubicacion_id: ubicacionDe(sector, p.establecimiento, p.sitio), establecimiento: texto(p.establecimiento), sitio: texto(p.sitio), zona: texto(p.comuna),
      inspector_nombre: texto(p.inspector), clase_orden: texto(p.clase_orden), status_sap: texto(p.status_sap),
      tipo: enLista(p.tipo, ['mantenimiento', 'obra', 'inspeccion', 'emergencia'] as const, 'mantenimiento'),
      estado: enLista(p.estado, ['pendiente', 'asignado', 'en_progreso', 'resuelto', 'cancelado'] as const, 'pendiente'),
      prioridad: enLista(p.prioridad, PRIORIDADES, 'media'), jefe_sitio_id: jefe.id, jefe_sitio_nombre: jefe.nombre,
      fecha_emision_sap: fecha(p.fecha_emision_sap), fecha_limite: fecha(p.fecha_limite), fecha_asignacion: fecha(p.fecha_asignacion), fecha_resolucion: fecha(p.fecha_resolucion),
      proyecto_nombre: texto(p.proyecto_nombre), activo_nombre: texto(p.activo_nombre), presupuesto_estimado: numero(p.presupuesto_estimado) ?? 0,
      materiales_necesarios: texto(p.materiales_necesarios), observaciones: texto(p.observaciones), notas_resolucion: texto(p.notas_resolucion),
      created_at: texto(p.created_date) ?? new Date().toISOString(),
    });
  }
  if (repetidos) aviso(r, `${repetidos} pendientes con un número de SAP repetido dentro del sector: se migra uno solo.`);
  r.cargar = filas.length;
  if (corre('pendientes')) await subir('pendientes', filas);
}

// ------------------------------------------------------------------ 10. emergencias
async function migrarEmergencias() {
  const origen = await leerEntidad('Emergencia');
  const r = nuevoResumen('emergencias', origen.length);
  const filas: Reg[] = [];
  const codigos = new Set<string>();
  for (const e of origen) {
    // Emergencia no tenía sector en la v1: --sector-de=Emergencia:<clave>.
    const sector = sectorDe('Emergencia', e);
    if (!sector) { r.sinSector++; aviso(r, `Emergencia ${e.codigo ?? e.id}: sin sector.`); continue; }
    const ubic = ubicacionDe(sector, e.establecimiento);
    if (!ubic || !texto(e.titulo)) { r.descartados++; aviso(r, `Emergencia ${e.codigo ?? e.id}: el establecimiento "${e.establecimiento}" no coincide con ninguna ubicación migrada.`); continue; }
    let codigo = texto(e.codigo) ?? `EMG-V1-${String(e.id).slice(-6)}`;
    if (codigos.has(codigo)) codigo = `${codigo}-${String(e.id).slice(-4)}`;
    codigos.add(codigo);
    const jefe = responsable(e.jefe_sitio_asignado);
    const resuelta = e.estado === 'resuelta';
    filas.push({
      id_origen: e.id, sector_id: sector, codigo, titulo: e.titulo, descripcion: texto(e.descripcion),
      tipo: enLista(e.tipo, ['incendio', 'inundacion', 'corte_electrico', 'derrumbe', 'rotura_gas', 'vandalismo', 'accidente', 'otro'] as const, 'otro'),
      estado: enLista(e.estado, ['activa', 'en_atencion', 'resuelta', 'cancelada'] as const, 'activa'),
      ubicacion_id: ubic, jefe_sitio_id: jefe.id, jefe_sitio_nombre: jefe.nombre, reportado_por: texto(e.reportado_por), telefono_contacto: texto(e.telefono_contacto),
      fotos: e.fotos ?? [], ot_id: otsMigradas.get(e.work_order_id) ?? null, notas_resolucion: texto(e.notas_resolucion),
      fecha_resolucion: resuelta ? texto(e.fecha_resolucion) : null,
      // En la v1 "tiempo de respuesta" era en realidad el tiempo hasta la resolución.
      minutos_resolucion: resuelta ? numero(e.tiempo_respuesta_min) : null,
      created_at: texto(e.created_date) ?? new Date().toISOString(),
    });
  }
  r.cargar = filas.length;
  if (corre('emergencias')) await subir('emergencias', filas);
}

// ------------------------------------------------------------------ 11. calefacción
async function migrarCalefaccion() {
  const origen = await leerEntidad('EquipamientoCalefaccion');
  const r = nuevoResumen('calefaccion', origen.length);
  const TIPOS = ['estufas', 'radiadores', 'conductos', 'calderas', 'vrv', 'vrv_bajo_silueta', 'aire_acondicionado_calor', 'otros'] as const;
  // Un registro por escuela, tipo de equipo y período: los repetidos se suman.
  const grupos = new Map<string, Reg>();
  for (const c of origen) {
    const sector = sectorDe('EquipamientoCalefaccion', c);
    if (!sector) { r.sinSector++; aviso(r, `EquipamientoCalefaccion ${c.escuela ?? c.id}: sin sector.`); continue; }
    const total = Math.round(numero(c.cantidad_total) ?? 0);
    if (!texto(c.escuela) || !TIPOS.includes(c.tipo_equipo) || total <= 0) { r.descartados++; continue; }
    const periodo = texto(c.periodo) ?? 'Sin período';
    const k = `${sector}|${periodo}|${norm(c.escuela)}|${c.tipo_equipo}`;
    const jefe = responsable(c.jefe_sitio);
    const g = grupos.get(k);
    const funciona = Math.min(Math.round(numero(c.cantidad_funciona) ?? 0), total);
    if (g) {
      g.cantidad_total += total;
      g.cantidad_funciona += funciona;
      r.descartados++;
    } else {
      grupos.set(k, {
        id_origen: c.id, sector_id: sector, ubicacion_id: ubicacionDe(sector, c.escuela), escuela: c.escuela, zona: texto(c.comuna),
        jefe_sitio_id: jefe.id, jefe_sitio_nombre: jefe.nombre, tipo_equipo: c.tipo_equipo, periodo,
        cantidad_total: total, cantidad_funciona: funciona, observaciones: texto(c.observaciones),
      });
    }
  }
  const filas = [...grupos.values()];
  r.cargar = filas.length;
  if (corre('calefaccion')) await subir('equipamiento_calefaccion', filas);
}

// ------------------------------------------------------------------ 12. inspecciones
async function migrarInspecciones() {
  const origen = await leerEntidad('InspeccionColegio');
  const r = nuevoResumen('inspecciones', origen.length);
  const filas: Reg[] = [];
  for (const i of origen) {
    const sector = sectorDe('InspeccionColegio', i);
    if (!sector) { r.sinSector++; aviso(r, `InspeccionColegio ${i.establecimiento ?? i.id}: sin sector.`); continue; }
    if (!texto(i.establecimiento)) { r.descartados++; continue; }
    const dia = fecha(i.fecha_inspeccion) ?? fecha(i.created_date) ?? new Date().toISOString().slice(0, 10);
    filas.push({
      id_origen: i.id, sector_id: sector, titulo: texto(i.titulo) ?? `Inspección ${i.establecimiento} — ${dia}`,
      ubicacion_id: ubicacionDe(sector, i.establecimiento), establecimiento: i.establecimiento, direccion: texto(i.direccion), zona: texto(i.comuna),
      inspector_id: buscarPerfil(i.jefe_sitio),
      // "generando" y "borrador" no son estados en los que pueda quedar una inspección migrada.
      estado: i.estado === 'completado' && texto(i.informe_generado) ? 'completado' : 'en_progreso',
      fecha_inspeccion: dia,
      secciones: (i.secciones ?? []).map((s: Reg, n: number) => ({
        id: String(s.id ?? `sec_${n}`), nombre: s.nombre ?? `Sección ${n + 1}`,
        urgencia: ['urgente', 'importante', 'leve', 'sin_issues'].includes(s.urgencia) ? s.urgencia : null,
        transcripcion: s.transcripcion ?? '', notas_libres: s.notas_libres ?? '', fotos: s.fotos ?? [], completada: s.completada === true,
      })),
      informe_generado: texto(i.informe_generado), created_at: texto(i.created_date) ?? new Date().toISOString(),
    });
  }
  r.cargar = filas.length;
  if (corre('inspecciones')) await subir('inspecciones', filas);
}

// ------------------------------------------------------------------ 13. gente: empleados, fichajes, horas y tablets
const ESPECIALIDADES = ['electricidad', 'plomeria', 'pintura', 'albanileria', 'carpinteria', 'herreria', 'climatizacion', 'general', 'otro'] as const;
const ESTADOS_EMPLEADO = ['activo', 'licencia', 'vacaciones', 'inactivo'] as const;

async function migrarGente() {
  const empleados = await leerEntidad('Employee');
  const marcas = await leerEntidad('AttendanceLog');
  const horasV1 = await leerEntidad('TimeLog');
  const tabletsV1 = await leerEntidad('Tablet');
  const r = nuevoResumen('gente', empleados.length + marcas.length + horasV1.length + tabletsV1.length);

  // Fichas. Un correo, una ficha vigente por sector: los repetidos de la v1 quedan sin correo y se avisa.
  const filas: Reg[] = [];
  const reservados: Reg[] = [];
  const sectorDeEmpleado = new Map<string, string>(); // id_origen → sector
  const empleadoPorNombre = new Map<string, string>(); // sector|nombre → id_origen
  const correos = new Set<string>();
  for (const e of empleados) {
    const sector = sectorDe('Employee', e);
    if (!sector) { r.sinSector++; aviso(r, `Employee ${e.full_name ?? e.id}: sin sector.`); continue; }
    if (!texto(e.full_name)) { r.descartados++; continue; }
    const estado = enLista(e.status, ESTADOS_EMPLEADO, 'activo');
    let email = norm(e.email) || null;
    if (email && estado !== 'inactivo') {
      if (correos.has(`${sector}|${email}`)) {
        aviso(r, `${e.full_name}: el correo ${email} ya lo tiene otra ficha vigente; esta queda sin correo.`);
        email = null;
      } else correos.add(`${sector}|${email}`);
    }
    // En la v1 el lugar asignado a veces era una lista de escuelas separadas por coma: se toma solo si es una.
    const lugares = String(e.assigned_location ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    filas.push({
      id_origen: e.id, sector_id: sector, nombre: e.full_name, puesto: texto(e.role),
      especialidad: enLista(norm(e.specialty).replace('ñ', 'n'), ESPECIALIDADES, 'general'), estado, email, telefono: texto(e.phone),
      jefe_sitio_id: buscarPerfil(e.assigned_jefe_sitio), zona: texto(e.assigned_comuna),
      ubicacion_id: lugares.length === 1 ? ubicacionDe(sector, lugares[0]) : null,
      fecha_ingreso: fecha(e.hire_date), certificaciones: Array.isArray(e.certifications) ? e.certifications.filter(texto) : [],
    });
    if (texto(e.dni) || numero(e.hourly_rate) !== null || texto(e.emergency_contact) || texto(e.emergency_phone) || texto(e.notes)) {
      reservados.push({ origen: e.id, sector_id: sector, dni: texto(e.dni), costo_hora: numero(e.hourly_rate),
        contacto_emergencia: texto(e.emergency_contact), telefono_emergencia: texto(e.emergency_phone), notas: texto(e.notes) });
    }
    sectorDeEmpleado.set(e.id, sector);
    empleadoPorNombre.set(`${sector}|${norm(e.full_name)}`, e.id);
  }
  if (corre('gente')) await subir('empleados', filas);
  const fichas = await mapaIds('empleados', filas.map((f) => f.id_origen));
  if (corre('gente')) {
    await subir('empleados_reservado', reservados.map(({ origen, ...x }) => ({ ...x, empleado_id: fichas.get(origen) })).filter((x) => x.empleado_id), 'empleado_id');
  }

  // Fichajes. La v1 no les ponía sector: se toma el del empleado. Los hechos con el QR de un lugar tenían solo
  // el nombre escrito a mano: se buscan por nombre y los que no coinciden con ninguna ficha se reportan.
  const filasFich: Reg[] = [];
  let sinFicha = 0;
  for (const m of marcas) {
    let origen = sectorDeEmpleado.has(m.employee_id) ? m.employee_id : null;
    if (!origen) {
      const candidatos = [...sectores.values()].map((s) => empleadoPorNombre.get(`${s}|${norm(m.employee_name)}`)).filter(Boolean) as string[];
      origen = candidatos.length === 1 ? candidatos[0] : null;
    }
    if (!origen || !fichas.get(origen)) { sinFicha++; continue; }
    if (!['entrada', 'salida'].includes(m.type) || !texto(m.timestamp)) { r.descartados++; continue; }
    filasFich.push({
      id_origen: m.id, sector_id: sectorDeEmpleado.get(origen), empleado_id: fichas.get(origen), tipo: m.type, momento: m.timestamp,
      lat: numero(m.latitude), lng: numero(m.longitude), origen: 'migracion', dispositivo: texto(m.device_info)?.slice(0, 160) ?? null,
      notas: [texto(m.location_name), texto(m.notes)].filter(Boolean).join(' · ') || null, registrado_por: null,
    });
  }
  if (sinFicha) aviso(r, `${sinFicha} fichajes con un nombre que no coincide con ninguna ficha: quedan afuera (se ven en el JSON de la v1).`);
  if (corre('gente')) await subir('fichajes', filasFich);

  // Horas cargadas a las órdenes.
  const filasHoras: Reg[] = [];
  for (const h of horasV1) {
    const ot = otsMigradas.get(h.work_order_id);
    const sector = otSector.get(h.work_order_id);
    const horas = numero(h.hours);
    if (!ot || !sector) { r.descartados++; aviso(r, `TimeLog ${h.id}: su orden no se migró.`); continue; }
    if (horas === null || horas <= 0 || horas > 24 || !texto(h.employee_name)) { r.descartados++; aviso(r, `TimeLog ${h.id}: horas o persona inválidas.`); continue; }
    const origen = sectorDeEmpleado.get(h.employee_id) === sector ? h.employee_id : empleadoPorNombre.get(`${sector}|${norm(h.employee_name)}`);
    filasHoras.push({
      id_origen: h.id, sector_id: sector, ot_id: ot, empleado_id: origen ? fichas.get(origen) ?? null : null, empleado_nombre: h.employee_name,
      fecha: fecha(h.date) ?? new Date().toISOString().slice(0, 10), horas, tipo: enLista(h.type, ['normal', 'extra', 'guardia'] as const, 'normal'),
      descripcion: texto(h.description),
    });
  }
  if (corre('gente')) await subir('ot_horas', filasHoras);

  // Tablets: pasan con su jefe; el usuario de cada tablet se crea después (la v1 usaba un código de activación).
  const filasTab: Reg[] = [];
  for (const t of tabletsV1) {
    const sector = sectorDe('Tablet', t);
    if (!sector) { r.sinSector++; aviso(r, `Tablet ${t.nombre ?? t.id}: sin sector.`); continue; }
    const jefe = buscarPerfil(t.jefe_sitio);
    if (!jefe) { r.descartados++; aviso(r, `Tablet ${t.nombre}: su jefe "${t.jefe_sitio}" no tiene usuario en v2.`); continue; }
    filasTab.push({ id_origen: t.id, sector_id: sector, nombre: t.nombre, jefe_sitio_id: jefe, activa: t.activa !== false, ultima_actividad: texto(t.ultima_actividad) });
  }
  if (filasTab.length) aviso(r, `${filasTab.length} tablets: a cada una hay que crearle un usuario (rol operario) y elegirlo en Empleados → Tablets.`);
  if (corre('gente')) await subir('tablets', filasTab);

  r.cargar = filas.length + filasFich.length + filasHoras.length + filasTab.length;
  aviso(r, `Fichas: ${filas.length} · fichajes: ${filasFich.length} · horas: ${filasHoras.length} · tablets: ${filasTab.length}.`);
}

// ------------------------------------------------------------------ 14. obras: proveedores, obras, cobro, solicitudes, presupuestos, abonos
const ESTADOS_OBRA = ['pendiente', 'en_progreso', 'pausado', 'completado', 'cancelado'] as const;
const TIPOS_OBRA = ['obra_nueva', 'remodelacion', 'mantenimiento_preventivo', 'mantenimiento_correctivo', 'emergencia', 'inspeccion'] as const;
const RUBROS = ['construccion', 'electricidad', 'plomeria', 'pintura', 'carpinteria', 'herreria', 'climatizacion', 'albanileria',
  'impermeabilizacion', 'materiales', 'equipos', 'limpieza', 'seguridad', 'transporte', 'tecnologia', 'otro'] as const;
const ESTADOS_COBRO = ['listo_certificar', 'faltan_actas', 'pendiente', 'observado', 'falta_aprobar_mein'] as const;
const ESTADOS_SOLICITUD = ['borrador', 'enviada', 'en_revision', 'aprobada', 'rechazada'] as const;
const PRIORIDADES_COBRO = ['normal', 'alta', 'urgente'] as const;
const COLORES = ['auto', 'rojo', 'amarillo', 'naranja', 'verde', 'azul', 'gris'] as const;
// "1.234,56" o 1234.56 → 1234.56 (la v1 guardaba montos como texto con formato argentino)
const monto = (v: unknown) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const t = String(v ?? '').replace(/[$\s]/g, '').replace(/\./g, '').replace(',', '.');
  return t === '' || Number.isNaN(Number(t)) ? null : Number(t);
};
const pct = (v: unknown) => { const n = numero(v); return n === null ? null : Math.min(100, Math.max(0, n)); };
// En la v1 la obra guardaba comuna, jefe, inspector y detalle dentro de las notas: "Detalle: X | Comuna: Y | ...".
const deNotas = (notas: unknown, etiqueta: string) => texto(String(notas ?? '').match(new RegExp(`${etiqueta}:\\s*([^|]+)`, 'i'))?.[1]);
const sinEtiquetas = (notas: unknown) =>
  texto(String(notas ?? '').split('|').map((p) => p.trim()).filter((p) => p && !/^(Detalle|Comuna|Jefe de Sitio|Inspector|Supervisor):/i.test(p)).join(' | '));
const docsV1 = (lista: unknown) => (Array.isArray(lista) ? lista : [])
  .map((d: any) => (typeof d === 'string' ? { url: d, nombre: null } : { url: d?.url ?? d?.file_url, nombre: d?.nombre ?? d?.name }))
  .filter((d) => texto(d.url))
  .map((d) => ({ nombre: texto(d.nombre) ?? decodeURIComponent(String(d.url).split('/').pop() ?? 'documento'), path: String(d.url), tipo: '', tamano: 0 }));

let obrasMigradas = new Map<string, string>(); // id_origen (Project) → id v2 (lo usa el pañol)
const sectorDeObraV1 = new Map<string, string>();

async function migrarObras() {
  const clientes = await leerEntidad('Client');
  const proyectos = await leerEntidad('Project');
  const cobrosV1 = await leerEntidad('ObraCertificacion');
  const solicitudesV1 = await leerEntidad('SolicitudCertificado');
  const presupuestosV1 = await leerEntidad('PresupuestoExcel');
  const abonosV1 = await leerEntidad('AbonoMaestro');
  const r = nuevoResumen('obras', clientes.length + proyectos.length + cobrosV1.length + solicitudesV1.length + presupuestosV1.length + abonosV1.length);
  const escribe = corre('obras');

  // Proveedores (en la v1, "Client").
  const provs: Reg[] = [];
  const provPorNombre = new Map<string, string>(); // sector|nombre → id_origen
  for (const c of clientes) {
    const sector = sectorDe('Client', c);
    if (!sector) { r.sinSector++; aviso(r, `Client ${c.name ?? c.id}: sin sector.`); continue; }
    if (!texto(c.name)) { r.descartados++; continue; }
    const val = numero(c.valoracion);
    provs.push({
      id_origen: c.id, sector_id: sector, nombre: c.name, rubro: enLista(c.rubro, RUBROS, 'otro'),
      zona: c.comuna && c.comuna !== 'Sin asignar' ? c.comuna : null, cuit: texto(c.cuit), contacto: texto(c.contact_name), email: texto(c.email),
      telefono: texto(c.phone), direccion: texto(c.address), localidad: texto(c.city), estado: enLista(c.status, ['activo', 'inactivo', 'suspendido'] as const, 'activo'),
      valoracion: val !== null && val >= 1 && val <= 5 ? Math.round(val) : null, notas_valoracion: texto(c.notas_valoracion), notas: texto(c.notes),
    });
    provPorNombre.set(`${sector}|${norm(c.name)}`, c.id);
  }
  if (escribe) await subir('proveedores', provs);
  const provIds = await mapaIds('proveedores', provs.map((p) => p.id_origen));

  // Obras (en la v1, "Project"). El N° de orden SAP no se repite por sector: el repetido queda sin número y se avisa.
  const obras: Reg[] = [];
  const obraPorCodigo = new Map<string, string>(); // sector|código → id_origen
  const obraPorTitulo = new Map<string, string>(); // sector|título → id_origen
  const sectorDeObra = new Map<string, string>();
  for (const p of proyectos) {
    const sector = sectorDe('Project', p);
    if (!sector) { r.sinSector++; aviso(r, `Project ${p.name ?? p.id}: sin sector.`); continue; }
    if (!texto(p.name)) { r.descartados++; continue; }
    let codigo = texto(p.code);
    if (codigo && obraPorCodigo.has(`${sector}|${codigo}`)) {
      aviso(r, `Obra "${p.name}": el N° de orden ${codigo} ya lo tiene otra obra; queda sin número (revisalo en v2).`);
      codigo = null;
    }
    const docs = docsV1(p.documents);
    const prov = p.client_id && provIds.get(p.client_id) && sectorDe('Client', clientes.find((c) => c.id === p.client_id) ?? {}) === sector ? provIds.get(p.client_id) : null;
    obras.push({
      id_origen: p.id, sector_id: sector, titulo: String(p.name).trim(), codigo_sap: codigo,
      // En la planilla de la v1 el "cliente" de la obra era el establecimiento.
      establecimiento: prov ? null : texto(p.client_name), proveedor_id: prov,
      ubicacion_id: ubicacionDe(sector, p.client_name), direccion: texto(p.address),
      zona: deNotas(p.notes, 'Comuna'), detalle: deNotas(p.notes, 'Detalle'),
      jefe_sitio_id: buscarPerfil(deNotas(p.notes, 'Jefe de Sitio')), jefe_sitio_nombre: deNotas(p.notes, 'Jefe de Sitio'),
      inspector_id: buscarPerfil(deNotas(p.notes, 'Inspector')), inspector_nombre: deNotas(p.notes, 'Inspector'),
      supervisor: deNotas(p.notes, 'Supervisor'),
      tipo: enLista(p.type, TIPOS_OBRA, 'obra_nueva'), estado: enLista(p.status, ESTADOS_OBRA, 'pendiente'), prioridad: enLista(p.priority, PRIORIDADES, 'media'),
      descripcion: texto(p.description), monto_base: Math.max(0, monto(p.estimated_budget) ?? 0), costo_real: Math.max(0, monto(p.actual_cost) ?? 0),
      avance: pct(p.progress) ?? 0, fecha_inicio: fecha(p.start_date),
      fecha_fin: fecha(p.end_date) && fecha(p.start_date) && fecha(p.end_date)! < fecha(p.start_date)! ? null : fecha(p.end_date),
      notas: sinEtiquetas(p.notes), documentos: docs, created_at: texto(p.created_date) ?? new Date().toISOString(),
    });
    if (codigo) obraPorCodigo.set(`${sector}|${codigo}`, p.id);
    obraPorTitulo.set(`${sector}|${norm(p.name)}`, p.id);
    sectorDeObra.set(p.id, sector);
  }

  // Cobro por ciclo (en la v1, "ObraCertificacion"). Cada fila apunta a su obra: por MTOM, por título o, si no hay, se crea.
  const cobros: Reg[] = [];
  const ciclos = new Map<string, { sector: string; nombre: string; abierto: boolean; ultimo: string }>();
  let obrasDeCobro = 0;
  for (const c of cobrosV1) {
    const sector = sectorDe('ObraCertificacion', c);
    if (!sector) { r.sinSector++; aviso(r, `ObraCertificacion ${c.titulo ?? c.id}: sin sector.`); continue; }
    if (!texto(c.titulo)) { r.descartados++; continue; }
    const mtom = texto(c.oc_numero);
    let obra = (mtom && obraPorCodigo.get(`${sector}|${mtom}`)) || obraPorTitulo.get(`${sector}|${norm(c.titulo)}`);
    if (!obra) {
      obra = `oc:${c.id}`;
      obrasDeCobro++;
      obras.push({
        id_origen: obra, sector_id: sector, titulo: String(c.titulo).trim(), codigo_sap: mtom, mein: texto(c.ada_numero),
        establecimiento: texto(c.establecimiento), direccion: texto(c.direccion), zona: texto(c.comuna), ubicacion_id: ubicacionDe(sector, c.establecimiento),
        jefe_sitio_id: buscarPerfil(c.jefe_sitio), jefe_sitio_nombre: texto(c.jefe_sitio), inspector_id: buscarPerfil(c.inspector), inspector_nombre: texto(c.inspector),
        monto_base: Math.max(0, monto(c.monto_contrato) ?? 0), avance: pct(c.porcentaje_avance) ?? 0, plazo_dias: numero(c.plazo_dias) ? Math.round(numero(c.plazo_dias)!) : null,
        fecha_inicio: fecha(c.fecha_inicio), fecha_fin: fecha(c.fecha_fin_estimada) && fecha(c.fecha_inicio) && fecha(c.fecha_fin_estimada)! < fecha(c.fecha_inicio)! ? null : fecha(c.fecha_fin_estimada),
        created_at: texto(c.created_date) ?? new Date().toISOString(),
      });
      if (mtom) obraPorCodigo.set(`${sector}|${mtom}`, obra);
      obraPorTitulo.set(`${sector}|${norm(c.titulo)}`, obra);
    } else {
      // La obra ya estaba (de la planilla de obras): se le completa el MEIN si no lo tenía.
      const o = obras.find((x) => x.id_origen === obra);
      if (o && !o.mein) o.mein = texto(c.ada_numero);
    }
    const nombreCiclo = texto(c.ciclo) ?? 'Ciclo de la v1';
    const clave = `${sector}|${nombreCiclo}`;
    const previo = ciclos.get(clave);
    const creado = texto(c.created_date) ?? '';
    ciclos.set(clave, { sector, nombre: nombreCiclo, abierto: (previo?.abierto ?? false) || c.ciclo_archivado !== true, ultimo: previo && previo.ultimo > creado ? previo.ultimo : creado });
    const estado = enLista(c.estado_cobro, ESTADOS_COBRO, 'pendiente');
    cobros.push({
      clave, obra, estado_cobro: estado, prioridad: enLista(c.prioridad, PRIORIDADES_COBRO, 'normal'),
      monto_a_cobrar: Math.max(0, monto(c.monto_a_cobrar) ?? 0), avance: pct(c.porcentaje_avance) ?? 0,
      tramo_manual: ['primer_50', 'segundo_50'].includes(c.tramo_certificacion) ? c.tramo_certificacion : null,
      color_avance: enLista(c.color_avance, COLORES, 'auto'),
      motivo_observacion: estado === 'observado' ? texto(c.motivo_observacion) ?? texto(c.notas) ?? 'Observado en la v1' : null,
      periodo: texto(c.periodo), notas: texto(c.notas), sector,
    });
  }
  // Un solo ciclo abierto por sector: si la v1 tenía varios sin archivar, queda abierto el más reciente.
  for (const s of new Set([...ciclos.values()].map((c) => c.sector))) {
    const abiertos = [...ciclos.values()].filter((c) => c.sector === s && c.abierto).sort((a, b) => b.ultimo.localeCompare(a.ultimo));
    for (const c of abiertos.slice(1)) { c.abierto = false; aviso(r, `El ciclo "${c.nombre}" estaba sin archivar; queda cerrado porque "${abiertos[0].nombre}" es más reciente.`); }
  }
  if (obrasDeCobro) aviso(r, `${obrasDeCobro} obras del tablero de cobro no estaban en la planilla de obras: se crean.`);

  if (escribe) await subir('obras', obras);
  const obraIds = await mapaIds('obras', obras.map((o) => o.id_origen));
  obrasMigradas = obraIds;
  for (const [k, v] of sectorDeObra) sectorDeObraV1.set(k, v);

  const cicloIds = new Map<string, string>();
  if (escribe && APPLY && sb) {
    // Primero los cerrados y después el abierto (el índice admite un solo abierto por sector).
    const lista = [...ciclos.values()].sort((a, b) => Number(a.abierto) - Number(b.abierto));
    for (const c of lista) {
      const { data, error } = await sb.from('ciclos_cobro')
        .upsert({ sector_id: c.sector, nombre: c.nombre, abierto: c.abierto, cerrado_at: c.abierto ? null : new Date().toISOString() }, { onConflict: 'sector_id,nombre' })
        .select('id').single();
      if (error) throw new Error(`Error al cargar ciclos_cobro: ${error.message}`);
      cicloIds.set(`${c.sector}|${c.nombre}`, data.id);
    }
  } else for (const k of ciclos.keys()) cicloIds.set(k, `simulacro:${k}`);
  const filasCobro = cobros.map(({ clave, obra, sector, ...x }) => ({ ...x, sector_id: sector, ciclo_id: cicloIds.get(clave), obra_id: obraIds.get(obra) }))
    .filter((x) => x.ciclo_id && x.obra_id);
  // Una obra aparece una vez por ciclo: si la v1 la tenía repetida, gana la última fila.
  const unicos = [...new Map(filasCobro.map((f) => [`${f.ciclo_id}|${f.obra_id}`, f])).values()];
  if (unicos.length < filasCobro.length) aviso(r, `${filasCobro.length - unicos.length} filas de cobro repetidas (misma obra en el mismo ciclo) se unifican.`);
  if (escribe) await subir('obra_cobros', unicos, 'ciclo_id,obra_id');

  // Órdenes de trabajo que en la v1 colgaban de un proyecto.
  const ordenes = await leerEntidad('WorkOrder');
  const porObra = new Map<string, string[]>();
  for (const o of ordenes) {
    const obra = obraIds.get(o.project_id);
    const ot = otsMigradas.get(o.id);
    if (!obra || !ot || otSector.get(o.id) !== sectorDeObra.get(o.project_id)) continue;
    porObra.set(obra, [...(porObra.get(obra) ?? []), ot]);
  }
  if (escribe && APPLY && sb) {
    for (const [obra, ots] of porObra) {
      const { error } = await sb.from('ordenes_trabajo').update({ obra_id: obra }).in('id', ots);
      if (error) throw new Error(`Error al vincular órdenes con obras: ${error.message}`);
    }
  }

  // Solicitudes de certificado. Quien la pidió y quien la aprobó se buscan por correo y nombre.
  const sols: Reg[] = [];
  for (const s of solicitudesV1) {
    const sector = sectorDe('SolicitudCertificado', s);
    if (!sector) { r.sinSector++; aviso(r, `SolicitudCertificado ${s.numero ?? s.id}: sin sector.`); continue; }
    if (!texto(s.titulo)) { r.descartados++; continue; }
    const estado = enLista(s.estado, ESTADOS_SOLICITUD, 'borrador');
    const solicitante = buscarPerfil(s.jefe_sitio_email, s.jefe_sitio);
    if (!solicitante) aviso(r, `Solicitud ${s.numero ?? s.id}: "${s.jefe_sitio ?? s.jefe_sitio_email}" no tiene usuario en v2; queda sin solicitante.`);
    sols.push({
      id_origen: s.id, sector_id: sector, codigo: texto(s.numero) ?? `V1-${String(s.id).slice(-8)}`, titulo: s.titulo,
      establecimiento: texto(s.establecimiento), descripcion: texto(s.descripcion_trabajo), monto_solicitado: Math.max(0, monto(s.monto_solicitado) ?? 0),
      avance: pct(s.porcentaje_avance) ?? 0, periodo: texto(s.periodo), prioridad: enLista(s.prioridad, PRIORIDADES_COBRO, 'normal'),
      adjuntos: docsV1(s.adjuntos), estado, solicitante_id: solicitante, revisor_id: buscarPerfil(s.aprobado_por_email, s.aprobado_por),
      comentarios: texto(s.comentarios_admin), motivo_rechazo: estado === 'rechazada' ? texto(s.motivo_rechazo) : null,
      resuelto_at: estado === 'aprobada' || estado === 'rechazada' ? texto(s.fecha_aprobacion) : null,
      historial: Array.isArray(s.historial) ? s.historial : [], created_at: texto(s.created_date) ?? new Date().toISOString(),
    });
  }
  if (escribe) await subir('solicitudes_certificado', sols);

  // Presupuestos: el archivo sigue en Base44; se guarda su enlace.
  const pres: Reg[] = [];
  for (const p of presupuestosV1) {
    const sector = sectorDe('PresupuestoExcel', p);
    if (!sector) { r.sinSector++; aviso(r, `PresupuestoExcel ${p.nombre ?? p.id}: sin sector.`); continue; }
    if (!texto(p.nombre) || !texto(p.archivo_url)) { r.descartados++; aviso(r, `Presupuesto ${p.nombre ?? p.id}: sin nombre o sin archivo.`); continue; }
    const obra = obraPorTitulo.get(`${sector}|${norm(p.obra)}`);
    pres.push({
      id_origen: p.id, sector_id: sector, nombre: p.nombre, descripcion: texto(p.descripcion),
      obra_id: obra ? obraIds.get(obra) ?? null : null, obra_texto: obra ? null : texto(p.obra),
      estado: enLista(p.estado, ['borrador', 'enviado', 'aprobado', 'rechazado'] as const, 'borrador'),
      archivo_path: p.archivo_url, archivo_nombre: texto(p.archivo_nombre) ?? p.nombre, archivo_tamano: numero(p.archivo_size),
      created_at: texto(p.created_date) ?? new Date().toISOString(),
    });
  }
  if (escribe) await subir('presupuestos', pres);

  // Abonos (AbonoMaestro): pasan a contratos de abono mensual, con sus fechas de vigencia y sus ítems.
  // Si el contrato ya vino con los certificados históricos (misma ADA u OC), solo se le completan las fechas.
  let abonosNuevos = 0;
  let abonosCompletados = 0;
  for (const a of abonosV1) {
    const sector = sectorDe('AbonoMaestro', a);
    if (!sector) { r.sinSector++; aviso(r, `AbonoMaestro ${a.contratista ?? a.id}: sin sector.`); continue; }
    if (!texto(a.contratista)) { r.descartados++; continue; }
    const items = (Array.isArray(a.items) ? a.items : [])
      .map((it: Reg, i: number) => ({ numero: i + 1, descripcion: texto(it.descripcion) ?? `Ítem ${i + 1}`, um: texto(it.um) ?? 'MES', cantidad: numero(it.cantidad) ?? 1, importe_unitario: monto(it.importe_unitario) ?? 0 }))
      .filter((it) => it.cantidad > 0 && it.importe_unitario >= 0);
    const vigencia = { fecha_inicio: fecha(a.fecha_inicio_validez), fecha_fin: fecha(a.fecha_fin_validez) };
    if (!APPLY || !sb || !escribe) { abonosNuevos++; continue; }
    let existente: { id: string; fecha_inicio: string | null; fecha_fin: string | null } | null = null;
    for (const [campo, valor] of [['ada_numero', texto(a.ada_numero)], ['oc_numero', texto(a.oc_numero)]] as const) {
      if (existente || !valor) continue;
      const { data } = await sb.from('contratos').select('id, fecha_inicio, fecha_fin').eq('sector_id', sector).eq(campo, valor).limit(1);
      existente = data?.[0] ?? null;
    }
    if (existente) {
      await sb.from('contratos').update({ fecha_inicio: existente.fecha_inicio ?? vigencia.fecha_inicio, fecha_fin: existente.fecha_fin ?? vigencia.fecha_fin, tipo: 'abono_mensual' }).eq('id', existente.id);
      abonosCompletados++;
      continue;
    }
    const { data, error } = await sb.from('contratos').upsert({
      id_origen: `abono:${a.id}`, sector_id: sector, tipo: 'abono_mensual', contratista: a.contratista, obra_servicio: texto(a.obra_servicio) ?? texto(a.rubro) ?? 'Abono',
      emprendimiento: texto(a.emprendimiento), ada_numero: texto(a.ada_numero), oc_numero: texto(a.oc_numero), ...vigencia, plazo: texto(a.plazo_obra),
      condiciones_pago: texto(a.condiciones_pago), anticipo_pct: numero(a.anticipo_pct) ?? 0, fondo_reparo_pct: numero(a.fondo_reparo_pct) ?? 0,
      estado: a.estado === 'completado' ? 'cerrado' : 'activo', notas: texto(a.notas),
    }, { onConflict: 'id_origen' }).select('id').single();
    if (error) { r.descartados++; aviso(r, `Abono ${a.contratista}: ${error.message}`); continue; }
    if (items.length) {
      const { error: e2 } = await sb.from('contrato_items').upsert(items.map((it) => ({ ...it, sector_id: sector, contrato_id: data.id })), { onConflict: 'contrato_id,numero' });
      if (e2) aviso(r, `Abono ${a.contratista}: sus ítems no se cargaron (${e2.message}).`);
    } else aviso(r, `Abono ${a.contratista}: no tiene ítems; cargalos en v2 antes de certificar.`);
    abonosNuevos++;
  }

  r.cargar = provs.length + obras.length + unicos.length + sols.length + pres.length + abonosNuevos + abonosCompletados;
  aviso(r, `Proveedores: ${provs.length} · obras: ${obras.length} · ciclos: ${ciclos.size} · filas de cobro: ${unicos.length} · órdenes vinculadas a obras: ${[...porObra.values()].flat().length}`
    + ` · solicitudes: ${sols.length} · presupuestos: ${pres.length} · abonos: ${abonosNuevos} nuevos${abonosCompletados ? `, ${abonosCompletados} completados` : ''}.`);
  const docs = obras.reduce((t, o) => t + (o.documentos?.length ?? 0), 0) + sols.reduce((t, s) => t + s.adjuntos.length, 0) + pres.length;
  if (docs) aviso(r, `${docs} documentos siguen alojados en Base44 (se guardó su enlace): conviene copiarlos al bucket "documentos" antes de dar de baja la v1.`);
}

// ------------------------------------------------------------------ 15. pañol: materiales, movimientos, requerimientos, materiales de OT
const CATEGORIAS_MAT = ['electrico', 'plomeria', 'pintura', 'construccion', 'herreria', 'herramientas', 'seguridad', 'climatizacion', 'limpieza', 'otros'] as const;
const UNIDADES_MAT = ['unidad', 'metro', 'metro2', 'metro3', 'kg', 'litro', 'bolsa', 'caja', 'rollo', 'par', 'juego'] as const;
const MOTIVO_V2: Record<string, string> = {
  compra: 'compra', devolucion: 'devolucion', ajuste_entrada: 'ajuste_entrada',
  asignacion_proyecto: 'asignacion_obra', consumo: 'consumo', perdida: 'perdida', ajuste_salida: 'ajuste_salida',
};
const ESTADOS_REQ = ['borrador', 'enviado', 'en_revision', 'aprobado', 'en_compra', 'recibido', 'rechazado'] as const;

async function migrarPanol() {
  const materialesV1 = await leerEntidad('Material');
  const movsV1 = await leerEntidad('MovimientoPanol');
  const reqsV1 = await leerEntidad('RequerimientoCompra');
  const ordenes = await leerEntidad('WorkOrder');
  const r = nuevoResumen('panol', materialesV1.length + movsV1.length + reqsV1.length);
  const escribe = corre('panol');

  // Materiales. El stock de la v1 se toma como está (sin movimiento: la historia viene en MovimientoPanol).
  // Un código repetido en el sector queda sin código y se avisa.
  const mats: Reg[] = [];
  const sectorDeMat = new Map<string, string>();
  const matPorNombre = new Map<string, string>(); // sector|nombre → id_origen
  const codigos = new Set<string>();
  for (const m of materialesV1) {
    const sector = sectorDe('Material', m);
    if (!sector) { r.sinSector++; aviso(r, `Material ${m.name ?? m.id}: sin sector.`); continue; }
    if (!texto(m.name)) { r.descartados++; continue; }
    let codigo = texto(m.code);
    if (codigo && codigos.has(`${sector}|${codigo.toLowerCase()}`)) { aviso(r, `Material "${m.name}": el código ${codigo} se repite; queda sin código.`); codigo = null; }
    if (codigo) codigos.add(`${sector}|${codigo.toLowerCase()}`);
    const stock = numero(m.stock) ?? 0;
    if (stock < 0) aviso(r, `Material "${m.name}": tenía stock negativo (${stock}); entra en 0.`);
    const categoria = enLista(m.category, CATEGORIAS_MAT, 'otros');
    mats.push({
      id_origen: m.id, sector_id: sector, nombre: String(m.name).trim(), codigo, categoria, unidad: enLista(m.unit, UNIDADES_MAT, 'unidad'),
      stock: Math.max(0, stock), stock_minimo: Math.max(0, numero(m.min_stock) ?? 0), costo_unitario: Math.max(0, numero(m.unit_cost) ?? 0),
      prestable: categoria === 'herramientas', proveedor_texto: texto(m.supplier), ubicacion_deposito: texto(m.location), notas: texto(m.notes),
      created_at: texto(m.created_date) ?? new Date().toISOString(),
    });
    sectorDeMat.set(m.id, sector);
    matPorNombre.set(`${sector}|${norm(m.name)}`, m.id);
  }
  if (escribe) await subir('materiales', mats);
  const matIds = await mapaIds('materiales', mats.map((m) => m.id_origen));

  // Movimientos: historia tal cual (en la v1 no tenían sector: se toma el del material). Se cargan como servicio, así que
  // no vuelven a mover el stock.
  const movs: Reg[] = [];
  for (const x of movsV1) {
    const sector = sectorDeMat.get(x.material_id);
    const material = matIds.get(x.material_id);
    if (!sector || !material) { r.descartados++; aviso(r, `Movimiento ${x.id}: su material no se migró.`); continue; }
    const motivo = MOTIVO_V2[x.motivo] ?? (x.tipo === 'entrada' ? 'ajuste_entrada' : 'ajuste_salida');
    const tipo = ['compra', 'devolucion', 'ajuste_entrada'].includes(motivo) ? 'entrada' : 'salida';
    const cantidad = Math.abs(numero(x.cantidad) ?? 0);
    if (!cantidad) { r.descartados++; continue; }
    const obra = obrasMigradas.get(x.proyecto_id);
    movs.push({
      id_origen: x.id, sector_id: sector, material_id: material, tipo, motivo, cantidad,
      stock_anterior: Math.max(0, numero(x.stock_anterior) ?? 0), stock_nuevo: Math.max(0, numero(x.stock_nuevo) ?? 0),
      costo_unitario: Math.max(0, numero(x.costo_unitario) ?? 0),
      obra_id: obra && sectorDeObraV1.get(x.proyecto_id) === sector ? obra : null,
      responsable_texto: texto(x.responsable), remito: texto(x.remito),
      notas: [texto(x.notas), !obra && texto(x.proyecto_nombre) ? `Proyecto en la v1: ${x.proyecto_nombre}` : null].filter(Boolean).join(' · ') || null,
      registrado_por: buscarPerfil(x.created_by), created_at: texto(x.created_date) ?? new Date().toISOString(),
    });
  }
  if (escribe) await subir('movimientos_panol', movs);

  // Requerimientos de compra. En la v1 no tenían sector: se toma el de quien lo pidió o --sector-de=RequerimientoCompra:clave.
  const reqs: Reg[] = [];
  const itemsPorReq = new Map<string, Reg[]>();
  for (const q of reqsV1) {
    const solicitante = buscarPerfil(q.jefe_sitio_email, q.created_by, q.jefe_sitio);
    const sector = sectorDe('RequerimientoCompra', q) ?? (solicitante ? sectorDePerfil.get(solicitante) ?? null : null);
    if (!sector) { r.sinSector++; aviso(r, `Requerimiento ${q.numero ?? q.id}: sin sector (ni por quien lo pidió). Usá --sector-de=RequerimientoCompra:<clave>.`); continue; }
    if (!texto(q.titulo)) { r.descartados++; continue; }
    const estado = enLista(q.estado, ESTADOS_REQ, 'enviado');
    reqs.push({
      id_origen: q.id, sector_id: sector, codigo: texto(q.numero) ? `V1-${q.numero}` : `V1-${String(q.id).slice(-8)}`, titulo: q.titulo, solicitante_id: solicitante,
      establecimiento: texto(q.establecimiento), ubicacion_id: ubicacionDe(sector, q.establecimiento),
      prioridad: enLista(q.prioridad, ['baja', 'normal', 'alta', 'urgente'] as const, 'normal'), fecha_necesidad: fecha(q.fecha_necesidad), estado,
      observaciones: texto(q.observaciones), numero_orden_compra: texto(q.numero_orden_compra), proveedor_texto: texto(q.proveedor_seleccionado),
      adjuntos: docsV1(q.adjuntos),
      historial: (Array.isArray(q.historial) ? q.historial : []).map((h: Reg) => ({ fecha: h.fecha, estado: h.estado, usuario: h.usuario, comentario: texto(h.observacion) })),
      total_estimado: Math.max(0, numero(q.total_estimado) ?? 0), created_at: texto(q.created_date) ?? new Date().toISOString(),
    });
    itemsPorReq.set(q.id, (Array.isArray(q.items) ? q.items : []).map((it: Reg, i: number) => ({
      sector_id: sector, material_id: sectorDeMat.get(it.material_id) === sector ? matIds.get(it.material_id) ?? null : null,
      descripcion: texto(it.material_nombre) ?? `Ítem ${i + 1}`, unidad: enLista(it.unidad, UNIDADES_MAT, 'unidad'),
      cantidad_solicitada: Math.max(0.001, numero(it.cantidad_solicitada) ?? 1), cantidad_aprobada: numero(it.cantidad_aprobada),
      cantidad_recibida: estado === 'recibido' ? numero(it.cantidad_aprobada) ?? numero(it.cantidad_solicitada) ?? 0 : 0,
      costo_estimado: Math.max(0, numero(it.costo_estimado) ?? 0), notas: texto(it.notas_item), orden: i + 1,
    })));
  }
  if (escribe) await subir('requerimientos_compra', reqs);
  const reqIds = await mapaIds('requerimientos_compra', reqs.map((q) => q.id_origen));
  let items = 0;
  if (escribe && APPLY && sb) {
    for (const [origen, lista] of itemsPorReq) {
      const id = reqIds.get(origen);
      if (!id || lista.length === 0) continue;
      // Re-ejecutable: los ítems de un requerimiento migrado se reemplazan enteros.
      await sb.from('requerimiento_items').delete().eq('requerimiento_id', id);
      const { error } = await sb.from('requerimiento_items').insert(lista.map((it) => ({ ...it, requerimiento_id: id })));
      if (error) aviso(r, `Ítems del requerimiento ${origen}: ${error.message}`);
      else items += lista.length;
    }
  } else items = [...itemsPorReq.values()].reduce((t, l) => t + l.length, 0);

  // Materiales usados en las órdenes (en la v1, texto libre): se anotan sin descontar stock.
  const usados: Reg[] = [];
  for (const o of ordenes) {
    const ot = otsMigradas.get(o.id);
    const sector = otSector.get(o.id);
    if (!ot || !sector) continue;
    (Array.isArray(o.materials_used) ? o.materials_used : []).forEach((u: Reg, i: number) => {
      const cantidad = numero(u.quantity);
      if (!texto(u.material_name) || !cantidad || cantidad <= 0) return;
      const origen = matPorNombre.get(`${sector}|${norm(u.material_name)}`);
      usados.push({
        id_origen: `${o.id}:${i}`, sector_id: sector, ot_id: ot, material_id: origen ? matIds.get(origen) ?? null : null,
        descripcion: String(u.material_name).trim(), cantidad, costo_unitario: Math.max(0, numero(u.unit_cost) ?? 0), descontar: false,
      });
    });
  }
  if (escribe) await subir('ot_materiales', usados);

  r.cargar = mats.length + movs.length + reqs.length + usados.length;
  aviso(r, `Materiales: ${mats.length} · movimientos: ${movs.length} · requerimientos: ${reqs.length} (${items} ítems) · materiales anotados en órdenes: ${usados.length}.`);
  aviso(r, 'Las herramientas (categoría "herramientas") quedan marcadas como prestables; revisá las que en realidad se consumen.');
}

// ------------------------------------------------------------------ 16. control: informes y umbrales de alertas
const TIPOS_INFORME = ['avance_obra', 'inspeccion', 'mantenimiento', 'financiero', 'seguridad', 'final', 'otro'] as const;
const ESTADOS_INFORME = ['pendiente', 'en_preparacion', 'enviado', 'aprobado', 'rechazado'] as const;

async function migrarControl() {
  const informesV1 = await leerEntidad('Informe');
  const configsV1 = await leerEntidad('AlertaConfig');
  const r = nuevoResumen('control', informesV1.length + configsV1.length);
  const escribe = corre('control');

  // Informes. En la v1 no tenían sector: el de su responsable, el de quien lo creó o --sector-de=Informe:clave.
  const filas: Reg[] = [];
  for (const i of informesV1) {
    const responsable = buscarPerfil(i.responsable);
    const creador = buscarPerfil(i.created_by);
    const sector = sectorDe('Informe', i) ?? sectorDePerfil.get(responsable ?? '') ?? sectorDePerfil.get(creador ?? '') ?? null;
    if (!sector) { r.sinSector++; aviso(r, `Informe "${i.titulo ?? i.id}": sin sector. Usá --sector-de=Informe:<clave>.`); continue; }
    if (!texto(i.titulo)) { r.descartados++; continue; }
    // "vencido" era un estado en la v1; en v2 se calcula con la fecha límite.
    const estado = i.estado === 'vencido' ? 'pendiente' : enLista(i.estado, ESTADOS_INFORME, 'pendiente');
    filas.push({
      id_origen: i.id, sector_id: sector, codigo: texto(i.codigo) ?? `V1-${String(i.id).slice(-8)}`, titulo: i.titulo,
      tipo: enLista(i.tipo, TIPOS_INFORME, 'otro'), estado, prioridad: enLista(i.prioridad, ['baja', 'media', 'alta', 'urgente'] as const, 'media'),
      destinatario: texto(i.cliente_nombre), responsable_id: responsable, responsable_texto: responsable ? null : texto(i.responsable),
      fecha_limite: fecha(i.fecha_limite), fecha_envio: fecha(i.fecha_envio), fecha_aprobacion: fecha(i.fecha_aprobacion),
      descripcion: [texto(i.descripcion), texto(i.proyecto_nombre) ? `Proyecto en la v1: ${i.proyecto_nombre}` : null].filter(Boolean).join('\n') || null,
      observaciones: texto(i.observaciones), requiere_firma: i.requiere_firma === true, firma_obtenida: i.firma_obtenida === true,
      documentos: texto(i.archivo_url) ? docsV1([i.archivo_url]) : [], created_at: texto(i.created_date) ?? new Date().toISOString(),
    });
  }
  if (escribe) await subir('informes', filas);

  // Umbrales de alertas: los de la v1 (una configuración por tipo, sin sector) pasan a todos los sectores.
  const umbrales: Record<string, number> = {};
  for (const c of configsV1) {
    if (c.tipo === 'garantia_activo' && numero(c.dias_anticipacion) !== null) umbrales.dias_garantia = numero(c.dias_anticipacion)!;
    if (c.tipo === 'pendiente_vencido' && numero(c.dias_vencimiento_pendiente) !== null) umbrales.dias_pendiente = numero(c.dias_vencimiento_pendiente)!;
    if (c.tipo === 'ot_vencida' && numero(c.dias_vencimiento_ot) !== null) umbrales.dias_ot = numero(c.dias_vencimiento_ot)!;
    if (c.tipo === 'stock_material' && numero(c.umbral_stock_pct) !== null) umbrales.umbral_stock_pct = numero(c.umbral_stock_pct)!;
  }
  if (Object.keys(umbrales).length && escribe && APPLY && sb) {
    const { data } = await sb.from('sectores').select('id, config');
    for (const s of data ?? []) {
      await sb.from('sectores').update({ config: { ...(s.config ?? {}), alertas: { ...((s.config ?? {}).alertas ?? {}), ...umbrales } } }).eq('id', s.id);
    }
  }
  r.cargar = filas.length;
  aviso(r, `Informes: ${filas.length}${Object.keys(umbrales).length ? ` · umbrales de alertas de la v1: ${JSON.stringify(umbrales)}` : ''}.`);
  aviso(r, 'No se migran AuditLog ni AlertaLog: en la v1 la auditoría se podía falsificar y las alertas se recalculan solas en v2.');
}

// ------------------------------------------------------------------ 17. administración: riesgos y foro
const PROB_V2: Record<string, number> = { 'muy alta': 5, alta: 4, media: 3, baja: 2, 'muy baja': 1 };
const CONS_V2: Record<string, number> = { minima: 1, menor: 2, moderada: 4, mayor: 8, maxima: 16 };
// El campo viejo "sector" de RiesgoControl (antes de que hubiera sector_id).
const SECTOR_LEGADO: Record<string, string> = { educacion: 'escuela', bapro: 'bapro' };

async function migrarAdmin() {
  const riesgosV1 = await leerEntidad('RiesgoControl');
  const hilosV1 = await leerEntidad('ForoHilo');
  const respuestasV1 = await leerEntidad('ForoRespuesta');
  const r = nuevoResumen('admin', riesgosV1.length + hilosV1.length + respuestasV1.length);
  const escribe = corre('admin');

  const riesgos: Reg[] = [];
  for (const x of riesgosV1) {
    const sector = sectorDe('RiesgoControl', x) ?? (SECTOR_LEGADO[norm(x.sector)] ? sectores.get(SECTOR_LEGADO[norm(x.sector)]) ?? null : null);
    if (!sector) { r.sinSector++; aviso(r, `Riesgo "${x.evento_riesgo ?? x.id}" (${x.sector ?? 'sin sector'}): sin sector.`); continue; }
    const p = PROB_V2[norm(x.probabilidad)];
    const c = CONS_V2[norm(x.consecuencia)];
    if (!texto(x.evento_riesgo) || !p || !c) { r.descartados++; aviso(r, `Riesgo ${x.numero ?? x.id}: sin evento, probabilidad o consecuencia válidas.`); continue; }
    if (numero(x.nivel_riesgo) !== null && numero(x.nivel_riesgo) !== p * c) aviso(r, `Riesgo ${x.numero ?? x.id}: en la v1 tenía nivel ${x.nivel_riesgo}; en v2 se recalcula (${p * c}).`);
    riesgos.push({
      id_origen: x.id, sector_id: sector, numero: numero(x.numero), evento: x.evento_riesgo, probabilidad: p, consecuencia: c,
      metodo_control: texto(x.metodo_control), frecuencia: texto(x.frecuencia), en_alcance: !/^no/i.test(String(x.en_alcance ?? 'si')),
      estado: enLista(x.estado, ['activo', 'en_control', 'resuelto'] as const, 'activo'), comentarios: texto(x.comentarios),
    });
  }
  if (escribe) await subir('riesgos', riesgos);

  // Foro: hilos y respuestas (sin encuestas ni reacciones). El autor se busca por nombre; si no tiene usuario, queda el
  // nombre al principio del mensaje.
  const hilos: Reg[] = [];
  const sectorDeHilo = new Map<string, string>();
  for (const h of hilosV1) {
    const sector = sectorDe('ForoHilo', h);
    if (!sector) { r.sinSector++; aviso(r, `Foro "${h.titulo ?? h.id}": sin sector.`); continue; }
    if (!texto(h.titulo) || !texto(h.cuerpo)) { r.descartados++; continue; }
    const autor = buscarPerfil(h.autor_nombre);
    hilos.push({
      id_origen: h.id, sector_id: sector, titulo: h.titulo, categoria: norm(h.categoria_nombre) || 'general',
      cuerpo: autor || !texto(h.autor_nombre) ? h.cuerpo : `(${h.autor_nombre}) ${h.cuerpo}`, autor_id: autor,
      tipo: h.tipo === 'anuncio' ? 'anuncio' : 'hilo', fijado: h.fijado === true, cerrado: h.cerrado === true,
      created_at: texto(h.created_date) ?? new Date().toISOString(), ultima_actividad: texto(h.updated_date) ?? texto(h.created_date) ?? new Date().toISOString(),
    });
    sectorDeHilo.set(h.id, sector);
  }
  if (escribe) await subir('foro_hilos', hilos);
  const hiloIds = await mapaIds('foro_hilos', hilos.map((h) => h.id_origen));
  const resp: Reg[] = [];
  for (const x of respuestasV1) {
    const hilo = hiloIds.get(x.hilo_id);
    if (!hilo || !texto(x.cuerpo)) { r.descartados++; continue; }
    const autor = buscarPerfil(x.autor_nombre);
    resp.push({ id_origen: x.id, sector_id: sectorDeHilo.get(x.hilo_id), hilo_id: hilo, autor_id: autor,
      cuerpo: autor || !texto(x.autor_nombre) ? x.cuerpo : `(${x.autor_nombre}) ${x.cuerpo}`, created_at: texto(x.created_date) ?? new Date().toISOString() });
  }
  if (escribe) await subir('foro_respuestas', resp);

  r.cargar = riesgos.length + hilos.length + resp.length;
  aviso(r, `Riesgos: ${riesgos.length} · temas del foro: ${hilos.length} · respuestas: ${resp.length}. Encuestas y reacciones del foro no se migran.`);
}

// ------------------------------------------------------------------ corrida
console.log(`\nDH1 v1 → v2 · ${APPLY ? 'APLICANDO CAMBIOS en Supabase' : 'SIMULACRO (no escribe nada)'}${SOLO ? ` · solo ${SOLO}` : ''}`);
console.log(`Origen: ${DESDE ? `archivos de ${DESDE}` : 'API de Base44'} · Destino: ${sb ? SB_URL : 'sin conexión a Supabase (ids simulados)'}\n`);

// Los pasos anteriores siempre se leen y transforman (los siguientes necesitan sus mapas);
// con --solo, solo el paso elegido escribe.
const pasos: [string, () => Promise<void>][] = [
  ['sectores', migrarSectores], ['perfiles', migrarPerfiles], ['ubicaciones', migrarUbicaciones],
  ['activos', migrarActivos], ['plantillas', migrarPlantillas], ['ots', migrarOTs], ['certificados', migrarCertificados],
  ['rutinas', migrarRutinas], ['pendientes', migrarPendientes], ['emergencias', migrarEmergencias],
  ['calefaccion', migrarCalefaccion], ['inspecciones', migrarInspecciones], ['gente', migrarGente], ['obras', migrarObras], ['panol', migrarPanol], ['control', migrarControl], ['admin', migrarAdmin],
];
const hasta = SOLO ? PASOS.indexOf(SOLO) : PASOS.length - 1;
for (const [nombre, paso] of pasos.slice(0, hasta + 1)) {
  console.log(`· ${nombre}`);
  await paso();
}

console.log('\nResumen');
console.table(Object.fromEntries(Object.entries(reporte).map(([k, v]) => [k, { origen: v.origen, 'a cargar': v.cargar, 'sin sector': v.sinSector, descartados: v.descartados }])));

const totalSinSector = Object.values(reporte).reduce((t, v) => t + v.sinSector, 0);
for (const [paso, v] of Object.entries(reporte)) {
  if (v.avisos.length === 0) continue;
  console.log(`\nAvisos de ${paso} (${v.avisos.length}${v.avisos.length >= 200 ? ', se muestran los primeros 200' : ''}):`);
  for (const a of v.avisos.slice(0, 25)) console.log(`  - ${a}`);
  if (v.avisos.length > 25) console.log(`  … y ${v.avisos.length - 25} más en migracion/salida/reporte.json`);
}

await Deno.mkdir(SALIDA, { recursive: true });
await Deno.writeTextFile(`${SALIDA}/reporte.json`, JSON.stringify({ fecha: new Date().toISOString(), apply: APPLY, solo: SOLO, reporte }, null, 2));

// Control final: lo que quedó en destino contra lo que se mandó.
if (APPLY && sb) {
  console.log('\nControl de conteos en destino (registros con id_origen):');
  // (ubicaciones y rutinas cargan más de una tabla: su control se mira en el reporte, no acá)
  const tablas: [string, string][] = [['activos', 'activos'], ['plantillas', 'plantillas_ot'], ['ots', 'ordenes_trabajo'], ['certificados', 'certificados'],
    ['pendientes', 'pendientes'], ['emergencias', 'emergencias'], ['calefaccion', 'equipamiento_calefaccion'], ['inspecciones', 'inspecciones']];
  // (gente y obras cargan varias tablas: su detalle está en los avisos)
  for (const [paso, tabla] of tablas) {
    if (!reporte[paso] || !corre(paso)) continue;
    const { count } = await sb.from(tabla).select('id', { count: 'exact', head: true }).not('id_origen', 'is', null);
    const ok = count === reporte[paso].cargar;
    console.log(`  ${ok ? 'OK ' : 'OJO'} ${tabla}: ${count} en destino, ${reporte[paso].cargar} enviados`);
  }
}

if (totalSinSector > 0) {
  console.log(`\nATENCIÓN: ${totalSinSector} registros sin sector NO se cargan. Resolvelos en la v1 (backfill de sector_id)`);
  console.log('o, para entidades que no tenían sector, indicá --sector-de=Entidad:clave. Después volvé a correr.');
}
console.log(APPLY ? '\nListo. Reporte en migracion/salida/reporte.json' : '\nSimulacro terminado: no se escribió nada. Revisá el reporte y, si está bien, corré con --apply.');
