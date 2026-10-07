'use client';

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Camera, CheckCircle2, Circle, ClipboardX, ListChecks, Loader2, Package, X } from 'lucide-react';
import { toast } from 'sonner';
import { agregarFoto, borrarFoto, leerBorrador, listarFotos, guardarBorrador, type OTLocal, type Quien } from '@/lib/ot';
import { limpiarError } from '@/lib/errores';
import type { FotoOT, TareaChecklist } from '@/lib/types';

// Reporte de Cierre de la v1 (components/operario/ReporteForm.jsx). Además, como la v2 exige checklist
// completo (o el motivo de lo que no se hizo), el formulario muestra las tareas y el motivo.
// Las fotos se suben con o sin señal (quedan en la cola); los materiales usados se cargan con señal.

const MOTIVOS_PREDEFINIDOS = ['Sin stock en pañol', 'Material dañado', 'Cantidad insuficiente', 'No corresponde al trabajo', 'Otro'];

export interface Reporte {
  checklist: TareaChecklist[];
  motivo: string;
  notas: string;
  usados: { material: string; cantidad: number }[];
  faltantes: { material: string; cantidad: number; motivo: string }[];
}

export function BodyPortal({ children }: { children: ReactNode }) {
  const [listo, setListo] = useState(false);
  useEffect(() => setListo(true), []);
  return listo ? createPortal(children, document.body) : null;
}

const INPUT = 'bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-primary';

