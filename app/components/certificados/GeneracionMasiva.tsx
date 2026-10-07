'use client';

import { useRef, useState, type DragEvent } from 'react';
import { AlertCircle, CheckCircle2, FileText, Loader2, UploadCloud, X, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { Dialogo } from './Dialogo';
import { leerContratoPDF } from '@/lib/certificacion';
import { acumuladoPorItem, contratoPorAda, emitirCertificado, guardarCertificado, itemsDelContrato } from '@/lib/certificados';
import { subirDocumento } from '@/lib/obras';
import { limpiarError } from '@/lib/errores';
import { useSesion } from '@/lib/sesion';

type Estado = 'pendiente' | 'subiendo' | 'extrayendo' | 'guardando' | 'ok' | 'error';
interface Archivo { clave: string; file: File; comuna: string; estado: Estado; error?: string; numero?: number }

const ESTADOS: Record<Estado, { label: string; cls: string; girando?: boolean; Icono: typeof FileText }> = {
  pendiente: { label: 'Pendiente', cls: 'text-suave', Icono: FileText },
  subiendo: { label: 'Subiendo...', cls: 'text-info', Icono: Loader2, girando: true },
  extrayendo: { label: 'Extrayendo con IA...', cls: 'text-primario', Icono: Loader2, girando: true },
  guardando: { label: 'Guardando...', cls: 'text-info', Icono: Loader2, girando: true },
  ok: { label: 'Certificado generado', cls: 'text-exito', Icono: CheckCircle2 },
  error: { label: 'Error', cls: 'text-peligro', Icono: AlertCircle },
};
const COLOR_COMUNA: Record<string, string> = {
  '8A': 'border-info/40 bg-info/10 text-info', '8B': 'border-primario/40 bg-primario/10 text-primario', '10A': 'border-exito/40 bg-exito/10 text-exito',
};

// Comuna por el nombre del archivo (como la v1).
function comunaDelNombre(nombre: string): string {
  const n = nombre.toUpperCase();
  if (n.includes('8A') || n.includes('8 A') || n.includes('COMUNA8A')) return '8A';
  if (n.includes('8B') || n.includes('8 B') || n.includes('COMUNA8B')) return '8B';
  if (n.includes('10A') || n.includes('10 A') || n.includes('COMUNA10A')) return '10A';
  return 'Sin asignar';
}

// "Generación Masiva desde PDFs" (GeneracionMasiva de la v1): varios ADA de abono a la vez; cada uno se lee con IA,
// se guarda como certificado de abono mensual completo y se emite. De a dos por vez, para no saturar la IA gratis.
export function GeneracionMasiva({ abierto, onCerrar, onListo }: { abierto: boolean; onCerrar: () => void; onListo: () => void }) {
  const { sectorEfectivo } = useSesion();
  const [archivos, setArchivos] = useState<Archivo[]>([]);
  const [procesando, setProcesando] = useState(false);
  const [arrastrando, setArrastrando] = useState(false);
  const [filtro, setFiltro] = useState<string>('Todas');
  const entrada = useRef<HTMLInputElement>(null);

  const actualizar = (clave: string, cambio: Partial<Archivo>) => setArchivos((a) => a.map((x) => (x.clave === clave ? { ...x, ...cambio } : x)));
  const agregar = (lista: FileList | null) => {
    if (!lista) return;
    const pdfs = Array.from(lista).filter((f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
    setArchivos((a) => [...a, ...pdfs.map((file) => ({ clave: crypto.randomUUID(), file, comuna: comunaDelNombre(file.name), estado: 'pendiente' as Estado }))]);
  };

  async function procesarUno(a: Archivo) {
    try {
      actualizar(a.clave, { estado: 'subiendo', error: undefined });
      const doc = await subirDocumento(sectorEfectivo!.id, 'contratos', a.file);
      actualizar(a.clave, { estado: 'extrayendo' });
      const r = await leerContratoPDF(doc.path, 'auto');
      const d = r.datos;
      actualizar(a.clave, { estado: 'guardando' });
      // Mismo N° de ADA que un contrato existente: se certifica lo pendiente de sus ítems (no se pisan).
      const existente = d.ada_numero ? await contratoPorAda(d.ada_numero) : null;
      if (existente) {
        const [items, acum] = await Promise.all([itemsDelContrato(existente.id), acumuladoPorItem(existente.id)]);
        const idx = await guardarCertificado({
          contrato_id: existente.id,
          items: items.map((it) => ({ id: it.id, descripcion: it.descripcion, um: it.um, cantidad: Number(it.cantidad), importe_unitario: Number(it.importe_unitario),
            presente_importe: Math.max(0, Math.round((Number(it.importe_total) - (acum[it.id] ?? 0)) * 100) / 100) })),
        });
        actualizar(a.clave, { estado: 'ok', numero: await emitirCertificado(idx, null, false) });
        return;
      }
      const id = await guardarCertificado({
        contrato: {
          tipo: 'abono_mensual', contratista: d.contratista, obra_servicio: d.obra_servicio, emprendimiento: d.emprendimiento,
          ada_numero: d.ada_numero, oc_numero: d.oc_numero, fecha_inicio: d.fecha_inicio, fecha_fin: d.fecha_fin, plazo: d.plazo,
          condiciones_pago: d.condiciones_pago, ada_pdf_url: doc.path, comuna: a.comuna === 'Sin asignar' ? null : a.comuna,
        },
        items: d.items.map((it) => ({ descripcion: it.descripcion, um: it.um, cantidad: it.cantidad, importe_unitario: it.importe_unitario, presente_importe: Math.round(it.cantidad * it.importe_unitario * 100) / 100 })),
        cabecera: { fondo_reparo_pct: 5, fondo_reparo_aplicar: false, anticipo_pct: 0 },
      });
      const numero = await emitirCertificado(id, null, false);
      actualizar(a.clave, { estado: 'ok', numero });
    } catch (err) {
      const msg = limpiarError(err) || 'Error desconocido';
      actualizar(a.clave, { estado: 'error', error: msg });
      toast.error(`${a.file.name}: ${msg}`);
    }
  }

  async function generar() {
    if (!sectorEfectivo) {
      toast.error('Elegí un sector (no "ver todos") para cargar certificados.');
      return;
    }
    setProcesando(true);
    const cola = archivos.filter((a) => a.estado === 'pendiente' || a.estado === 'error');
    const trabajador = async () => {
      for (let a = cola.shift(); a; a = cola.shift()) await procesarUno(a);
    };
    await Promise.all([trabajador(), trabajador()]);
    setProcesando(false);
    onListo();
  }

  const cerrar = () => { if (procesando) return; setArchivos([]); setFiltro('Todas'); onCerrar(); };
  const soltar = (e: DragEvent) => { e.preventDefault(); setArrastrando(false); agregar(e.dataTransfer.files); };

  const comunas = Array.from(new Set(archivos.map((a) => a.comuna)));
  const visibles = filtro === 'Todas' ? archivos : archivos.filter((a) => a.comuna === filtro);
  const ok = archivos.filter((a) => a.estado === 'ok').length;
  const errores = archivos.filter((a) => a.estado === 'error').length;
  const terminado = archivos.length > 0 && archivos.every((a) => a.estado === 'ok' || a.estado === 'error');
  const chip = (activo: boolean) => `min-h-[2rem] rounded-full border px-3 text-xs font-semibold ${activo ? 'border-primario bg-primario text-sobre-primario' : 'text-suave hover:text-texto'}`;

  return (
    <Dialogo abierto={abierto} onCerrar={cerrar} titulo="Generación Masiva desde PDFs" icono={Zap} ancho="max-w-2xl" bloqueado={procesando}
      pie={<>
        <button type="button" onClick={cerrar} disabled={procesando} className="min-h-control rounded border bg-elevado px-4 text-sm font-semibold disabled:opacity-50">{terminado ? 'Cerrar' : 'Cancelar'}</button>
        {terminado && errores > 0 && (
          <button type="button" onClick={() => setArchivos([])} className="min-h-control rounded border px-4 text-sm font-semibold">Intentar de nuevo</button>
        )}
        {!terminado && (
          <button type="button" onClick={generar} disabled={!archivos.length || procesando}
            className="inline-flex min-h-control items-center gap-2 rounded bg-primario px-4 text-sm font-semibold text-sobre-primario disabled:opacity-50">
            <Zap className="h-4 w-4" aria-hidden />
            {procesando ? `Procesando ${ok}/${archivos.length}...` : `Generar ${archivos.length} certificado${archivos.length === 1 ? '' : 's'}`}
          </button>
        )}
      </>}>
      <div className="space-y-4">
        {!procesando && (
          <div onClick={() => entrada.current?.click()} onDragOver={(e) => { e.preventDefault(); setArrastrando(true); }} onDragLeave={() => setArrastrando(false)} onDrop={soltar}
            className={`cursor-pointer rounded-lg border-2 border-dashed p-8 text-center transition-colors ${arrastrando ? 'border-primario bg-primario/10' : 'border-borde hover:border-primario/50'}`}>
            <input ref={entrada} type="file" multiple accept=".pdf,application/pdf" className="sr-only" onChange={(e) => { agregar(e.target.files); e.target.value = ''; }} />
            <UploadCloud className="mx-auto mb-2 h-10 w-10 text-suave" aria-hidden />
            <p className="font-semibold">Arrastrá los PDFs acá o hacé click</p>
            <p className="text-xs text-suave">Podés subir hasta 20 archivos PDF a la vez</p>
          </div>
        )}

        {archivos.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <button type="button" className={chip(filtro === 'Todas')} onClick={() => setFiltro('Todas')}>Todas ({archivos.length})</button>
            {comunas.map((c) => (
              <button key={c} type="button" className={chip(filtro === c)} onClick={() => setFiltro(c)}>{c} ({archivos.filter((a) => a.comuna === c).length})</button>
            ))}
          </div>
        )}

        {visibles.length > 0 && (
          <ul className="max-h-72 divide-y overflow-y-auto rounded border">
            {visibles.map((a) => {
              const e = ESTADOS[a.estado];
              return (
                <li key={a.clave} className="flex items-center gap-3 px-3 py-2">
                  <FileText className="h-4 w-4 shrink-0 text-suave" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{a.file.name}</p>
                    {a.error && <p className="truncate text-xs text-peligro">{a.error}</p>}
                    {a.estado === 'ok' && <p className="text-xs text-exito">Certificado N° {a.numero}</p>}
                  </div>
                  <span className={`rounded-full border px-2 py-0.5 text-xs ${COLOR_COMUNA[a.comuna] ?? 'border-borde bg-elevado text-suave'}`}>{a.comuna}</span>
                  <span className={`flex items-center gap-1 text-xs ${e.cls}`}><e.Icono className={`h-3.5 w-3.5 ${e.girando ? 'animate-spin' : ''}`} aria-hidden />{e.label}</span>
                  {!procesando && a.estado === 'pendiente' && (
                    <button type="button" onClick={() => setArchivos((l) => l.filter((x) => x.clave !== a.clave))} aria-label={`Quitar ${a.file.name}`} className="flex h-8 w-8 items-center justify-center rounded text-suave hover:bg-elevado"><X className="h-4 w-4" aria-hidden /></button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {terminado && (
          <div className={`rounded border p-3 text-sm ${errores ? 'border-alerta/40 bg-alerta/10' : 'border-exito/40 bg-exito/10'}`}>
            {ok} certificado{ok === 1 ? '' : 's'} generado{ok === 1 ? '' : 's'}{errores ? ` · ${errores} con error` : ''}
          </div>
        )}
      </div>
    </Dialogo>
  );
}
