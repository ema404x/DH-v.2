'use client';

import { useState } from 'react';
import { ArrowLeft, CheckCircle2, Plus, XCircle, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { ErrorVista } from '@/components/Estados';
import { AbonoManualForm } from '@/components/certificados/AbonoManualForm';
import { AbonosMaestros } from '@/components/certificados/AbonosMaestros';
import { CertificadoEditor } from '@/components/certificados/CertificadoEditor';
import { CertificadoPreview } from '@/components/certificados/CertificadoPreview';
import { CertificadosAutomatizados } from '@/components/certificados/CertificadosAutomatizados';
import { CertificadosLista } from '@/components/certificados/CertificadosLista';
import { FirmaJefeSitioModal } from '@/components/certificados/FirmaJefeSitioModal';
import { GeneracionMasiva } from '@/components/certificados/GeneracionMasiva';
import { UploadADA, type Extraido } from '@/components/certificados/UploadADA';
import { aGuardar, formDesdeCertificado, formDesdePDF, type FormCert } from '@/components/certificados/modelo';
import {
  acumuladoPorItem, aprobarCertificado, borrarCertificado, comunaDe, COMUNAS, contratoPorAda, emitirCertificado, guardarCertificado,
  itemsDelContrato, listarCertificados, obtenerCertificado, rechazarCertificado, type CertificadoFila, type LineaCert,
} from '@/lib/certificados';
import { borrarArchivo } from '@/lib/obras';
import { limpiarError } from '@/lib/errores';
import { useCarga } from '@/lib/useCarga';
import { useSesion } from '@/lib/sesion';

type Vista = 'list' | 'upload' | 'edit' | 'preview' | 'manual';
type Tab = 'abono_mensual' | 'obra' | 'informe' | 'automaticos' | 'abonos_maestro';
const TABS: { id: Tab; texto: string; corto: string }[] = [
  { id: 'abono_mensual', texto: '🟣 Abono Mensual', corto: '🟣 Mensual' },
  { id: 'obra', texto: '🟠 Obra', corto: '🟠 Obra' },
  { id: 'informe', texto: '🔵 Informe', corto: '🔵 Informe' },
  { id: 'automaticos', texto: '⚡ Automáticos', corto: '⚡ Auto' },
  { id: 'abonos_maestro', texto: '📋 Abonos Maestros', corto: '📋 Maestros' },
];
const mesDe = (iso: string) => iso.slice(0, 7);

// Certificados: la pantalla y el flujo de la v1 (Base44). Subir el ADA → revisar el certificado → vista previa,
// borrador o emitir (en obra, con la firma del jefe de sitio) → la solicitud de aprobación sale sola.
// Las reglas son las de la v2: numera la base, lo emitido no se toca, no se certifica de más.
export default function Certificados() {
  const { esGerencia, puedeValidar } = useSesion();
  const carga = useCarga(listarCertificados, []);
  const [vista, setVista] = useState<Vista>('list');
  const [tab, setTab] = useState<Tab>('abono_mensual');
  const [comuna, setComuna] = useState('Todas');
  const [mes, setMes] = useState('Todos');
  const [masiva, setMasiva] = useState(false);
  const [form, setForm] = useState<FormCert | null>(null);
  const [lineas, setLineas] = useState<LineaCert[] | undefined>(undefined);
  const [desdeLista, setDesdeLista] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [emitiendo, setEmitiendo] = useState(false);
  const [pendienteFirma, setPendienteFirma] = useState<FormCert | null>(null);
  const [firmaGerente, setFirmaGerente] = useState(false);

  const certificados = carga.datos ?? [];

  function volverALista() {
    setVista('list');
    setForm(null);
    setLineas(undefined);
    setDesdeLista(false);
  }

  async function alExtraer(e: Extraido) {
    try {
      const existente = e.datos.ada_numero ? await contratoPorAda(e.datos.ada_numero) : null;
      let contrato;
      if (existente) {
        const [items, acumulado] = await Promise.all([itemsDelContrato(existente.id), acumuladoPorItem(existente.id)]);
        contrato = { ...existente, items, acumulado };
        toast.info('Ese N° de ADA ya tiene contrato: se usan sus ítems y lo ya certificado.');
      }
      setForm(formDesdePDF(e.datos, e.path, e.totalDocumento, contrato));
      setVista('edit');
    } catch (err) {
      toast.error(limpiarError(err));
    }
  }

  async function guardar(f: FormCert): Promise<string> {
    return guardarCertificado(aGuardar(f, esGerencia));
  }

  async function borrador(f: FormCert) {
    setGuardando(true);
    try {
      const id = await guardar(f);
      const { cert, lineas: l } = await obtenerCertificado(id);
      setForm({ ...formDesdeCertificado(cert, l), total_documento: f.total_documento });
      toast.success('Borrador guardado');
      carga.recargar();
    } catch (err) {
      toast.error('Error al guardar borrador: ' + limpiarError(err));
    } finally {
      setGuardando(false);
    }
  }

  // Obra: primero la firma del jefe de sitio (como la v1).
  function pedirEmision(f: FormCert) {
    if (f.tipo === 'obra') setPendienteFirma(f);
    else void emitir(f, null);
  }

  async function emitir(f: FormCert, firma: string | null) {
    setPendienteFirma(null);
    setEmitiendo(true);
    try {
      const id = await guardar(f);
      const numero = await emitirCertificado(id, firma, true);
      toast.success(`Certificado N° ${numero} emitido y enviado a aprobación gerencial`);
      volverALista();
      carga.recargar();
    } catch (err) {
      toast.error('Error al emitir el certificado: ' + limpiarError(err));
      carga.recargar();
    } finally {
      setEmitiendo(false);
    }
  }

  async function ver(c: CertificadoFila) {
    try {
      const { cert, lineas: l } = await obtenerCertificado(c.id);
      setForm(formDesdeCertificado(cert, l));
      if (cert.estado === 'borrador') {
        setLineas(undefined);
        setVista('edit');
      } else {
        setLineas(l);
        setDesdeLista(true);
        setVista('preview');
      }
    } catch (err) {
      toast.error(limpiarError(err));
    }
  }

  async function borrar(c: CertificadoFila) {
    if (c.estado !== 'borrador') { toast.error('Un certificado emitido no se borra: se rechaza.'); return; }
    if (!window.confirm('¿Eliminar este certificado en borrador?')) return;
    try {
      await borrarCertificado(c.id);
      toast.success('Certificado eliminado');
      carga.recargar();
    } catch (err) {
      toast.error(limpiarError(err));
    }
  }

  async function cancelarEditor() {
    // El PDF que se subió para leer y nunca se guardó no queda suelto.
    if (form && !form.certificado_id && !form.contrato_id && form.ada_pdf_url) await borrarArchivo(form.ada_pdf_url).catch(() => undefined);
    volverALista();
  }

  async function aprobar(firma: string) {
    if (!form?.certificado_id) return;
    setFirmaGerente(false);
    try {
      await aprobarCertificado(form.certificado_id, firma);
      toast.success('Certificado aprobado');
      volverALista();
      carga.recargar();
    } catch (err) {
      toast.error(limpiarError(err));
    }
  }

  async function rechazar() {
    if (!form?.certificado_id) return;
    const motivo = window.prompt('Motivo del rechazo:');
    if (!motivo?.trim()) return;
    try {
      await rechazarCertificado(form.certificado_id, motivo.trim());
      toast.success('Certificado rechazado: volvió a borrador');
      volverALista();
      carga.recargar();
    } catch (err) {
      toast.error(limpiarError(err));
    }
  }

  const firma = (
    <FirmaJefeSitioModal abierto={!!pendienteFirma} onCerrar={() => setPendienteFirma(null)} onFirmado={(fir) => pendienteFirma && emitir(pendienteFirma, fir)} />
  );

  // ---------------------------------------------------------------- vistas
  if (vista === 'manual') {
    return <AbonoManualForm onGuardar={(f) => emitir(f, null)} onCancelar={() => setVista('list')} guardando={emitiendo} />;
  }
  if (vista === 'upload') {
    return (
      <div>
        <button type="button" onClick={() => setVista('list')} className="mb-6 inline-flex min-h-control items-center gap-2 rounded px-3 text-sm font-semibold text-suave hover:bg-elevado"><ArrowLeft className="h-4 w-4" aria-hidden />Volver</button>
        <UploadADA onExtraido={alExtraer} />
      </div>
    );
  }
  if (vista === 'edit' && form) {
    return (
      <>
        {firma}
        <CertificadoEditor key={form.certificado_id ?? 'nuevo'} inicial={form} onBorrador={borrador} onEmitir={pedirEmision} onCancelar={cancelarEditor}
          onVistaPrevia={(f) => { setForm(f); setLineas(undefined); setDesdeLista(false); setVista('preview'); }} guardando={guardando} emitiendo={emitiendo} />
      </>
    );
  }
  if (vista === 'preview' && form) {
    const puedeResolver = desdeLista && form.estado === 'emitido' && esGerencia;
    return (
      <>
        {firma}
        <FirmaJefeSitioModal abierto={firmaGerente} onCerrar={() => setFirmaGerente(false)} onFirmado={aprobar} titulo="Firma del gerente" cargo="Gerente de Contratos · Aprobación" />
        <CertificadoPreview form={form} lineas={lineas} onVolver={() => (desdeLista ? volverALista() : setVista('edit'))} textoVolver={desdeLista ? 'Volver' : 'Volver al editor'}
          onEmitir={desdeLista ? undefined : pedirEmision} emitiendo={emitiendo}
          acciones={puedeResolver && <>
            <button type="button" onClick={rechazar} className="inline-flex min-h-control items-center gap-2 rounded border border-peligro/60 bg-peligro/10 px-4 text-sm font-semibold text-peligro"><XCircle className="h-4 w-4" aria-hidden />Rechazar</button>
            <button type="button" onClick={() => setFirmaGerente(true)} className="inline-flex min-h-control items-center gap-2 rounded bg-exito px-4 text-sm font-semibold text-sobre-primario"><CheckCircle2 className="h-4 w-4" aria-hidden />Aprobar</button>
          </>} />
      </>
    );
  }

  // ---------------------------------------------------------------- lista
  const meses = Array.from(new Set(certificados.map((c) => mesDe(c.created_at)))).sort().reverse();
  const filtrar = (tipo: string) => certificados
    .filter((c) => c.tipo === tipo)
    .filter((c) => comuna === 'Todas' || comunaDe(c) === comuna)
    .filter((c) => mes === 'Todos' || mesDe(c.created_at) === mes);
  const lista = (tipo: string, vacio: string) => (
    <CertificadosLista certificados={filtrar(tipo)} cargando={carga.cargando && !carga.datos} onNuevo={() => setVista('upload')} onVer={ver} onBorrar={borrar} vacio={vacio} />
  );

  return (
    <div className="space-y-6">
      {firma}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1>Certificados</h1>
          <p className="text-sm text-suave">Gestión de certificados manuales y automáticos</p>
        </div>
        {puedeValidar && (
          <button type="button" onClick={() => setVista('upload')} className="inline-flex min-h-control items-center gap-2 rounded bg-primario px-4 text-sm font-semibold text-sobre-primario"><Plus className="h-4 w-4" aria-hidden />Nuevo Certificado</button>
        )}
      </header>

      <div className="flex flex-wrap items-center gap-4">
        <div className="flex flex-wrap gap-2">
          {['Todas', ...COMUNAS].map((c) => (
            <button key={c} type="button" onClick={() => setComuna(c)} aria-pressed={comuna === c}
              className={`min-h-control rounded-full border px-3 text-xs font-semibold transition-colors ${comuna === c ? 'border-primario bg-primario text-sobre-primario' : 'text-suave hover:border-primario/50'}`}>{c}</button>
          ))}
        </div>
        <select value={mes} onChange={(e) => setMes(e.target.value)} className="control w-auto text-xs font-medium" aria-label="Mes">
          <option value="Todos">Todos los meses</option>
          {meses.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>

      <div role="tablist" className="flex flex-wrap gap-1 rounded-lg bg-elevado/60 p-1">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
            className={`min-h-control rounded px-3 text-xs font-semibold sm:text-sm ${tab === t.id ? 'bg-superficie text-texto shadow-sm' : 'text-suave hover:text-texto'}`}>
            <span className="hidden sm:inline">{t.texto}</span><span className="sm:hidden">{t.corto}</span>
          </button>
        ))}
      </div>

      {carga.error && !carga.datos ? <ErrorVista mensaje={carga.error} onReintentar={carga.recargar} /> : (
        <div>
          {tab === 'abono_mensual' && (
            <div className="space-y-4">
              {puedeValidar && (
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setVista('manual')} className="inline-flex min-h-control items-center gap-2 rounded border bg-elevado px-4 text-sm font-semibold"><Plus className="h-4 w-4" aria-hidden />Cargar Manualmente</button>
                  {esGerencia && <button type="button" onClick={() => setMasiva(true)} className="inline-flex min-h-control items-center gap-2 rounded bg-primario px-4 text-sm font-semibold text-sobre-primario"><Zap className="h-4 w-4" aria-hidden />Generar Masivo</button>}
                </div>
              )}
              {lista('abono_mensual', 'No hay certificados de Abono Mensual')}
              <GeneracionMasiva abierto={masiva} onCerrar={() => setMasiva(false)} onListo={() => carga.recargar()} />
            </div>
          )}
          {tab === 'obra' && lista('obra', 'No hay certificados de Obra')}
          {tab === 'informe' && lista('informe', 'No hay certificados de Informe')}
          {tab === 'automaticos' && <CertificadosAutomatizados certificados={certificados} onCambio={carga.recargar} />}
          {tab === 'abonos_maestro' && (
            <AbonosMaestros onCambio={carga.recargar} onVerCertificados={() => setTab('abono_mensual')} />
          )}
        </div>
      )}
    </div>
  );
}
