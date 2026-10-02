'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CalendarCheck, FileSpreadsheet, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Boton } from '@/components/Boton';
import { Campo } from '@/components/Campos';
import { AvisoBadge } from '@/components/EstadoBadge';
import { ErrorVista, Esqueleto, Vacio } from '@/components/Estados';
import { FormContrato } from '@/components/gestion/FormContrato';
import { Tabla, type Columna } from '@/components/gestion/Tabla';
import { fmtPesos, listarContratos } from '@/lib/certificacion';
import { certificarAbonosDelMes, type ResultadoAbono } from '@/lib/obras';
import { limpiarError } from '@/lib/errores';
import { useCarga } from '@/lib/useCarga';
import { useSesion } from '@/lib/sesion';
import type { Contrato } from '@/lib/types';

const COLUMNAS: Columna<Contrato>[] = [
  {
    titulo: 'Contrato',
    celda: (k) => (
      <Link href={`/gestion/certificacion/${k.id}`} className="block min-h-control font-medium text-primario hover:underline">
        {k.contratista}
        <span className="block text-xs font-normal text-suave">
          {[k.obra_servicio, k.ada_numero && `ADA ${k.ada_numero}`, k.oc_numero && `OC ${k.oc_numero}`].filter(Boolean).join(' · ')}
        </span>
      </Link>
    ),
  },
  {
    titulo: 'Situación',
    celda: (k) => (
      <div className="flex flex-col items-start gap-1">
        {k.por_aprobar > 0 && <AvisoBadge texto={k.por_aprobar === 1 ? '1 por aprobar' : `${k.por_aprobar} por aprobar`} />}
        {k.borrador_id && <AvisoBadge texto="Borrador abierto" tono="info" />}
        {k.por_aprobar === 0 && !k.borrador_id && <span className="text-suave">{k.certificados_total === 0 ? 'Sin certificados' : `Último: N° ${k.ultimo_numero}`}</span>}
      </div>
    ),
  },
  { titulo: 'Contratado', celda: (k) => fmtPesos(k.monto_contratado), numerica: true, secundaria: true },
  { titulo: 'Certificado', celda: (k) => fmtPesos(k.certificado_importe), numerica: true, secundaria: true },
  { titulo: 'Avance', celda: (k) => `${Number(k.porcentaje_certificado).toLocaleString('es-AR')} %`, numerica: true },
];

const TONO_ABONO: Record<ResultadoAbono['resultado'], string> = {
  emitido: 'text-exito', ya_certificado: 'text-suave', con_borrador: 'text-alerta', sin_fechas: 'text-alerta', fuera_de_plazo: 'text-suave', error: 'text-peligro',
};

// Certifica de una vez el mes de todos los contratos de abono: cada uno recibe su parte (cantidad ÷ meses de vigencia).
function AbonosDelMes({ onListo }: { onListo: () => void }) {
  const hoy = new Date();
  const [mes, setMes] = useState(`${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`);
  const [trabajando, setTrabajando] = useState(false);
  const [resultado, setResultado] = useState<{ periodo: string; contratos: ResultadoAbono[] } | null>(null);

  async function certificar() {
    setTrabajando(true);
    try {
      const r = await certificarAbonosDelMes(`${mes}-01`);
      setResultado(r);
      const emitidos = r.contratos.filter((c) => c.resultado === 'emitido').length;
      if (emitidos === 0) toast.info('No se emitió ningún certificado: mirá el detalle de cada contrato.');
      else toast.success(emitidos === 1 ? '1 certificado emitido.' : `${emitidos} certificados emitidos.`);
      onListo();
    } catch (e) {
      toast.error(limpiarError(e));
    } finally {
      setTrabajando(false);
    }
  }

  return (
    <section className="tarjeta space-y-3">
      <h2>Abonos del mes</h2>
      <p className="text-sm text-suave">
        Crea y emite el certificado del mes de cada contrato de abono vigente, con la parte proporcional de cada ítem; el último mes completa lo que falte.
        Los que ya tienen ese mes certificado se saltean. Después los aprueba otra persona de gerencia.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-48"><Campo etiqueta="Mes" type="month" value={mes} onChange={(e) => setMes(e.target.value)} /></div>
        <Boton icono={CalendarCheck} cargando={trabajando} disabled={!mes} onClick={certificar}>Certificar abonos del mes</Boton>
      </div>
      {resultado && (
        <ul className="divide-y rounded border text-sm">
          {resultado.contratos.length === 0 && <li className="px-3 py-2 text-suave">No hay contratos de abono activos.</li>}
          {resultado.contratos.map((c, i) => (
            <li key={i} className="flex flex-wrap justify-between gap-2 px-3 py-2">
              <span>{c.contrato}</span>
              <span className={TONO_ABONO[c.resultado]}>{c.detalle}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// Certificación de avance por contrato. DH1 certifica y controla; no factura ni cobra.
export default function Certificacion() {
  const router = useRouter();
  const { esGerencia, puedeValidar } = useSesion();
  const carga = useCarga(listarContratos, []);
  const [creando, setCreando] = useState(false);

  if (creando) {
    return <FormContrato onCancelar={() => setCreando(false)} onCreado={(id) => router.push(`/gestion/certificacion/${id}`)} />;
  }

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1>Certificación</h1>
        {esGerencia && (
          <Boton variante="primario" icono={Plus} onClick={() => setCreando(true)}>
            Nuevo contrato
          </Boton>
        )}
      </header>

      {carga.cargando && !carga.datos ? (
        <Esqueleto filas={5} />
      ) : carga.error || !carga.datos ? (
        <ErrorVista mensaje={carga.error ?? 'No se pudieron cargar los contratos.'} onReintentar={carga.recargar} />
      ) : carga.datos.length === 0 ? (
        <Vacio
          icono={FileSpreadsheet}
          titulo="Todavía no hay contratos"
          texto="Cargá un contrato con sus ítems (de una ADA o de una orden de compra). Desde el contrato se emiten los certificados de cada período."
        />
      ) : (
        <Tabla columnas={COLUMNAS} filas={carga.datos} clave={(k) => k.id} />
      )}

      {puedeValidar && (carga.datos ?? []).some((k) => k.tipo === 'abono_mensual') && <AbonosDelMes onListo={() => void carga.recargar()} />}
    </>
  );
}
