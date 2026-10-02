'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AlertTriangle, ArrowLeft, CheckCheck, Printer, Save, Send, Trash2, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { Boton, BotonEnlace } from '@/components/Boton';
import { Area, Campo, Casilla, oNull } from '@/components/Campos';
import { FirmaCanvas } from '@/components/FirmaCanvas';
import { EstadoCertificadoBadge } from '@/components/EstadoBadge';
import { ErrorVista, Esqueleto } from '@/components/Estados';
import { fmtFecha } from '@/components/OTCard';
import {
  aprobarCertificado, guardarMiFirma, miFirma, borrarBorrador, emitirCertificado, fmtCantidad, fmtPesos, guardarCabecera, guardarMedicion,
  obtenerCertificado, rechazarCertificado,
} from '@/lib/certificacion';
import { limpiarError } from '@/lib/errores';
import { useCarga } from '@/lib/useCarga';
import { useSesion } from '@/lib/sesion';
import type { LineaCertificado } from '@/lib/types';

// Celda de medición: lo único que se escribe en un certificado. Se guarda al salir del campo
// y la fila vuelve recalculada desde la base.
function Medicion({ linea, onGuardada }: { linea: LineaCertificado; onGuardada: () => Promise<void> }) {
  const [texto, setTexto] = useState(String(Number(linea.med_presente_unidad)));
  const [guardando, setGuardando] = useState(false);

  useEffect(() => setTexto(String(Number(linea.med_presente_unidad))), [linea.med_presente_unidad]);

  async function guardar() {
    const valor = Number(texto.replace(',', '.'));
    if (texto.trim() === '' || Number.isNaN(valor) || valor < 0) {
      toast.error('La medición tiene que ser un número igual o mayor a cero.');
      setTexto(String(Number(linea.med_presente_unidad)));
      return;
    }
    if (valor === Number(linea.med_presente_unidad)) return;
    setGuardando(true);
    try {
      await guardarMedicion(linea.id, valor);
      await onGuardada();
    } catch (e) {
      toast.error(limpiarError(e));
      setTexto(String(Number(linea.med_presente_unidad)));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <input
      className="control num w-28"
      inputMode="decimal"
      aria-label={`Medición del período, ítem ${linea.numero}`}
      value={texto}
      disabled={guardando}
      onChange={(e) => setTexto(e.target.value)}
      onBlur={guardar}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

function Total({ titulo, valor, fuerte }: { titulo: string; valor: string; fuerte?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 ${fuerte ? 'border-t pt-2 text-lg font-semibold' : ''}`}>
      <dt className={fuerte ? '' : 'text-suave'}>{titulo}</dt>
      <dd className="num">{valor}</dd>
    </div>
  );
}

// Hoja del certificado. En borrador se carga la medición; los totales, el acumulado anterior,
// el número y los bloqueos los resuelve la base. Emitido o aprobado, es de solo lectura.
export default function PaginaCertificado() {
  const { contratoId, certId } = useParams<{ contratoId: string; certId: string }>();
  const router = useRouter();
  const { perfil, esGerencia, puedeValidar } = useSesion();
  const carga = useCarga(() => obtenerCertificado(certId), [certId]);
  const c = carga.datos?.certificado ?? null;

  const [periodo, setPeriodo] = useState('');
  const [fecha, setFecha] = useState('');
  const [recepcion, setRecepcion] = useState('');
  const [notas, setNotas] = useState('');
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [rechazando, setRechazando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [firmando, setFirmando] = useState(false);
  const [firma, setFirma] = useState<string | null>(null);
  const [firmaGuardada, setFirmaGuardada] = useState<string | null>(null);
  const [recordar, setRecordar] = useState(true);

  // Solo al abrir el certificado o al cambiar de estado: guardar una medición recarga la hoja
  // y no tiene que pisar lo que se esté escribiendo en la cabecera.
  useEffect(() => {
    if (!c) return;
    setPeriodo(c.periodo);
    setFecha(c.fecha_certificado);
    setRecepcion(c.numero_recepcion ?? '');
    setNotas(c.notas ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c?.id, c?.estado]);

  if (carga.cargando && !carga.datos) return <Esqueleto filas={5} />;
  if (carga.error || !carga.datos || !c) {
    return <ErrorVista mensaje={carga.error ?? 'El certificado no existe o no es de tu sector.'} onReintentar={carga.recargar} />;
  }
  const lineas = carga.datos.lineas;
  const volver = `/gestion/certificacion/${contratoId}`;
  const borrador = c.estado === 'borrador';
  const editable = borrador && puedeValidar;
  const excedidas = lineas.filter((l) => Number(l.med_acum_presente_unidad) > Number(l.cantidad));
  const loEmitiYo = c.emitido_por === perfil?.id;

  async function hacer(clave: string, accion: () => Promise<unknown>, exito: string, despues?: () => void) {
    setOcupado(clave);
    try {
      await accion();
      toast.success(exito);
      setRechazando(false);
      setMotivo('');
      if (despues) despues();
      else await carga.recargar();
    } catch (e) {
      toast.error(limpiarError(e));
    } finally {
      setOcupado(null);
    }
  }

  const cabecera = () => guardarCabecera(c.id, { periodo: periodo.trim(), fecha_certificado: fecha, numero_recepcion: oNull(recepcion), notas: oNull(notas) });

  return (
    <>
      <div className="no-imprimir flex flex-wrap items-center justify-between gap-3">
        <BotonEnlace href={volver} variante="fantasma" icono={ArrowLeft}>
          {c.contratista}
        </BotonEnlace>
        <Boton variante="fantasma" icono={Printer} onClick={() => window.print()}>
          Imprimir
        </Boton>
      </div>

      <article className="hoja space-y-5">
        <header className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <EstadoCertificadoBadge estado={c.estado} />
            {c.historico && <span className="text-sm text-suave">Traído de la versión anterior, con sus valores originales</span>}
          </div>
          <h1>{c.numero ? `Certificado N° ${c.numero}` : 'Certificado en borrador'}</h1>
          <p className="text-suave">
            {[c.contratista, c.obra_servicio, c.ada_numero && `ADA ${c.ada_numero}`, c.oc_numero && `OC ${c.oc_numero}`].filter(Boolean).join(' · ')}
          </p>
        </header>

        {c.rechazo_motivo && borrador && (
          <div className="rounded border border-alerta/40 bg-alerta/10 p-3 text-alerta" role="status">
            <p className="font-semibold">Fue rechazado y volvió a borrador</p>
            <p>{c.rechazo_motivo}</p>
          </div>
        )}

        {editable ? (
          <section className="tarjeta no-imprimir space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <Campo etiqueta="Período" required value={periodo} onChange={(e) => setPeriodo(e.target.value)} />
              <Campo etiqueta="Fecha del certificado" type="date" required value={fecha} onChange={(e) => setFecha(e.target.value)} />
              <Campo etiqueta="N° de recepción" value={recepcion} onChange={(e) => setRecepcion(e.target.value)} />
            </div>
            <Area etiqueta="Notas" value={notas} onChange={(e) => setNotas(e.target.value)} />
            <Boton icono={Save} cargando={ocupado === 'cabecera'} disabled={!!ocupado} onClick={() => hacer('cabecera', cabecera, 'Datos guardados.')}>
              Guardar datos
            </Boton>
          </section>
        ) : (
          <dl className="tarjeta grid grid-cols-2 gap-4 md:grid-cols-4">
            <div><dt className="text-xs text-suave">Período</dt><dd>{c.periodo}</dd></div>
            <div><dt className="text-xs text-suave">Fecha</dt><dd>{fmtFecha(c.fecha_certificado)}</dd></div>
            <div><dt className="text-xs text-suave">N° de recepción</dt><dd>{c.numero_recepcion ?? '—'}</dd></div>
            <div><dt className="text-xs text-suave">Emitió</dt><dd>{c.emitido_nombre ?? '—'}</dd></div>
            {c.aprobado_nombre && <div><dt className="text-xs text-suave">Aprobó</dt><dd>{c.aprobado_nombre}</dd></div>}
            {c.notas && <div className="col-span-full"><dt className="text-xs text-suave">Notas</dt><dd className="whitespace-pre-wrap">{c.notas}</dd></div>}
          </dl>
        )}

        {borrador && excedidas.length > 0 && (
          <div className="no-imprimir flex gap-3 rounded border border-peligro/50 bg-peligro/10 p-3 text-peligro" role="alert">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
            <p>
              {excedidas.length === 1 ? `El ítem ${excedidas[0].numero} supera` : `Los ítems ${excedidas.map((l) => l.numero).join(', ')} superan`} la cantidad del contrato.
              Así no se puede emitir: corregí la medición.
            </p>
          </div>
        )}

        <div className="overflow-x-auto rounded-lg border bg-superficie">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b text-left text-suave">
                <th scope="col" className="px-3 py-3 font-medium">N°</th>
                <th scope="col" className="px-3 py-3 font-medium">Descripción</th>
                <th scope="col" className="num px-3 py-3 font-medium">Contrato</th>
                <th scope="col" className="num px-3 py-3 font-medium">Precio unitario</th>
                <th scope="col" className="num px-3 py-3 font-medium">Anterior</th>
                <th scope="col" className="num px-3 py-3 font-medium">Este período</th>
                <th scope="col" className="num px-3 py-3 font-medium">Importe del período</th>
                <th scope="col" className="num px-3 py-3 font-medium">Acumulado</th>
                <th scope="col" className="num px-3 py-3 font-medium">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {lineas.map((l) => {
                const excedida = Number(l.med_acum_presente_unidad) > Number(l.cantidad);
                return (
                  <tr key={l.id} className={`border-b last:border-b-0 ${excedida ? 'bg-peligro/10' : ''}`}>
                    <td className="px-3 py-3">{l.numero}</td>
                    <td className="px-3 py-3">
                      {l.descripcion}
                      {excedida && <span className="block text-xs font-semibold text-peligro">Supera la cantidad del contrato</span>}
                    </td>
                    <td className="num px-3 py-3">{fmtCantidad(l.cantidad)} {l.um}</td>
                    <td className="num px-3 py-3">{fmtPesos(l.importe_unitario)}</td>
                    <td className="num px-3 py-3">{fmtCantidad(l.med_acum_anterior_unidad)}</td>
                    <td className="num px-3 py-2">
                      {editable ? <Medicion linea={l} onGuardada={carga.recargar} /> : fmtCantidad(l.med_presente_unidad)}
                    </td>
                    <td className="num px-3 py-3">{fmtPesos(l.med_presente_importe)}</td>
                    <td className="num px-3 py-3">{fmtCantidad(l.med_acum_presente_unidad)}</td>
                    <td className="num px-3 py-3">{fmtCantidad(l.saldo_pendiente_unidad)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <dl className="tarjeta ml-auto max-w-md space-y-2">
          <Total titulo="Certificado en el período" valor={fmtPesos(c.subtotal_presente)} />
          {Number(c.anticipo_monto) > 0 && <Total titulo={`Descuento de anticipo (${Number(c.anticipo_pct)} %)`} valor={`− ${fmtPesos(c.anticipo_monto)}`} />}
          {c.fondo_reparo_aplicar && <Total titulo={`${c.fondo_reparo_label} (${Number(c.fondo_reparo_pct)} %)`} valor={`− ${fmtPesos(c.fondo_reparo_monto)}`} />}
          <Total titulo="Total neto del certificado" valor={fmtPesos(c.total_neto)} fuerte />
          <Total titulo="Acumulado anterior" valor={fmtPesos(c.acum_anterior_importe)} />
          <Total titulo="Acumulado con este certificado" valor={fmtPesos(c.acum_presente_importe)} />
          <Total titulo="Monto contratado" valor={fmtPesos(c.monto_contratado)} />
          <Total titulo="Avance del contrato" valor={`${Number(c.porcentaje_avance).toLocaleString('es-AR')} %`} />
        </dl>
        {c.estado === 'aprobado' && c.firma_url && (
          <div className="flex justify-end">
            <figure className="w-64 text-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={c.firma_url} alt={`Firma de ${c.aprobado_nombre ?? 'quien aprobó'}`} className="mx-auto max-h-24 rounded bg-white p-1" />
              <figcaption className="border-t pt-1 text-sm">{c.aprobado_nombre}{c.aprobado_at ? ` · ${fmtFecha(c.aprobado_at)}` : ''}<span className="block text-xs text-suave">Aprobó</span></figcaption>
            </figure>
          </div>
        )}
      </article>

      {firmando && c.estado === 'emitido' && (
        <section className="tarjeta no-imprimir space-y-3">
          <h2>Firma de aprobación</h2>
          <p className="text-sm text-suave">La firma sale impresa en el certificado. Podés aprobar sin firmar.</p>
          <FirmaCanvas inicial={firmaGuardada} onCambio={setFirma} />
          <Casilla etiqueta="Guardar como mi firma para la próxima" checked={recordar} onChange={(e) => setRecordar(e.target.checked)} />
          <div className="flex flex-wrap gap-3">
            <Boton variante="primario" icono={CheckCheck} cargando={ocupado === 'aprobar'} disabled={!!ocupado || !firma}
              onClick={() => hacer('aprobar', async () => {
                await aprobarCertificado(c.id, firma);
                if (recordar && perfil && firma && firma !== firmaGuardada) await guardarMiFirma(perfil.id, firma).catch(() => undefined);
                setFirmando(false);
              }, 'Certificado aprobado y firmado.')}>
              Aprobar con mi firma
            </Boton>
            <Boton disabled={!!ocupado} onClick={() => hacer('aprobar', async () => { await aprobarCertificado(c.id); setFirmando(false); }, 'Certificado aprobado.')}>Aprobar sin firma</Boton>
            <Boton variante="fantasma" onClick={() => setFirmando(false)}>Cancelar</Boton>
          </div>
        </section>
      )}

      {rechazando && (
        <section className="tarjeta no-imprimir space-y-3 border-peligro/40">
          <Area etiqueta="Motivo del rechazo" ayuda="El certificado vuelve a borrador y se libera su número." value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          <div className="flex flex-wrap gap-3">
            <Boton variante="peligro" icono={Undo2} cargando={ocupado === 'rechazar'} disabled={!!ocupado || !motivo.trim()}
              onClick={() => hacer('rechazar', () => rechazarCertificado(c.id, motivo.trim()), 'Certificado rechazado. Volvió a borrador.')}>
              Rechazar certificado
            </Boton>
            <Boton variante="fantasma" onClick={() => setRechazando(false)}>No rechazar</Boton>
          </div>
        </section>
      )}

      <div className="no-imprimir flex flex-wrap items-center gap-3">
        {editable && (
          <>
            <Boton variante="primario" icono={Send} cargando={ocupado === 'emitir'} disabled={!!ocupado}
              onClick={() =>
                window.confirm('¿Emitir el certificado? Una vez emitido ya no se puede modificar.') &&
                hacer('emitir', async () => { await cabecera(); await emitirCertificado(c.id); }, 'Certificado emitido.')
              }>
              Emitir certificado
            </Boton>
            <Boton variante="fantasma" icono={Trash2} disabled={!!ocupado}
              onClick={() => window.confirm('¿Borrar este borrador?') && hacer('borrar', () => borrarBorrador(c.id), 'Borrador eliminado.', () => router.push(volver))}>
              Borrar borrador
            </Boton>
          </>
        )}
        {c.estado === 'emitido' && esGerencia && !rechazando && (
          <>
            {loEmitiYo ? (
              <p className="text-suave">Lo emitiste vos: lo tiene que aprobar otra persona de gerencia.</p>
            ) : (
              <Boton variante="primario" icono={CheckCheck} disabled={!!ocupado || firmando}
                onClick={async () => { const g = perfil ? await miFirma(perfil.id).catch(() => null) : null; setFirmaGuardada(g); setFirma(g); setFirmando(true); }}>
                Aprobar certificado
              </Boton>
            )}
            <Boton icono={Undo2} disabled={!!ocupado} onClick={() => setRechazando(true)}>
              Rechazar
            </Boton>
          </>
        )}
        {c.estado === 'emitido' && !esGerencia && <p className="text-suave">Emitido. Falta que lo apruebe gerencia.</p>}
        {c.estado === 'aprobado' && (
          <p className="text-suave">Aprobado{c.aprobado_nombre ? ` por ${c.aprobado_nombre}` : ''}{c.aprobado_at ? ` el ${fmtFecha(c.aprobado_at)}` : ''}.</p>
        )}
      </div>
    </>
  );
}