export function ReporteForm({ ot, quien, onClose, onSaved }: { ot: OTLocal; quien: Quien; onClose: () => void; onSaved: (r: Reporte) => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  const [checklist, setChecklist] = useState<TareaChecklist[]>(ot.checklist ?? []);
  const [motivo, setMotivo] = useState(ot.motivos_incompleto?.[0]?.texto ?? '');
  const [notas, setNotas] = useState(ot.notas ?? '');
  const [material, setMaterial] = useState('');
  const [cantidad, setCantidad] = useState('1');
  const [usados, setUsados] = useState<Reporte['usados']>([]);
  const [faltantes, setFaltantes] = useState<Reporte['faltantes']>(
    ((ot as unknown as { materiales_faltantes?: Reporte['faltantes'] }).materiales_faltantes ?? []).map((f) => ({ ...f, motivo: f.motivo ?? '' })),
  );
  const [faltanteNombre, setFaltanteNombre] = useState('');
  const [faltanteCant, setFaltanteCant] = useState('1');
  const [faltanteMotivo, setFaltanteMotivo] = useState('');
  const [photos, setPhotos] = useState<FotoOT[]>([]);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const urls = useRef<string[]>([]);

  // Si el operario ya había marcado tareas en el teléfono (borrador), se retoma.
  useEffect(() => {
    leerBorrador(ot.id).then((b) => {
      if (b) { setChecklist(b.checklist); setNotas(b.notas); setMotivo(b.motivo); }
    }).catch(() => undefined);
  }, [ot.id]);
  useEffect(() => {
    const t = setTimeout(() => void guardarBorrador({ ot_id: ot.id, checklist, notas, motivo }).catch(() => undefined), 400);
    return () => clearTimeout(t);
  }, [ot.id, checklist, notas, motivo]);

  const cargarFotos = async () => {
    try {
      const lista = await listarFotos(ot.id);
      urls.current.forEach((u) => URL.revokeObjectURL(u));
      urls.current = lista.filter((f) => f.enEspera).map((f) => f.url);
      setPhotos(lista);
    } catch { setPhotos([]); }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void cargarFotos(); return () => urls.current.forEach((u) => URL.revokeObjectURL(u)); }, [ot.id]);

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingPhoto(true);
    try {
      const destino = await agregarFoto(quien, ot, file);
      if (destino === 'guardado') toast.info('Sin conexión: la foto quedó en el teléfono y se sube al volver la señal.');
      await cargarFotos();
    } catch (err) {
      toast.error(limpiarError(err) || 'Error al subir foto');
    } finally {
      setUploadingPhoto(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const addUsado = () => {
    if (!material.trim()) return;
    setUsados((p) => [...p, { material: material.trim(), cantidad: Number(cantidad.replace(',', '.')) || 1 }]);
    setMaterial('');
    setCantidad('1');
  };

  const addFaltante = () => {
    if (!faltanteNombre.trim()) { toast.error('Indicá el nombre del material faltante'); return; }
    if (!faltanteMotivo.trim()) { toast.error('Debes seleccionar un motivo para el material faltante'); return; }
    setFaltantes((p) => [...p, { material: faltanteNombre.trim(), cantidad: Number(faltanteCant.replace(',', '.')) || 1, motivo: faltanteMotivo }]);
    setFaltanteNombre('');
    setFaltanteCant('1');
    setFaltanteMotivo('');
  };

  const pendientes = checklist.filter((t) => !t.hecho).length;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (faltantes.some((m) => !m.motivo.trim())) { toast.error('Todos los materiales faltantes deben tener un motivo'); return; }
    if (pendientes > 0 && !motivo.trim()) { toast.error('Faltan tareas del checklist. Marcalas o indicá por qué no se pudieron hacer.'); return; }
    setSaving(true);
    try {
      await onSaved({ checklist, motivo, notas, usados, faltantes });
    } catch (err) {
      toast.error(`Error: ${limpiarError(err) || 'intente nuevamente'}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <BodyPortal>
      <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
        <form onSubmit={handleSubmit} className="relative flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-slate-700 bg-slate-900 shadow-2xl sm:rounded-2xl">
          <div className="flex items-center justify-between border-b border-slate-800 p-4">
            <div>
              <h2 className="text-base font-bold text-white">Reporte de Cierre</h2>
              <p className="text-xs text-slate-500">Al guardar, la OT se envía al Jefe de Sitio</p>
            </div>
            <button type="button" aria-label="Cerrar" onClick={onClose} className="text-slate-500 hover:text-white"><X className="h-5 w-5" /></button>
          </div>
          <p className="truncate px-4 pt-3 text-xs text-slate-400">{ot.titulo}</p>

          <div className="flex-1 space-y-5 overflow-y-auto p-4">
            {checklist.length > 0 && (
              <div>
                <label className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-300">
                  <ListChecks className="h-3.5 w-3.5 text-emerald-400" /> Tareas ({checklist.length - pendientes}/{checklist.length})
                </label>
                <div className="space-y-1.5">
                  {checklist.map((t) => (
                    <button key={t.id} type="button" onClick={() => setChecklist((p) => p.map((x) => (x.id === t.id ? { ...x, hecho: !x.hecho } : x)))}
                      className={`flex min-h-11 w-full items-center gap-3 rounded-lg border p-2.5 text-left transition-colors ${t.hecho ? 'border-emerald-700/40 bg-emerald-950/30' : 'border-slate-700/50 bg-slate-800/50'}`}>
                      {t.hecho ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" /> : <Circle className="h-5 w-5 shrink-0 text-slate-500" />}
                      <span className={`text-sm ${t.hecho ? 'text-slate-500 line-through' : 'text-slate-100'}`}>{t.tarea}</span>
                    </button>
                  ))}
                </div>
                {pendientes > 0 && (
                  <div className="mt-2">
                    <label className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-orange-300"><ClipboardX className="h-3.5 w-3.5" /> ¿Por qué no se terminó? *</label>
                    <textarea rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Contá qué tareas no se pudieron hacer y por qué..."
                      className={`w-full resize-none ${INPUT}`} />
                  </div>
                )}
              </div>
            )}

            <div>
              <label className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-300">
                <Camera className="h-3.5 w-3.5 text-sky-400" /> Fotos de Evidencia{ot.requiere_fotos ? ' *' : ''}
              </label>
              {photos.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-2">
                  {photos.map((f) => (
                    <div key={f.id} className="relative h-16 w-16 overflow-hidden rounded-lg border border-slate-700">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={f.url} alt="evidencia" className="h-full w-full object-cover" />
                      <button type="button" aria-label="Quitar foto" onClick={() => borrarFoto(f).then(cargarFotos).catch((err) => toast.error(limpiarError(err)))}
                        className="absolute right-0 top-0 rounded-bl bg-black/70 p-0.5 text-white"><X className="h-3 w-3" /></button>
                    </div>
                  ))}
                </div>
              )}
              <label className={`flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-slate-600 text-xs font-medium text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200 ${uploadingPhoto ? 'pointer-events-none opacity-50' : ''}`}>
                {uploadingPhoto ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                {uploadingPhoto ? 'Subiendo...' : 'Agregar foto'}
                <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={handlePhotoUpload} className="hidden" />
              </label>
            </div>

            <div>
              <label className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-300">
                <Package className="h-3.5 w-3.5 text-blue-400" /> Materiales Usados
              </label>
              {usados.length > 0 && (
                <div className="mb-2 space-y-1.5">
                  {usados.map((m, i) => (
                    <div key={i} className="flex items-center gap-2 rounded-lg bg-slate-800/50 p-2.5">
                      <span className="flex-1 text-sm text-slate-200">{m.material}</span>
                      <span className="text-xs tabular-nums text-slate-400">{m.cantidad}u</span>
                      <button type="button" aria-label="Quitar" onClick={() => setUsados((p) => p.filter((_, x) => x !== i))} className="text-slate-500 hover:text-red-400"><X className="h-3.5 w-3.5" /></button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <input value={material} onChange={(e) => setMaterial(e.target.value)} placeholder="Nombre del material" className={`flex-1 ${INPUT}`} />
                <input inputMode="decimal" value={cantidad} onChange={(e) => setCantidad(e.target.value)} aria-label="Cantidad" className={`w-16 text-center ${INPUT}`} />
                <button type="button" aria-label="Agregar material" onClick={addUsado} className="rounded-lg bg-slate-700 px-3 text-sm font-medium text-slate-200 hover:bg-slate-600">+</button>
              </div>
            </div>

            <div>
              <label className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-300">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-400" /> Materiales Faltantes
              </label>
              <p className="mb-2 text-[10px] text-amber-400/70">El motivo es obligatorio para cada faltante</p>
              {faltantes.length > 0 && (
                <div className="mb-2 space-y-1.5">
                  {faltantes.map((m, i) => (
                    <div key={i} className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 p-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-amber-200">{m.material} · {m.cantidad}u</p>
                        <p className="text-xs text-amber-400/80">{m.motivo}</p>
                      </div>
                      <button type="button" aria-label="Quitar" onClick={() => setFaltantes((p) => p.filter((_, x) => x !== i))} className="mt-0.5 text-slate-500 hover:text-red-400"><X className="h-3.5 w-3.5" /></button>
                    </div>
                  ))}
                </div>
              )}
              <div className="space-y-2">
                <div className="flex gap-2">
                  <input value={faltanteNombre} onChange={(e) => setFaltanteNombre(e.target.value)} placeholder="Material faltante" className={`flex-1 ${INPUT}`} />
                  <input inputMode="decimal" value={faltanteCant} onChange={(e) => setFaltanteCant(e.target.value)} aria-label="Cantidad faltante" className={`w-16 text-center ${INPUT}`} />
                </div>
                <select value={faltanteMotivo} onChange={(e) => setFaltanteMotivo(e.target.value)} aria-label="Motivo del faltante" className={`w-full ${INPUT}`}>
                  <option value="">Seleccionar motivo *</option>
                  {MOTIVOS_PREDEFINIDOS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
                <button type="button" onClick={addFaltante}
                  className="h-8 w-full rounded-lg border border-dashed border-slate-600 text-xs font-medium text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200">+ Agregar faltante</button>
              </div>
            </div>

            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-300">Observaciones</label>
              <textarea rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Notas del trabajo..." className={`w-full resize-none ${INPUT}`} />
            </div>
          </div>

          <div className="border-t border-slate-800 p-4" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
            <button type="submit" disabled={saving}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 text-sm font-bold text-white transition-colors hover:bg-emerald-500 disabled:opacity-50">
              {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Enviar al Jefe de Sitio'}
            </button>
          </div>
        </form>
      </div>
    </BodyPortal>
  );
}
