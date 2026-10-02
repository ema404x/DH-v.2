'use client';

import { useMemo, useState, type FormEvent } from 'react';
import {
  AlertTriangle, CheckCircle2, Clock, Download, Link2, LogIn, Pencil, Plus, Save, Send, Tablet as IconoTablet, Trash2, UserCheck, UserX, Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { Boton } from '@/components/Boton';
import { Area, Campo, Casilla, Selector, oNull } from '@/components/Campos';
import { ErrorVista, Esqueleto, Vacio } from '@/components/Estados';
import { BuscadorRemoto } from '@/components/gestion/BuscadorRemoto';
import { Indicador, Indicadores, Pestanas, descargarCSV } from '@/components/gestion/Piezas';
import { Tabla, type Columna } from '@/components/gestion/Tabla';
import { limpiarError } from '@/lib/errores';
import {
  ESPECIALIDADES, ESTADOS_EMPLEADO, ORIGEN_FICHAJE, accesoDe, borrarEmpleado, borrarFichaje, borrarTablet, cargarFichaje, guardarEmpleado,
  guardarTablet, listarEmpleados, listarFichajes, listarJornadas, listarTablets, vincularEmpleados,
  type Empleado, type Especialidad, type EstadoEmpleado, type Fichaje, type Jornada, type Tablet, type TipoFichaje,
} from '@/lib/gente';
import { invitarUsuario } from '@/lib/gestion';
import { useCarga } from '@/lib/useCarga';
import { useSesion } from '@/lib/sesion';
import { ROLES, type ResultadoBusqueda, type Rol } from '@/lib/types';

type Tab = 'personal' | 'fichajes' | 'tablets';

const hora = (iso: string) => new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const dia = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' });
const fechaHora = (iso: string) => new Date(iso).toLocaleString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const hoyIso = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const haceDias = (n: number) => new Date(Date.now() - n * 86400000 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const horas = (n: number | null) => (n === null ? '—' : `${Number(n).toLocaleString('es-AR', { maximumFractionDigits: 2 })} h`);
const elegido = (id: string | null, etiqueta: string | null): ResultadoBusqueda | null => (id ? { id, etiqueta: etiqueta ?? 'Sin nombre', detalle: null } : null);

const TONO_ACCESO = { ok: 'text-exito', aviso: 'text-alerta', sin: 'text-suave' } as const;

// ------------------------------------------------------------------ ficha

function FormEmpleado({ empleado, onListo, onCancelar }: { empleado: Empleado | null; onListo: () => void; onCancelar: () => void }) {
  const { esGerencia, sectorEfectivo } = useSesion();
  const zonas = sectorEfectivo?.config?.zonas ?? [];
  const e = empleado;
  const [f, setF] = useState({
    nombre: e?.nombre ?? '', puesto: e?.puesto ?? '', especialidad: (e?.especialidad ?? 'general') as Especialidad,
    estado: (e?.estado ?? 'activo') as EstadoEmpleado, email: e?.email ?? '', telefono: e?.telefono ?? '', zona: e?.zona ?? '',
    fecha_ingreso: e?.fecha_ingreso ?? '', certificaciones: (e?.certificaciones ?? []).join(', '),
    dni: e?.dni ?? '', costo_hora: e?.costo_hora != null ? String(e.costo_hora) : '', contacto_emergencia: e?.contacto_emergencia ?? '',
    telefono_emergencia: e?.telefono_emergencia ?? '', notas: e?.notas ?? '',
  });
  const [jefe, setJefe] = useState(elegido(e?.jefe_sitio_id ?? null, e?.jefe_sitio_nombre ?? null));
  const [lugar, setLugar] = useState(elegido(e?.ubicacion_id ?? null, e?.ubicacion_nombre ?? null));
  const [guardando, setGuardando] = useState(false);
  const campo = (k: keyof typeof f) => ({ value: f[k], onChange: (ev: { target: { value: string } }) => setF((p) => ({ ...p, [k]: ev.target.value })) });

  async function guardar(ev: FormEvent) {
    ev.preventDefault();
    const costo = f.costo_hora.trim() === '' ? null : Number(f.costo_hora.replace(',', '.'));
    if (costo !== null && (Number.isNaN(costo) || costo < 0)) {
      toast.error('El costo por hora tiene que ser un número.');
      return;
    }
    setGuardando(true);
    try {
      await guardarEmpleado(
        e?.id ?? null,
        {
          nombre: f.nombre, puesto: oNull(f.puesto), especialidad: f.especialidad, estado: f.estado, email: oNull(f.email), telefono: oNull(f.telefono),
          jefe_sitio_id: jefe?.id ?? null, zona: oNull(f.zona), ubicacion_id: lugar?.id ?? null, fecha_ingreso: oNull(f.fecha_ingreso),
          certificaciones: f.certificaciones.split(',').map((c) => c.trim()).filter(Boolean),
        },
        esGerencia
          ? { dni: oNull(f.dni), costo_hora: costo, contacto_emergencia: oNull(f.contacto_emergencia), telefono_emergencia: oNull(f.telefono_emergencia), notas: oNull(f.notas) }
          : null,
      );
      toast.success(e ? 'Ficha actualizada.' : 'Empleado cargado.');
      onListo();
    } catch (err) {
      toast.error(limpiarError(err));
      setGuardando(false);
    }
  }

  return (
    <form onSubmit={guardar} className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1>{e ? e.nombre : 'Nuevo empleado'}</h1>
        <Boton variante="fantasma" onClick={onCancelar} disabled={guardando}>Volver a la lista</Boton>
      </header>

      <section className="tarjeta space-y-4">
        <h2>Ficha</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <Campo etiqueta="Nombre y apellido" required {...campo('nombre')} />
          <Campo etiqueta="Puesto" placeholder="Oficial, ayudante, capataz" {...campo('puesto')} />
          <Selector etiqueta="Especialidad" opciones={ESPECIALIDADES} value={f.especialidad} onChange={(ev) => setF((p) => ({ ...p, especialidad: ev.target.value as Especialidad }))} />
          <Selector etiqueta="Estado" opciones={ESTADOS_EMPLEADO} value={f.estado} onChange={(ev) => setF((p) => ({ ...p, estado: ev.target.value as EstadoEmpleado }))} />
          <Campo etiqueta="Correo" type="email" ayuda="Con el correo se engancha solo con su usuario, si lo tiene." {...campo('email')} />
          <Campo etiqueta="Teléfono" type="tel" {...campo('telefono')} />
          <BuscadorRemoto etiqueta="Jefe de sitio" tabla="jefes" valor={jefe} onCambio={setJefe} ayuda="Define en qué cuadrilla aparece para fichar." />
          {zonas.length > 0
            ? <Selector etiqueta="Zona" opciones={{ '': 'Sin zona', ...Object.fromEntries(zonas.map((z) => [z, z])) }} {...campo('zona')} />
            : <Campo etiqueta="Zona" {...campo('zona')} />}
          <BuscadorRemoto etiqueta="Lugar habitual de trabajo" tabla="ubicaciones" valor={lugar} onCambio={setLugar} />
          <Campo etiqueta="Fecha de ingreso" type="date" {...campo('fecha_ingreso')} />
          <div className="md:col-span-2">
            <Campo etiqueta="Certificaciones y habilitaciones" placeholder="Separadas por coma: Gasista matriculado, Trabajo en altura" {...campo('certificaciones')} />
          </div>
        </div>
      </section>

      {esGerencia && (
        <section className="tarjeta space-y-4">
          <div>
            <h2>Datos reservados</h2>
            <p className="text-sm text-suave">Los ve solo gerencia y el propio empleado.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Campo etiqueta="DNI" inputMode="numeric" {...campo('dni')} />
            <Campo etiqueta="Costo por hora ($)" inputMode="decimal" ayuda="Se usa para costear las horas cargadas a las órdenes." {...campo('costo_hora')} />
            <Campo etiqueta="Contacto de emergencia" {...campo('contacto_emergencia')} />
            <Campo etiqueta="Teléfono de emergencia" type="tel" {...campo('telefono_emergencia')} />
            <div className="md:col-span-2"><Area etiqueta="Notas" {...campo('notas')} /></div>
          </div>
        </section>
      )}

      <Boton type="submit" variante="primario" icono={Save} cargando={guardando}>Guardar ficha</Boton>
    </form>
  );
}

// Invitar al empleado a tener usuario. Lo hace la misma función que en Usuarios: solo un administrador.
function Invitar({ empleado, onListo }: { empleado: Empleado; onListo: () => void }) {
  const { sectorEfectivo } = useSesion();
  const [rol, setRol] = useState<Rol>('operario');
  const [enviando, setEnviando] = useState(false);

  async function enviar() {
    if (!empleado.email || !sectorEfectivo) return;
    setEnviando(true);
    try {
      await invitarUsuario({ email: empleado.email, nombre: empleado.nombre, rol, sector_id: sectorEfectivo.id });
      toast.success(`Invitación enviada a ${empleado.email}. Le llega un correo para crear su contraseña.`);
      onListo();
    } catch (e) {
      toast.error(limpiarError(e));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select className="control w-auto min-w-[9rem]" aria-label={`Rol para ${empleado.nombre}`} value={rol} onChange={(e) => setRol(e.target.value as Rol)}>
        {Object.entries(ROLES).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
      </select>
      <Boton icono={Send} cargando={enviando} onClick={enviar}>Invitar</Boton>
    </div>
  );
}

function Personal() {
  const { esGerencia, perfil } = useSesion();
  const esAdmin = perfil?.rol === 'admin';
  const carga = useCarga(listarEmpleados, []);
  const [vista, setVista] = useState<{ tipo: 'lista' } | { tipo: 'ficha'; empleado: Empleado | null }>({ tipo: 'lista' });
  const [q, setQ] = useState('');
  const [estado, setEstado] = useState<'vigentes' | EstadoEmpleado | 'todos'>('vigentes');
  const [soloSinAcceso, setSoloSinAcceso] = useState(false);
  const [vinculando, setVinculando] = useState(false);

  const todos = carga.datos ?? [];
  const filtrados = useMemo(() => {
    const t = q.trim().toLowerCase();
    return todos.filter((e) =>
      (estado === 'todos' || (estado === 'vigentes' ? e.estado !== 'inactivo' : e.estado === estado))
      && (!soloSinAcceso || accesoDe(e).nivel === 'aviso')
      && (!t || [e.nombre, e.puesto, e.email, e.jefe_sitio_nombre, e.zona].some((x) => (x ?? '').toLowerCase().includes(t))));
  }, [todos, q, estado, soloSinAcceso]);

  const vigentes = todos.filter((e) => e.estado !== 'inactivo');
  const adentro = vigentes.filter((e) => e.ultimo_fichaje_tipo === 'entrada' && e.ultimo_fichaje_momento && Date.now() - new Date(e.ultimo_fichaje_momento).getTime() < 16 * 3600000);
  const conAviso = vigentes.filter((e) => accesoDe(e).nivel === 'aviso');

  async function vincular() {
    setVinculando(true);
    try {
      const n = await vincularEmpleados();
      toast.success(n === 0 ? 'No había fichas para vincular: ninguna coincide por correo con un usuario sin ficha.' : n === 1 ? 'Se vinculó 1 ficha con su usuario.' : `Se vincularon ${n} fichas con sus usuarios.`);
      await carga.recargar();
    } catch (e) {
      toast.error(limpiarError(e));
    } finally {
      setVinculando(false);
    }
  }

  async function borrar(e: Empleado) {
    if (!window.confirm(`¿Borrar la ficha de ${e.nombre}? Se borran también sus fichajes. Si solo dejó de trabajar, conviene pasarla a "Dado de baja".`)) return;
    try {
      await borrarEmpleado(e.id);
      toast.success('Ficha borrada.');
      await carga.recargar();
    } catch (err) {
      toast.error(limpiarError(err));
    }
  }

  if (vista.tipo === 'ficha') {
    return <FormEmpleado empleado={vista.empleado} onCancelar={() => setVista({ tipo: 'lista' })} onListo={() => { setVista({ tipo: 'lista' }); void carga.recargar(); }} />;
  }

  const columnas: Columna<Empleado>[] = [
    {
      titulo: 'Empleado',
      celda: (e) => (
        <>
          <span className="font-medium">{e.nombre}</span>
          <span className="block text-xs text-suave">{[e.puesto, ESPECIALIDADES[e.especialidad] !== 'General' ? ESPECIALIDADES[e.especialidad] : null, e.telefono].filter(Boolean).join(' · ') || 'Sin puesto cargado'}</span>
        </>
      ),
    },
    { titulo: 'Estado', celda: (e) => <span className={e.estado === 'activo' ? '' : 'text-alerta'}>{ESTADOS_EMPLEADO[e.estado]}</span>, secundaria: true },
    {
      titulo: 'Jefe de sitio',
      secundaria: true,
      celda: (e) => (
        <>
          {e.jefe_sitio_nombre ?? <span className="text-suave">Sin jefe</span>}
          <span className="block text-xs text-suave">{[e.zona, e.ubicacion_nombre, e.lugares_a_cargo > 0 ? (e.lugares_a_cargo === 1 ? '1 lugar a cargo' : `${e.lugares_a_cargo} lugares a cargo`) : null].filter(Boolean).join(' · ')}</span>
        </>
      ),
    },
    {
      titulo: 'Fichaje',
      secundaria: true,
      celda: (e) => e.ultimo_fichaje_momento ? (
        <>
          <span className={`inline-flex items-center gap-1.5 ${e.ultimo_fichaje_tipo === 'entrada' ? 'text-exito' : ''}`}>
            <LogIn className="h-4 w-4" aria-hidden />{e.ultimo_fichaje_tipo === 'entrada' ? 'Entrada' : 'Salida'} · {fechaHora(e.ultimo_fichaje_momento)}
          </span>
          {e.ultimo_fichaje_lugar && <span className="block text-xs text-suave">{e.ultimo_fichaje_lugar}</span>}
        </>
      ) : <span className="text-suave">Sin fichajes</span>,
    },
    {
      titulo: 'Acceso al sistema',
      celda: (e) => {
        const a = accesoDe(e);
        return (
          <div className="space-y-1">
            <span className={`inline-flex items-center gap-1.5 text-sm ${TONO_ACCESO[a.nivel]}`} title={a.detalle}>
              {a.nivel === 'ok' ? <UserCheck className="h-4 w-4" aria-hidden /> : a.nivel === 'aviso' ? <AlertTriangle className="h-4 w-4" aria-hidden /> : <UserX className="h-4 w-4" aria-hidden />}
              {a.texto}{e.usuario_rol ? ` · ${ROLES[e.usuario_rol]}` : ''}
            </span>
            {esAdmin && !e.perfil_id && e.email && e.estado !== 'inactivo' && <Invitar empleado={e} onListo={carga.recargar} />}
          </div>
        );
      },
    },
    ...(esGerencia ? [{
      titulo: '',
      celda: (e: Empleado) => (
        <div className="flex flex-wrap justify-end gap-1">
          <Boton variante="fantasma" icono={Pencil} onClick={() => setVista({ tipo: 'ficha', empleado: e })}>Editar</Boton>
          <Boton variante="fantasma" icono={Trash2} onClick={() => borrar(e)}>Borrar</Boton>
        </div>
      ),
    } satisfies Columna<Empleado>] : []),
  ];

  return (
    <>
      <Indicadores>
        <Indicador titulo="Empleados" valor={vigentes.length} icono={Users} nota={todos.length > vigentes.length ? `${todos.length - vigentes.length} dados de baja` : undefined} />
        <Indicador titulo="Adentro ahora" valor={adentro.length} icono={Clock} tono={adentro.length > 0 ? 'exito' : 'neutro'} nota="Con entrada y sin salida" />
        <Indicador titulo="Con usuario" valor={vigentes.filter((e) => e.perfil_id).length} icono={UserCheck} />
        <Indicador titulo="Con correo y sin usuario" valor={conAviso.length} icono={AlertTriangle} tono={conAviso.length > 0 ? 'alerta' : 'neutro'} />
      </Indicadores>

      <div className="grid gap-3 md:grid-cols-[1fr_14rem_auto_auto] md:items-end">
        <Campo etiqueta="Buscar por nombre, puesto, correo, jefe o zona" type="search" value={q} onChange={(e) => setQ(e.target.value)} />
        <Selector etiqueta="Estado" value={estado} onChange={(e) => setEstado(e.target.value as typeof estado)}
          opciones={{ vigentes: 'Vigentes', ...ESTADOS_EMPLEADO, todos: 'Todos' }} />
        <Casilla etiqueta="Solo con aviso de acceso" checked={soloSinAcceso} onChange={(e) => setSoloSinAcceso(e.target.checked)} />
        {esGerencia && <Boton icono={Link2} cargando={vinculando} onClick={vincular}>Vincular con usuarios</Boton>}
      </div>

      {carga.cargando && !carga.datos ? (
        <Esqueleto filas={5} />
      ) : carga.error ? (
        <ErrorVista mensaje={carga.error} onReintentar={carga.recargar} />
      ) : todos.length === 0 ? (
        <Vacio icono={Users} titulo="Todavía no hay empleados" texto="Cargá la ficha de cada persona. Con la ficha puede fichar, aparecer en su cuadrilla y sumar horas a las órdenes." />
      ) : filtrados.length === 0 ? (
        <Vacio icono={Users} titulo="Nadie coincide con ese filtro" texto="Probá con otro texto u otro estado." />
      ) : (
        <Tabla columnas={columnas} filas={filtrados} clave={(e) => e.id} />
      )}

      {esGerencia && (
        <div className="flex justify-end">
          <Boton variante="primario" icono={Plus} onClick={() => setVista({ tipo: 'ficha', empleado: null })}>Nuevo empleado</Boton>
        </div>
      )}
    </>
  );
}

// ------------------------------------------------------------------ fichajes

function CargarFichaje({ empleados, onListo, onCancelar }: { empleados: Empleado[]; onListo: () => void; onCancelar: () => void }) {
  const [empleado, setEmpleado] = useState('');
  const [tipo, setTipo] = useState<TipoFichaje>('entrada');
  const [cuando, setCuando] = useState(() => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16));
  const [lugar, setLugar] = useState<ResultadoBusqueda | null>(null);
  const [nota, setNota] = useState('');
  const [guardando, setGuardando] = useState(false);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (!empleado) {
      toast.error('Elegí a quién le cargás el fichaje.');
      return;
    }
    setGuardando(true);
    try {
      await cargarFichaje({ empleado_id: empleado, tipo, momento: new Date(cuando).toISOString(), ubicacion_id: lugar?.id ?? null, nota: oNull(nota) });
      toast.success('Fichaje cargado.');
      onListo();
    } catch (err) {
      toast.error(limpiarError(err));
      setGuardando(false);
    }
  }

  return (
    <form onSubmit={guardar} className="tarjeta space-y-4">
      <div>
        <h2>Cargar un fichaje a mano</h2>
        <p className="text-sm text-suave">Para una marca que faltó. Queda anotado quién la cargó. Un jefe de sitio puede cargar hasta 3 días para atrás; gerencia, cualquier fecha.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Selector etiqueta="Empleado" value={empleado} onChange={(e) => setEmpleado(e.target.value)}
          opciones={{ '': 'Elegí a la persona', ...Object.fromEntries(empleados.filter((x) => x.estado !== 'inactivo').map((x) => [x.id, x.nombre])) }} />
        <Selector etiqueta="Tipo" value={tipo} onChange={(e) => setTipo(e.target.value as TipoFichaje)} opciones={{ entrada: 'Entrada', salida: 'Salida' }} />
        <Campo etiqueta="Día y hora" type="datetime-local" required value={cuando} onChange={(e) => setCuando(e.target.value)} />
        <BuscadorRemoto etiqueta="Lugar (opcional)" tabla="ubicaciones" valor={lugar} onCambio={setLugar} />
        <div className="md:col-span-2"><Campo etiqueta="Motivo" placeholder="Por qué se carga a mano" value={nota} onChange={(e) => setNota(e.target.value)} /></div>
      </div>
      <div className="flex flex-wrap gap-3">
        <Boton type="submit" variante="primario" icono={Save} cargando={guardando}>Cargar fichaje</Boton>
        <Boton variante="fantasma" onClick={onCancelar} disabled={guardando}>Cancelar</Boton>
      </div>
    </form>
  );
}

function Fichajes() {
  const { esGerencia, puedeValidar } = useSesion();
  const [desde, setDesde] = useState(() => haceDias(6));
  const [hasta, setHasta] = useState(hoyIso);
  const [empleado, setEmpleado] = useState('');
  const [modo, setModo] = useState<'jornadas' | 'marcas'>('jornadas');
  const [cargando, setCargando] = useState(false);
  const empleados = useCarga(listarEmpleados, []);
  const carga = useCarga(
    async () => {
      const f = { desde, hasta, empleado: empleado || undefined };
      const [jornadas, marcas] = await Promise.all([listarJornadas(f), listarFichajes(f)]);
      return { jornadas, marcas };
    },
    [desde, hasta, empleado],
  );
  const jornadas = carga.datos?.jornadas ?? [];
  const marcas = carga.datos?.marcas ?? [];
  const total = jornadas.reduce((t, j) => t + Number(j.horas ?? 0), 0);
  const abiertas = jornadas.filter((j) => !j.salida && j.dia !== hoyIso()).length;
  const lejos = marcas.filter((m) => m.lejos).length;

  function exportar() {
    descargarCSV(`fichajes-${desde}-a-${hasta}.csv`,
      ['Día', 'Empleado', 'Puesto', 'Entrada', 'Salida', 'Horas', 'Lugar', 'Lejos del lugar'],
      jornadas.map((j) => [j.dia, j.empleado_nombre, j.empleado_puesto, hora(j.entrada), j.salida ? hora(j.salida) : '', j.horas ?? '', j.ubicacion_nombre, j.lejos ? 'Sí' : '']));
  }

  async function borrar(m: Fichaje) {
    if (!window.confirm(`¿Borrar la ${m.tipo} de ${m.empleado_nombre} del ${fechaHora(m.momento)}?`)) return;
    try {
      await borrarFichaje(m.id);
      toast.success('Fichaje borrado.');
      await carga.recargar();
    } catch (e) {
      toast.error(limpiarError(e));
    }
  }

  if (cargando) {
    return <CargarFichaje empleados={empleados.datos ?? []} onCancelar={() => setCargando(false)} onListo={() => { setCargando(false); void carga.recargar(); }} />;
  }

  const colJornadas: Columna<Jornada>[] = [
    { titulo: 'Día', celda: (j) => <span className="capitalize">{dia(j.dia)}</span> },
    { titulo: 'Empleado', celda: (j) => (<><span className="font-medium">{j.empleado_nombre}</span>{j.empleado_puesto && <span className="block text-xs text-suave">{j.empleado_puesto}</span>}</>) },
    { titulo: 'Entrada', celda: (j) => hora(j.entrada), numerica: true },
    {
      titulo: 'Salida',
      numerica: true,
      // Hoy, una entrada sin salida es alguien trabajando; de un día anterior, una salida que faltó marcar.
      celda: (j) => (j.salida ? hora(j.salida) : j.dia === hoyIso()
        ? <span className="inline-flex items-center gap-1 text-exito"><Clock className="h-4 w-4" aria-hidden />Adentro</span>
        : <span className="inline-flex items-center gap-1 text-alerta"><AlertTriangle className="h-4 w-4" aria-hidden />Sin salida</span>),
    },
    { titulo: 'Horas', celda: (j) => horas(j.horas), numerica: true },
    {
      titulo: 'Lugar',
      secundaria: true,
      celda: (j) => (<>{j.ubicacion_nombre ?? <span className="text-suave">Sin lugar</span>}{j.lejos && <span className="block text-xs text-alerta">Fichó lejos del lugar</span>}</>),
    },
  ];
  const colMarcas: Columna<Fichaje>[] = [
    { titulo: 'Cuándo', celda: (m) => fechaHora(m.momento) },
    { titulo: 'Empleado', celda: (m) => <span className="font-medium">{m.empleado_nombre}</span> },
    { titulo: 'Marca', celda: (m) => <span className={m.tipo === 'entrada' ? 'text-exito' : ''}>{m.tipo === 'entrada' ? 'Entrada' : 'Salida'}</span> },
    {
      titulo: 'Lugar',
      secundaria: true,
      celda: (m) => (
        <>
          {m.ubicacion_nombre ?? <span className="text-suave">Sin lugar</span>}
          {m.distancia_m !== null && <span className={`block text-xs ${m.lejos ? 'text-alerta' : 'text-suave'}`}>a {m.distancia_m >= 1000 ? `${(m.distancia_m / 1000).toFixed(1).replace('.', ',')} km` : `${m.distancia_m} m`}{m.lejos ? ' · lejos' : ''}</span>}
        </>
      ),
    },
    {
      titulo: 'Cómo se registró',
      secundaria: true,
      celda: (m) => (<>{ORIGEN_FICHAJE[m.origen] ?? m.origen}{m.origen !== 'propio' && m.registrado_por_nombre && <span className="block text-xs text-suave">{m.registrado_por_nombre}</span>}{m.notas && <span className="block text-xs text-suave">{m.notas}</span>}</>),
    },
    ...(esGerencia ? [{ titulo: '', celda: (m: Fichaje) => <Boton variante="fantasma" icono={Trash2} onClick={() => borrar(m)}>Borrar</Boton> } satisfies Columna<Fichaje>] : []),
  ];

  return (
    <>
      <Indicadores>
        <Indicador titulo="Horas en el período" valor={horas(total)} icono={Clock} />
        <Indicador titulo="Jornadas" valor={jornadas.length} icono={CheckCircle2} />
        <Indicador titulo="Sin salida" valor={abiertas} icono={AlertTriangle} tono={abiertas > 0 ? 'alerta' : 'neutro'} nota="De días anteriores" />
        <Indicador titulo="Marcas lejos del lugar" valor={lejos} icono={AlertTriangle} tono={lejos > 0 ? 'alerta' : 'neutro'} />
      </Indicadores>

      <div className="grid gap-3 md:grid-cols-[10rem_10rem_1fr_12rem] md:items-end">
        <Campo etiqueta="Desde" type="date" value={desde} max={hasta} onChange={(e) => e.target.value && setDesde(e.target.value)} />
        <Campo etiqueta="Hasta" type="date" value={hasta} min={desde} onChange={(e) => e.target.value && setHasta(e.target.value)} />
        <Selector etiqueta="Empleado" value={empleado} onChange={(e) => setEmpleado(e.target.value)}
          opciones={{ '': 'Todos', ...Object.fromEntries((empleados.datos ?? []).map((x) => [x.id, x.nombre])) }} />
        <Selector etiqueta="Ver" value={modo} onChange={(e) => setModo(e.target.value as typeof modo)} opciones={{ jornadas: 'Jornadas', marcas: 'Marcas una por una' }} />
      </div>

      {carga.cargando && !carga.datos ? (
        <Esqueleto filas={5} />
      ) : carga.error ? (
        <ErrorVista mensaje={carga.error} onReintentar={carga.recargar} />
      ) : marcas.length === 0 ? (
        <Vacio icono={Clock} titulo="No hay fichajes en esas fechas" texto="Las marcas aparecen cuando la gente ficha desde su teléfono, desde la tablet de la cuadrilla o cuando se cargan a mano." />
      ) : modo === 'jornadas' ? (
        <Tabla columnas={colJornadas} filas={jornadas} clave={(j) => j.id} />
      ) : (
        <Tabla columnas={colMarcas} filas={marcas} clave={(m) => m.id} />
      )}

      <div className="flex flex-wrap justify-end gap-2">
        <Boton icono={Download} disabled={jornadas.length === 0} onClick={exportar}>Exportar jornadas</Boton>
        {puedeValidar && <Boton variante="primario" icono={Plus} onClick={() => setCargando(true)}>Cargar fichaje</Boton>}
      </div>
    </>
  );
}

// ------------------------------------------------------------------ tablets

function FormTablet({ tablet, onListo, onCancelar }: { tablet: Tablet | null; onListo: () => void; onCancelar: () => void }) {
  const [nombre, setNombre] = useState(tablet?.nombre ?? '');
  const [jefe, setJefe] = useState(elegido(tablet?.jefe_sitio_id ?? null, tablet?.jefe_sitio_nombre ?? null));
  const [usuario, setUsuario] = useState(elegido(tablet?.perfil_id ?? null, tablet?.usuario_nombre ?? null));
  const [activa, setActiva] = useState(tablet?.activa ?? true);
  const [notas, setNotas] = useState(tablet?.notas ?? '');
  const [guardando, setGuardando] = useState(false);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (!jefe) {
      toast.error('Elegí el jefe de sitio de la cuadrilla.');
      return;
    }
    setGuardando(true);
    try {
      await guardarTablet(tablet?.id ?? null, { nombre, jefe_sitio_id: jefe.id, perfil_id: usuario?.id ?? null, activa, notas: oNull(notas) });
      toast.success(tablet ? 'Tablet actualizada.' : 'Tablet cargada.');
      onListo();
    } catch (err) {
      toast.error(limpiarError(err));
      setGuardando(false);
    }
  }

  return (
    <form onSubmit={guardar} className="tarjeta space-y-4">
      <h2>{tablet ? `Tablet ${tablet.nombre}` : 'Nueva tablet de cuadrilla'}</h2>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-suave">
        <li>En Usuarios, invitá un usuario para la tablet (rol Operario) con un correo propio de la tablet.</li>
        <li>Elegí acá ese usuario y el jefe de sitio de la cuadrilla.</li>
        <li>En la tablet, ingresá con ese usuario: va a ver las órdenes de los lugares de ese jefe y va a poder fichar a su gente.</li>
      </ol>
      <div className="grid gap-4 md:grid-cols-2">
        <Campo etiqueta="Nombre de la tablet" required placeholder="Tablet 1" value={nombre} onChange={(e) => setNombre(e.target.value)} />
        <BuscadorRemoto etiqueta="Jefe de sitio" tabla="jefes" valor={jefe} onCambio={setJefe} />
        <BuscadorRemoto etiqueta="Usuario de la tablet" tabla="perfiles" valor={usuario} onCambio={setUsuario} ayuda="Sin usuario, la tablet queda cargada pero no se puede usar." />
        <Campo etiqueta="Notas" value={notas} onChange={(e) => setNotas(e.target.value)} />
      </div>
      <Casilla etiqueta="Activa" checked={activa} onChange={(e) => setActiva(e.target.checked)} />
      <div className="flex flex-wrap gap-3">
        <Boton type="submit" variante="primario" icono={Save} cargando={guardando}>Guardar tablet</Boton>
        <Boton variante="fantasma" onClick={onCancelar} disabled={guardando}>Cancelar</Boton>
      </div>
    </form>
  );
}

function Tablets() {
  const { esGerencia } = useSesion();
  const carga = useCarga(listarTablets, []);
  const [vista, setVista] = useState<{ tipo: 'lista' } | { tipo: 'form'; tablet: Tablet | null }>({ tipo: 'lista' });

  async function borrar(t: Tablet) {
    if (!window.confirm(`¿Borrar la tablet ${t.nombre}? Su usuario deja de ver las órdenes de la cuadrilla.`)) return;
    try {
      await borrarTablet(t.id);
      toast.success('Tablet borrada.');
      await carga.recargar();
    } catch (e) {
      toast.error(limpiarError(e));
    }
  }

  if (vista.tipo === 'form') {
    return <FormTablet tablet={vista.tablet} onCancelar={() => setVista({ tipo: 'lista' })} onListo={() => { setVista({ tipo: 'lista' }); void carga.recargar(); }} />;
  }

  const columnas: Columna<Tablet>[] = [
    { titulo: 'Tablet', celda: (t) => (<><span className="font-medium">{t.nombre}</span>{t.notas && <span className="block text-xs text-suave">{t.notas}</span>}</>) },
    { titulo: 'Jefe de sitio', celda: (t) => (<>{t.jefe_sitio_nombre ?? '—'}<span className="block text-xs text-suave">{t.cuadrilla === 1 ? '1 persona en la cuadrilla' : `${t.cuadrilla} personas en la cuadrilla`}</span></>) },
    {
      titulo: 'Usuario',
      secundaria: true,
      celda: (t) => t.perfil_id
        ? (<>{t.usuario_nombre}<span className="block text-xs text-suave">{t.usuario_email}</span></>)
        : <span className="inline-flex items-center gap-1 text-alerta"><AlertTriangle className="h-4 w-4" aria-hidden />Sin usuario</span>,
    },
    { titulo: 'Última actividad', secundaria: true, celda: (t) => (t.ultima_actividad ? fechaHora(t.ultima_actividad) : <span className="text-suave">Nunca ingresó</span>) },
    { titulo: 'Estado', celda: (t) => (t.activa ? <span className="text-exito">Activa</span> : <span className="text-suave">Desactivada</span>) },
    ...(esGerencia ? [{
      titulo: '',
      celda: (t: Tablet) => (
        <div className="flex flex-wrap justify-end gap-1">
          <Boton variante="fantasma" icono={Pencil} onClick={() => setVista({ tipo: 'form', tablet: t })}>Editar</Boton>
          <Boton variante="fantasma" icono={Trash2} onClick={() => borrar(t)}>Borrar</Boton>
        </div>
      ),
    } satisfies Columna<Tablet>] : []),
  ];

  return (
    <>
      {carga.cargando && !carga.datos ? (
        <Esqueleto filas={3} />
      ) : carga.error ? (
        <ErrorVista mensaje={carga.error} onReintentar={carga.recargar} />
      ) : (carga.datos ?? []).length === 0 ? (
        <Vacio icono={IconoTablet} titulo="No hay tablets de cuadrilla"
          texto="Una tablet es un usuario compartido por la cuadrilla de un jefe de sitio: ve las órdenes de sus lugares y ficha a la gente que no tiene usuario propio." />
      ) : (
        <Tabla columnas={columnas} filas={carga.datos ?? []} clave={(t) => t.id} />
      )}
      {esGerencia && (
        <div className="flex justify-end">
          <Boton variante="primario" icono={Plus} onClick={() => setVista({ tipo: 'form', tablet: null })}>Nueva tablet</Boton>
        </div>
      )}
    </>
  );
}

// Empleados: fichas, fichajes y tablets de cuadrilla.
export default function PaginaEmpleados() {
  const [tab, setTab] = useState<Tab>('personal');
  return (
    <>
      <header>
        <h1>Empleados</h1>
        <p className="text-suave">Fichas del personal, fichajes y tablets de cuadrilla</p>
      </header>
      <Pestanas activa={tab} onCambio={setTab}
        pestanas={[{ id: 'personal', texto: 'Personal' }, { id: 'fichajes', texto: 'Fichajes' }, { id: 'tablets', texto: 'Tablets de cuadrilla' }]} />
      {tab === 'personal' ? <Personal /> : tab === 'fichajes' ? <Fichajes /> : <Tablets />}
    </>
  );
}
