'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, FilePlus2, FileText, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { Boton, BotonEnlace } from '@/components/Boton';
import { Campo } from '@/components/Campos';
import { EstadoCertificadoBadge } from '@/components/EstadoBadge';
import { ErrorVista, Esqueleto } from '@/components/Estados';
import { fmtFecha } from '@/components/OTCard';
import { EditarContrato } from '@/components/gestion/EditarContrato';
import { Tabla, type Columna } from '@/components/gestion/Tabla';
import { crearCertificado, fmtCantidad, fmtPesos, obtenerContrato } from '@/lib/certificacion';
import { limpiarError } from '@/lib/errores';
import { abrirDocumento } from '@/lib/obras';
import { useCarga } from '@/lib/useCarga';
import { useSesion } from '@/lib/sesion';
import type { Certificado, ItemContrato } from '@/lib/types';

const ITEMS: Columna<ItemContrato>[] = [
  { titulo: 'N°', celda: (i) => i.numero },
  { titulo: 'Descripción', celda: (i) => i.descripcion },
  { titulo: 'Unidad', celda: (i) => i.um, secundaria: true },
  { titulo: 'Cantidad', celda: (i) => fmtCantidad(i.cantidad), numerica: true },
  { titulo: 'Precio unitario', celda: (i) => fmtPesos(i.importe_unitario), numerica: true, secundaria: true },
  { titulo: 'Total', celda: (i) => fmtPesos(i.importe_total), numerica: true },
];

function periodoActual(): string {
  const texto = new Date().toLocaleDateString('es-AR', { month: 'long', year: 'numeric' }).replace(' de ', ' ');
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function Resumen({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <div className="tarjeta">
      <p className="text-sm text-suave">{titulo}</p>
      <p className="text-lg font-semibold">{valor}</p>
    </div>
  );
}

// Un contrato: sus ítems (la base de toda la certificación) y sus certificados.
export default function PaginaContrato() {
  const { contratoId } = useParams<{ contratoId: string }>();
  const router = useRouter();
  const { puedeValidar, esGerencia } = useSesion();
  const [editando, setEditando] = useState(false);
  const carga = useCarga(() => obtenerContrato(contratoId), [contratoId]);
  const [periodo, setPeriodo] = useState(periodoActual);
  const [creando, setCreando] = useState(false);

  if (carga.cargando && !carga.datos) return <Esqueleto filas={4} />;
  if (carga.error || !carga.datos) {
    return <ErrorVista mensaje={carga.error ?? 'El contrato no existe o no es de tu sector.'} onReintentar={carga.recargar} />;
  }
  const { contrato: k, items, certificados } = carga.datos;
  const href = (c: Certificado) => `/gestion/certificacion/${k.id}/${c.id}`;

  const columnasCert: Columna<Certificado>[] = [
    {
      titulo: 'Certificado',
      celda: (c) => (
        <Link href={href(c)} className="block min-h-control font-medium text-primario hover:underline">
          {c.numero ? `N° ${c.numero}` : 'Borrador'}
          <span className="block text-xs font-normal text-suave">{c.periodo}{c.historico ? ' · traído de la versión anterior' : ''}</span>
        </Link>
      ),
    },
    { titulo: 'Estado', celda: (c) => <EstadoCertificadoBadge estado={c.estado} /> },
    { titulo: 'Fecha', celda: (c) => fmtFecha(c.fecha_certificado) ?? '—', secundaria: true },
    { titulo: 'Certificado en el período', celda: (c) => fmtPesos(c.subtotal_presente), numerica: true },
    { titulo: 'Acumulado', celda: (c) => fmtPesos(c.acum_presente_importe), numerica: true, secundaria: true },
  ];

  async function nuevo(e: FormEvent) {
    e.preventDefault();
    setCreando(true);
    try {
      const id = await crearCertificado(k.id, periodo);
      router.push(`/gestion/certificacion/${k.id}/${id}`);
    } catch (err) {
      toast.error(limpiarError(err));
      setCreando(false);
    }
  }

  return (
    <>
      <BotonEnlace href="/gestion/certificacion" variante="fantasma" icono={ArrowLeft}>
        Contratos
      </BotonEnlace>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
        <h1>{k.contratista}</h1>
        <p className="text-suave">
          {[k.obra_servicio, k.tipo === 'obra' ? 'Obra' : 'Abono mensual', k.ada_numero && `ADA ${k.ada_numero}`, k.oc_numero && `OC ${k.oc_numero}`].filter(Boolean).join(' · ')}
        </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {k.ada_pdf_url && (
            <Boton icono={FileText} onClick={() => abrirDocumento(k.ada_pdf_url!).catch((e) => toast.error(limpiarError(e)))}>
              Ver PDF del ADA
            </Boton>
          )}
          {esGerencia && !editando && <Boton icono={Pencil} onClick={() => setEditando(true)}>Editar contrato</Boton>}
        </div>
      </header>

      {editando && <EditarContrato contrato={k} items={items} onCambio={carga.recargar} onCerrar={() => setEditando(false)} />}

      <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Resumen titulo="Contratado" valor={fmtPesos(k.monto_contratado)} />
        <Resumen titulo="Certificado" valor={fmtPesos(k.certificado_importe)} />
        <Resumen titulo="Saldo por certificar" valor={fmtPesos(k.saldo_importe)} />
        <Resumen titulo="Avance" valor={`${Number(k.porcentaje_certificado).toLocaleString('es-AR')} %`} />
      </section>

      <section className="space-y-3">
        <h2>Certificados</h2>
        {puedeValidar && k.estado === 'activo' && !k.borrador_id && (
          <form onSubmit={nuevo} className="tarjeta flex flex-wrap items-end gap-3">
            <div className="min-w-[14rem] flex-1">
              <Campo etiqueta="Período a certificar" required value={periodo} onChange={(e) => setPeriodo(e.target.value)} />
            </div>
            <Boton type="submit" variante="primario" icono={FilePlus2} cargando={creando}>
              Nuevo certificado
            </Boton>
          </form>
        )}
        {k.borrador_id && (
          <div className="tarjeta flex flex-wrap items-center justify-between gap-3 border-info/40">
            <p>Hay un certificado en borrador. Hay que emitirlo o borrarlo antes de crear otro.</p>
            <BotonEnlace href={`/gestion/certificacion/${k.id}/${k.borrador_id}`} variante="primario">
              Seguir con el borrador
            </BotonEnlace>
          </div>
        )}
        {certificados.length === 0 ? (
          <p className="tarjeta text-suave">Este contrato todavía no tiene certificados.</p>
        ) : (
          <Tabla columnas={columnasCert} filas={certificados} clave={(c) => c.id} />
        )}
      </section>

      <section className="space-y-3">
        <h2>Ítems del contrato</h2>
        <Tabla columnas={ITEMS} filas={items} clave={(i) => i.id} />
      </section>
    </>
  );
}
