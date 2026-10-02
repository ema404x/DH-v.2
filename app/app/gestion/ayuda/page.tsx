'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, CircleHelp } from 'lucide-react';
import { Campo } from '@/components/Campos';
import { Chips } from '@/components/gestion/Piezas';

interface Guia {
  grupo: string;
  titulo: string;
  enlace?: string;
  quien: string;
  pasos: string[];
}

// Guías cortas de cada sección: qué es, quién la usa y cómo se hace lo más común.
const GUIAS: Guia[] = [
  { grupo: 'Campo', titulo: 'Mis órdenes (el teléfono en la obra)', enlace: '/mis-ots', quien: 'Todos',
    pasos: [
      'Entrás con tu usuario y ves las órdenes asignadas a vos (la tablet de cuadrilla ve las de su jefe de sitio).',
      'Funciona sin señal: lo que hagas queda guardado en el teléfono y se envía solo cuando vuelve la conexión.',
      'Para empezar una orden tocá "Iniciar"; marcá las tareas a medida que las hacés y sacá las fotos que pida.',
      'Al terminar tocá "Finalizar". Si quedó una tarea sin hacer, escribí el motivo: la orden pasa a validación del jefe de sitio.',
      'Si escaneás el QR de un lugar, ves solo las órdenes de ese lugar.',
    ] },
  { grupo: 'Campo', titulo: 'Fichar', enlace: '/mis-ots', quien: 'Todos; la tablet y los jefes fichan a su gente',
    pasos: [
      'En "Mis órdenes" está la tarjeta de fichaje: tocá Entrada al llegar y Salida al irte.',
      'Si estás lejos del lugar (más del radio del sector), el fichaje se guarda igual pero queda marcado.',
      'Sin señal, el fichaje queda en el teléfono con su hora real y se envía después.',
      'Quien no tiene usuario lo ficha la tablet de su cuadrilla o su jefe de sitio desde "Fichar a mi gente".',
    ] },
  { grupo: 'Campo', titulo: 'Reportar una emergencia', enlace: '/emergencia', quien: 'Todos',
    pasos: ['Desde "Mis órdenes" tocá "Reportar una emergencia", elegí el lugar, el tipo y contá qué pasa. Gerencia la ve al instante.'] },
  { grupo: 'Operación', titulo: 'Órdenes de trabajo', enlace: '/gestion/ots', quien: 'Gerencia y jefes de sitio',
    pasos: [
      'Nueva orden: título, tipo, prioridad, lugar y, si querés, una plantilla con la lista de tareas.',
      'Una orden puede colgar de una obra: así suma a la obra y sus materiales se cargan a esa obra.',
      'El operario la finaliza; el jefe de sitio la valida (o la rechaza con un comentario y vuelve al operario).',
      'En la orden se cargan las horas trabajadas y los materiales. "Imprimir la orden" arma la hoja para llevar al campo.',
    ] },
  { grupo: 'Operación', titulo: 'Pendientes SAP', enlace: '/gestion/pendientes', quien: 'Gerencia y jefes de sitio',
    pasos: [
      'Importá la planilla de órdenes de SAP (.xlsx): las que ya están cargadas no se pisan.',
      'Asignar un jefe pasa el pendiente a "Asignado". Cada cambio queda en el historial del pendiente.',
      'Las pestañas por zona muestran cuántos hay y cuántos están vencidos.',
    ] },
  { grupo: 'Operación', titulo: 'Rutinas y calendario', enlace: '/gestion/rutinas', quien: 'Gerencia y jefes de sitio',
    pasos: ['Las rutinas definen qué se revisa en cada lugar y cada cuánto; de ahí salen las órdenes preventivas.',
      'El calendario junta órdenes programadas, mantenimientos, rutinas, entregas de informes y devoluciones de herramientas.'] },
  { grupo: 'Operación', titulo: 'Control de riesgos', enlace: '/gestion/riesgos', quien: 'Gerencia y jefes de sitio (cargan); todos (consultan)',
    pasos: ['Cada riesgo tiene probabilidad y consecuencia; el nivel es el producto y define la clase (aceptable, tolerable, alto, extremo).',
      'La matriz muestra cuántos riesgos hay en cada celda: tocá una para ver cuáles son.', 'Las 5 reglas de oro de seguridad eléctrica están a mano en la misma pantalla.'] },
  { grupo: 'Obras', titulo: 'Obras y cobro de obras', enlace: '/gestion/obras', quien: 'Gerencia y jefes de sitio',
    pasos: [
      'Importá la planilla de obras de SAP: cada obra se reconoce por su N° de orden SAP y reimportar actualiza.',
      'En la ficha de la obra: documentos, órdenes de trabajo y su seguimiento de cobro.',
      'El cobro va por ciclo mensual: sumá obras o importá la planilla de certificación; "Cerrar el ciclo" pasa al siguiente lo que sigue en curso.',
      'La hoja por comuna se imprime o se guarda en PDF.',
    ] },
  { grupo: 'Obras', titulo: 'Certificación y abonos', enlace: '/gestion/certificacion', quien: 'Gerencia y jefes de sitio emiten; aprueba otra persona de gerencia',
    pasos: [
      'Un contrato tiene ítems; cada certificado mide lo del período y la base calcula acumulados y saldos.',
      'Quien emite no aprueba. Al aprobar se puede firmar (la firma queda en tu perfil para la próxima).',
      '"Abonos del mes" certifica de una vez todos los contratos de abono vigentes con la parte del mes.',
    ] },
  { grupo: 'Obras', titulo: 'Solicitudes de certificado', enlace: '/gestion/solicitudes', quien: 'Jefes de sitio piden; gerencia resuelve',
    pasos: ['Armá la solicitud con su obra, monto, avance y adjuntos y enviala.', 'Gerencia la revisa y la aprueba o la rechaza con el motivo; si la rechaza, se corrige y se reenvía.'] },
  { grupo: 'Pañol', titulo: 'Stock y movimientos', enlace: '/gestion/panol', quien: 'Gerencia y jefes de sitio',
    pasos: [
      'El stock cambia solo con movimientos: entrada, salida o ajuste por inventario. Nunca queda negativo.',
      'En una compra con costo, el costo del material pasa a ser el promedio.',
      'Importá el catálogo desde una planilla; marcá "inventario contado" para ajustar el stock a lo que dice.',
    ] },
  { grupo: 'Pañol', titulo: 'Préstamos y requerimientos de compra', enlace: '/gestion/prestamos', quien: 'Todos piden; gerencia y jefes de sitio prestan y reciben',
    pasos: ['Las herramientas marcadas "se presta" salen con nombre y fecha de devolución, y vuelven al stock.',
      'Un requerimiento de compra pasa por revisión y aprobación; al recibir la mercadería, lo del pañol entra al stock.'] },
  { grupo: 'Control', titulo: 'Alertas, reportes y auditoría', enlace: '/gestion/alertas', quien: 'Gerencia (auditoría); todos (alertas)',
    pasos: [
      'Las alertas se calculan al momento: vencidos, garantías, stock, préstamos, plazos de obra, emergencias. "Ya la vi" la oculta una semana.',
      'Reportes: elegí período, zona y jefe; todo se imprime o se baja en CSV.',
      'La auditoría registra quién cambió qué y cuándo en las secciones importantes. Nadie la puede modificar.',
    ] },
  { grupo: 'Equipo', titulo: 'Foro, sugerencias y perfil', enlace: '/gestion/foro', quien: 'Todos',
    pasos: ['En el foro se consultan cosas entre todos; los anuncios de gerencia quedan destacados.',
      'Si algo no anda o tenés una idea, mandala desde "Sugerencias y problemas": queda registrado y te responden ahí.',
      'En "Mi perfil" cambiás tu teléfono, tu firma y tu contraseña.'] },
];

