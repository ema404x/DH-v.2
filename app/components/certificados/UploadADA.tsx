'use client';

import { useState, type DragEvent } from 'react';
import { FileText, Loader2, Sparkles, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { corregirItemsPDF, leerContratoPDF, type ContratoLeido } from '@/lib/certificacion';
import { borrarArchivo, subirDocumento } from '@/lib/obras';
import { limpiarError } from '@/lib/errores';
import { useSesion } from '@/lib/sesion';

type Tipo = 'abono_mensual' | 'obra' | 'certificado_avance';
const TIPOS: { value: Tipo; label: string; desc: string; color: string }[] = [
  { value: 'abono_mensual', label: 'Abono Mensual', desc: 'Contrato de servicio recurrente mensual', color: 'border-info bg-info/10 text-info' },
  { value: 'obra', label: 'Obra / Presupuesto', desc: 'Contrato o presupuesto de obra civil', color: 'border-exito bg-exito/10 text-exito' },
  { value: 'certificado_avance', label: 'Informe / Certificado', desc: 'Informe de avance o certificado de medición', color: 'border-alerta bg-alerta/10 text-alerta' },
];
const TIPO_LABELS: Record<Tipo, string> = { abono_mensual: 'Abono Mensual', obra: 'Obra / Presupuesto', certificado_avance: 'Informe / Certificado' };

export interface Extraido {
  datos: ContratoLeido;
  path: string;
  totalDocumento: number | null;
}

// "Subí el ADA / Orden de Compra" de la v1: el PDF se sube al bucket del sector, la IA lo lee y, si la suma de los
// ítems no da el total del documento, pide la corrección antes de abrir el editor.
export function UploadADA({ onExtraido }: { onExtraido: (e: Extraido) => void }) {
  const { sectorEfectivo } = useSesion();
  const [arrastrando, setArrastrando] = useState(false);
  const [paso, setPaso] = useState<'' | 'uploading' | 'reading' | 'correcting' | 'done'>('');
  const [tipo, setTipo] = useState<Tipo | null>(null);
  const cargando = paso !== '' && paso !== 'done';

  async function procesar(archivo: File | undefined) {
    if (!archivo) return;
    if (archivo.type !== 'application/pdf' && !archivo.name.toLowerCase().endsWith('.pdf')) {
      toast.error('Solo se aceptan archivos PDF');
      return;
    }
    if (!sectorEfectivo) {
      toast.error('Elegí un sector (no "ver todos") para cargar certificados.');
      return;
    }
    let path: string | null = null;
    try {
      setPaso('uploading');
      path = (await subirDocumento(sectorEfectivo.id, 'contratos', archivo)).path;
      setPaso('reading');
      const r = await leerContratoPDF(path, tipo ?? 'auto');
      const datos = r.datos;
      let total = r.validacion.total_documento;
      if (r.validacion.coincide === false && total) {
        setPaso('correcting');
        try {
          const c = await corregirItemsPDF(path, total, r.validacion.total_items);
          if (c.items.length) datos.items = c.items;
          total = c.validacion.total_documento ?? total;
        } catch {
          // Si la corrección falla, se sigue con lo leído: el editor avisa la diferencia.
        }
      }
      if (r.aviso) toast.warning(r.aviso);
      setPaso('done');
      onExtraido({ datos, path, totalDocumento: total });
    } catch (err) {
      if (path) await borrarArchivo(path).catch(() => undefined);
      toast.error('Error al procesar el PDF: ' + limpiarError(err));
      setPaso('');
    }
  }

  const soltar = (e: DragEvent) => {
    e.preventDefault();
    setArrastrando(false);
    if (!cargando) procesar(e.dataTransfer.files[0]);
  };

  const pasoTexto: Record<string, string> = {
    uploading: 'Subiendo PDF...',
    reading: tipo ? `Extrayendo datos (${TIPO_LABELS[tipo]})...` : 'Analizando y extrayendo datos...',
    correcting: 'Corrigiendo discrepancias en los ítems...',
    done: '¡Datos extraídos!',
  };
  const opcion = (activo: boolean, color: string) =>
    `flex min-h-control w-full items-center gap-3 rounded-lg border-2 px-4 py-3 text-left transition-colors ${activo ? color : 'border-borde bg-superficie text-suave hover:bg-elevado'}`;

  return (
    <div className="mx-auto mt-8 max-w-xl space-y-6">
      <div className="text-center">
        <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-primario/10">
          <Sparkles className="h-7 w-7 text-primario" aria-hidden />
        </div>
        <h2 className="text-xl font-bold">Subí el ADA / Orden de Compra</h2>
        <p className="mt-1 text-sm text-suave">La IA extrae todos los datos automáticamente</p>
      </div>

      <div>
        <p className="mb-3 text-center text-sm font-semibold">¿Qué tipo de documento es?</p>
        <div className="grid grid-cols-1 gap-2">
          <button type="button" onClick={() => setTipo(null)} className={opcion(tipo === null, 'border-primario bg-primario/5 text-primario')} disabled={cargando}>
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-current">{tipo === null && <span className="h-2.5 w-2.5 rounded-full bg-primario" />}</span>
            <span><span className="text-sm font-medium">Auto-detectar</span><span className="block text-xs opacity-70">La IA analiza el documento y decide</span></span>
          </button>
          {TIPOS.map((t) => (
            <button key={t.value} type="button" onClick={() => setTipo(t.value)} className={opcion(tipo === t.value, t.color)} disabled={cargando}>
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-current">{tipo === t.value && <span className="h-2.5 w-2.5 rounded-full bg-current" />}</span>
              <span><span className="text-sm font-medium">{t.label}</span><span className="block text-xs opacity-70">{t.desc}</span></span>
            </button>
          ))}
        </div>
      </div>

      {cargando ? (
        <div className="rounded-2xl border-2 border-dashed border-primario/30 bg-primario/5 p-12 text-center">
          <Loader2 className="mx-auto mb-4 h-10 w-10 animate-spin text-primario" aria-hidden />
          <p className="font-medium text-primario">{pasoTexto[paso] ?? pasoTexto.reading}</p>
          {tipo && <span className="mt-2 inline-block rounded-full bg-primario/10 px-3 py-1 text-xs font-medium text-primario">{TIPO_LABELS[tipo]}</span>}
          <p className="mt-3 text-xs text-suave">Esto puede tomar hasta un minuto...</p>
        </div>
      ) : (
        <label onDragOver={(e) => { e.preventDefault(); setArrastrando(true); }} onDragLeave={() => setArrastrando(false)} onDrop={soltar}
          className={`block cursor-pointer rounded-2xl border-2 border-dashed p-10 text-center transition-colors ${arrastrando ? 'border-primario bg-primario/10' : 'border-borde hover:border-primario/50 hover:bg-elevado'}`}>
          <input type="file" accept="application/pdf,.pdf" className="sr-only" onChange={(e) => { procesar(e.target.files?.[0]); e.target.value = ''; }} />
          <FileText className="mx-auto mb-3 h-10 w-10 text-suave" aria-hidden />
          <p className="font-semibold">Arrastrá el PDF aquí o hacé clic para seleccionar</p>
          <p className="mt-1 text-xs text-suave">Solo archivos PDF · ADA, Orden de Compra, Informe</p>
          <span className="mt-4 inline-flex min-h-control items-center gap-2 rounded border bg-elevado px-4 text-sm font-semibold">
            <Upload className="h-4 w-4" aria-hidden /> Seleccionar PDF
          </span>
        </label>
      )}
    </div>
  );
}