// Centro de ayuda (en la v1, "Centro de Aprendizaje", con rutas que ya no existían).
export default function Ayuda() {
  const [grupo, setGrupo] = useState<string | null>(null);
  const [texto, setTexto] = useState('');
  const [abierta, setAbierta] = useState<string | null>(GUIAS[0].titulo);
  const grupos = [...new Set(GUIAS.map((g) => g.grupo))];
  const lista = useMemo(() => {
    const t = texto.trim().toLowerCase();
    return GUIAS.filter((g) => (!grupo || g.grupo === grupo) && (!t || `${g.titulo} ${g.pasos.join(' ')}`.toLowerCase().includes(t)));
  }, [grupo, texto]);

  return (
    <>
      <header>
        <h1>Ayuda</h1>
        <p className="text-suave">Cómo se usa cada sección. ¿No está lo que buscás? <Link href="/gestion/sugerencias" className="text-primario hover:underline">Preguntá desde Sugerencias</Link>.</p>
      </header>
      <div className="grid gap-3 md:grid-cols-[1fr_16rem] md:items-end">
        <Chips opciones={grupos.map((g) => ({ id: g, texto: g }))} valor={grupo} onCambio={setGrupo} todos="Todo" />
        <Campo etiqueta="Buscar en la ayuda" type="search" value={texto} onChange={(e) => setTexto(e.target.value)} />
      </div>
      {lista.length === 0 ? <p className="text-suave">No hay guías con ese texto.</p> : (
        <ul className="space-y-2">
          {lista.map((g) => {
            const abre = abierta === g.titulo || !!texto.trim();
            return (
              <li key={g.titulo} className="tarjeta">
                <button type="button" aria-expanded={abre} onClick={() => setAbierta(abre ? null : g.titulo)} className="flex w-full min-h-control items-center gap-3 text-left">
                  <CircleHelp className="h-5 w-5 shrink-0 text-primario" aria-hidden />
                  <span className="flex-1">
                    <span className="block font-medium">{g.titulo}</span>
                    <span className="block text-xs text-suave">{g.grupo} · {g.quien}</span>
                  </span>
                  <ChevronDown className={`h-5 w-5 text-suave transition-transform ${abre ? 'rotate-180' : ''}`} aria-hidden />
                </button>
                {abre && (
                  <div className="mt-3 space-y-2 pl-8">
                    <ol className="list-decimal space-y-1 pl-5">{g.pasos.map((p) => <li key={p}>{p}</li>)}</ol>
                    {g.enlace && <Link href={g.enlace} className="inline-flex min-h-control items-center text-primario hover:underline">Ir a la sección</Link>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
