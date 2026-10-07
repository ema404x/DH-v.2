'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle, ArrowLeft, Camera, CheckCircle2, ChevronLeft, ChevronRight, ClipboardList, Clock, Layers, Loader2, MapPin, Mic, MicOff,
  Package, Plus, QrCode, Search, Trash2, User, Wrench, X, Zap, type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { OTTemplateSelector, QRCodeModal } from '@/components/ordenes/piezas';
import { ReglasOroElectricidad } from '@/components/ordenes/ReglasOro';
import { buscar, crearOT } from '@/lib/gestion';
import { guardarPendiente } from '@/lib/operacion';
import { cargarMaterialOT } from '@/lib/panol';
import { urlDeQR } from '@/lib/qr';
import { useSesion } from '@/lib/sesion';
import { supabase } from '@/lib/supabase/client';
import { exigir } from '@/lib/errores';
import { listarPersonas, subirFoto, type PersonaSector } from '@/lib/tablero';
import type { Plantilla, Prioridad, ResultadoBusqueda, TareaChecklist, TipoOT } from '@/lib/types';

// "Crear OT" de la v1 (pages/CrearOT.jsx): Activo → Detalle → Materiales, con modo Futura Obra,
// dictado por voz, fotos de referencia y las 5 Reglas de Oro. Guarda con las reglas de la v2.

const PRIORITIES: { value: Prioridad; label: string; color: string }[] = [
  { value: 'baja', label: 'Baja', color: 'bg-slate-500/20 text-slate-300 border-slate-500/40' },
  { value: 'media', label: 'Media', color: 'bg-blue-500/20 text-blue-300 border-blue-500/40' },
  { value: 'alta', label: 'Alta', color: 'bg-orange-500/20 text-orange-300 border-orange-500/40' },
  { value: 'urgente', label: '🚨 Urgente', color: 'bg-red-500/20 text-red-300 border-red-500/40' },
];

const TYPES: { value: TipoOT; label: string; icon: LucideIcon }[] = [
  { value: 'mantenimiento_correctivo', label: 'Correctivo', icon: Wrench },
  { value: 'mantenimiento_preventivo', label: 'Preventivo', icon: Clock },
  { value: 'instalacion', label: 'Instalación', icon: Zap },
  { value: 'inspeccion', label: 'Inspección', icon: ClipboardList },
  { value: 'reparacion', label: 'Reparación', icon: AlertTriangle },
  { value: 'emergencia', label: 'Emergencia', icon: AlertTriangle },
];

const STEPS = [{ id: 1, label: 'Activo' }, { id: 2, label: 'Detalle' }, { id: 3, label: 'Materiales' }];
const PALABRAS_ELECTRICAS = ['electr', 'tension', 'tensión', 'tablero', 'cable', 'circuito', 'voltaje', 'corriente', 'fusible', 'disyuntor', 'interruptor', 'instalación eléctrica', 'tomacorriente', 'llave térmica'];

// Lo que la OT hereda del activo elegido (o de la ubicación, si se vino desde una obra).
interface Lugar {
  activo_id: string | null;
  nombre: string;
  address: string;
  ubicacion_id: string | null;
  ubicacion_nombre: string | null;
  ubicacion_qr: string | null;
  jefe_id: string | null;
  jefe_nombre: string | null;
  codigo: string | null;
}

async function lugarDeActivo(a: ResultadoBusqueda): Promise<Lugar> {
  const sb = supabase();
  const act = exigir(await sb.from('activos').select('id,nombre,codigo,area,ubicacion_id').eq('id', a.id).single()) as {
    id: string; nombre: string; codigo: string | null; area: string | null; ubicacion_id: string | null;
  };
  type Ubi = { nombre: string; direccion: string | null; qr_token: string | null; jefe_sitio_id: string | null; jefe_sitio_nombre: string | null };
  const u: Ubi | null = act.ubicacion_id
    ? (exigir(await sb.from('ubicaciones').select('nombre,direccion,qr_token,jefe_sitio_id,jefe_sitio_nombre').eq('id', act.ubicacion_id).single()) as Ubi)
    : null;
  return {
    activo_id: act.id, nombre: act.nombre, codigo: act.codigo,
    address: [u?.nombre, act.area].filter(Boolean).join(' · '),
    ubicacion_id: act.ubicacion_id, ubicacion_nombre: u?.nombre ?? null, ubicacion_qr: u?.qr_token ?? null,
    jefe_id: u?.jefe_sitio_id ?? null, jefe_nombre: u?.jefe_sitio_nombre ?? null,
  };
}

interface Material { material_name: string; quantity: number }

function SectionTitle({ icon: Icon, label, sub }: { icon: LucideIcon; label: string; sub?: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10">
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <div>
        <h2 className="text-lg font-bold text-foreground">{label}</h2>
        {sub && <p className="text-sm text-muted-foreground">{sub}</p>}
      </div>
    </div>
  );
}

function FieldGroup({ label, children, action }: { label: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</label>
        {action}
      </div>
      {children}
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="max-w-[60%] truncate text-right font-medium text-foreground">{value}</span>
    </div>
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Reconocedor = any;

export default function CrearOT() {
  const router = useRouter();
  const { perfil, esGerencia, sectorEfectivo } = useSesion();
  // BAPRO: las OT son generales, sin activo. Arrancan en Detalle (como la v1).
  const isBapro = sectorEfectivo?.clave === 'bapro';
  const firstStep = isBapro ? 2 : 1;
  const steps = isBapro ? STEPS.filter((s) => s.id !== 1) : STEPS;

  const [step, setStep] = useState(firstStep);
  const [created, setCreated] = useState<{ id: string | null; titulo: string } | null>(null);
  const [showQR, setShowQR] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);

  const [lugar, setLugar] = useState<Lugar | null>(null);
  const [title, setTitle] = useState('');
  const [type, setType] = useState<TipoOT>('mantenimiento_correctivo');
  const [priority, setPriority] = useState<Prioridad>('media');
  const [description, setDescription] = useState('');
  const [checklist, setChecklist] = useState<TareaChecklist[]>([]);
  const [scheduledDate, setScheduledDate] = useState('');
  const [materials, setMaterials] = useState<Material[]>([]);
  const [photos, setPhotos] = useState<{ file: File; url: string }[]>([]);
  const [requirePhotos, setRequirePhotos] = useState(false);
  const [modoGuardado, setModoGuardado] = useState<'ot' | 'futura_obra'>('ot');
  const [asignadoId, setAsignadoId] = useState('');
  const [dismissedReglasOro, setDismissedReglasOro] = useState(false);
  const [obra, setObra] = useState<{ id: string; titulo: string } | null>(null);
  const [personas, setPersonas] = useState<PersonaSector[]>([]);
  const [saving, setSaving] = useState(false);

  // Búsqueda de activo
  const [locationSearch, setLocationSearch] = useState('');
  const [suggestions, setSuggestions] = useState<ResultadoBusqueda[]>([]);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // Voz
  const [recording, setRecording] = useState(false);
  const [noSpeechSupport, setNoSpeechSupport] = useState(false);
  const recognitionRef = useRef<Reconocedor>(null);
  const isRecordingRef = useRef(false);
  const descAcumuladaRef = useRef('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { listarPersonas().then(setPersonas).catch(() => setPersonas([])); }, []);
  useEffect(() => () => { isRecordingRef.current = false; recognitionRef.current?.stop(); }, []);

  // Desde una obra: /gestion/ots/nueva?obra=<id>&obraTitulo=<título>&ubicacion=<id>&ubicacionNombre=<nombre>
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const id = p.get('obra');
    if (id) setObra({ id, titulo: p.get('obraTitulo') ?? 'Obra' });
    const u = p.get('ubicacion');
    if (u) {
      const nombre = p.get('ubicacionNombre') ?? 'Ubicación';
      supabase().from('ubicaciones').select('nombre,qr_token,jefe_sitio_id,jefe_sitio_nombre').eq('id', u).single().then(({ data }) => {
        setLugar({
          activo_id: null, nombre: data?.nombre ?? nombre, address: data?.nombre ?? nombre, codigo: null, ubicacion_id: u, ubicacion_nombre: data?.nombre ?? nombre,
          ubicacion_qr: data?.qr_token ?? null, jefe_id: data?.jefe_sitio_id ?? null, jefe_nombre: data?.jefe_sitio_nombre ?? null,
        });
        setLocationSearch(data?.nombre ?? nombre);
      });
    }
  }, []);

  useEffect(() => {
    if (lugar || locationSearch.trim().length < 2) { setSuggestions([]); return; }
    setLoadingAssets(true);
    const t = setTimeout(() => buscar('activos', locationSearch).then(setSuggestions).catch(() => setSuggestions([])).finally(() => setLoadingAssets(false)), 250);
    return () => clearTimeout(t);
  }, [locationSearch, lugar]);

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('#location-search-container')) setShowSuggestions(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const esTrabajoElectrico = useMemo(() => {
    const texto = `${title} ${description}`.toLowerCase();
    return PALABRAS_ELECTRICAS.some((p) => texto.includes(p)) || type === 'instalacion';
  }, [title, description, type]);

  // Un jefe de sitio no asigna a otros jefes (como la v1).
  const asignables = personas.filter((p) => p.activo && (esGerencia || p.rol !== 'jefe_sitio'));
  const asignadoNombre = personas.find((p) => p.id === asignadoId)?.nombre ?? '';
  const autoJefeSitio = lugar?.jefe_nombre ?? '';

  const handleSelectAsset = useCallback(async (a: ResultadoBusqueda) => {
    setShowSuggestions(false);
    try {
      const l = await lugarDeActivo(a);
      setLugar(l);
      setLocationSearch(l.address || l.nombre);
      if (l.jefe_nombre) toast.info(`Jefe de sitio asignado: ${l.jefe_nombre}`);
    } catch {
      toast.error('No se pudo leer el activo.');
    }
  }, []);

  const handleClearLocation = () => {
    setLugar(null);
    setLocationSearch('');
    setShowSuggestions(false);
    setTimeout(() => searchRef.current?.focus(), 50);
  };

  const handleApplyTemplate = (t: Plantilla) => {
    setTitle(t.titulo || '');
    setType(t.tipo || 'mantenimiento_correctivo');
    setPriority(t.prioridad || 'media');
    setDescription(t.descripcion || '');
    setRequirePhotos(!!t.requiere_fotos);
    setChecklist((t.checklist ?? []).map((c) => ({ id: crypto.randomUUID(), tarea: c.tarea, hecho: false })));
    setTemplateOpen(false);
    toast.success(`Plantilla "${t.nombre}" aplicada`);
  };

  // ── voz (Web Speech API, es-AR), igual que la v1
  const createRecognition = (): Reconocedor => {
    const w = window as any;
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) return null;
    const r = new SR();
    r.lang = 'es-AR';
    r.continuous = false;
    r.interimResults = false;
    r.maxAlternatives = 1;
    r.onresult = (e: any) => {
      const transcript = Array.from(e.results as ArrayLike<any>).map((res: any) => res[0].transcript).join(' ').trim();
      if (transcript) {
        const base = descAcumuladaRef.current.trimEnd();
        const updated = base ? `${base} ${transcript}` : transcript;
        descAcumuladaRef.current = updated;
        setDescription(updated);
      }
    };
    r.onerror = (e: any) => {
      if (isRecordingRef.current && (e.error === 'no-speech' || e.error === 'audio-capture')) {
        setTimeout(() => { if (isRecordingRef.current) { try { r.start(); } catch { /* ya corriendo */ } } }, 300);
      } else if (e.error !== 'aborted') {
        isRecordingRef.current = false;
        setRecording(false);
      }
    };
    r.onend = () => {
      if (isRecordingRef.current) {
        setTimeout(() => {
          if (isRecordingRef.current) { const n = createRecognition(); if (n) { recognitionRef.current = n; n.start(); } }
        }, 200);
      } else setRecording(false);
    };
    return r;
  };
  const startRecording = () => {
    const w = window as any;
    if (!(w.SpeechRecognition || w.webkitSpeechRecognition)) { setNoSpeechSupport(true); return; }
    descAcumuladaRef.current = description;
    isRecordingRef.current = true;
    setRecording(true);
    const r = createRecognition();
    if (r) { recognitionRef.current = r; r.start(); }
  };
  const stopRecording = () => { isRecordingRef.current = false; setRecording(false); recognitionRef.current?.stop(); };

  // Fotos de referencia: quedan en el teléfono y se suben (comprimidas) al crear la orden.
  const handlePhotos = (files: FileList | null) => {
    if (!files?.length) return;
    setPhotos((prev) => [...prev, ...Array.from(files).map((file) => ({ file, url: URL.createObjectURL(file) }))]);
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleCreate = async () => {
    setSaving(true);
    try {
      if (modoGuardado === 'futura_obra') {
        await guardarPendiente(null, {
          descripcion: title.trim(), tipo: 'obra', prioridad: priority,
          ubicacion_id: lugar?.ubicacion_id ?? null,
          establecimiento: lugar?.ubicacion_nombre || lugar?.nombre || null,
          activo_nombre: lugar?.activo_id ? lugar.nombre : null,
          sitio: lugar ? (lugar.address || lugar.nombre) : null,
          materiales_necesarios: materials.filter((m) => m.material_name.trim()).map((m) => m.material_name).join(', ') || null,
          observaciones: description || null,
          fecha_limite: scheduledDate || null,
        } as Parameters<typeof guardarPendiente>[1]);
        setCreated({ id: null, titulo: title.trim() });
        setStep(5);
        toast.success('¡Futura obra registrada correctamente!');
        return;
      }
      // Sin persona elegida, queda a cargo el jefe de sitio del lugar (como la v1).
      const responsable = asignadoId || lugar?.jefe_id || null;
      const id = await crearOT({
        titulo: title.trim(), descripcion: description || null, tipo: type, prioridad: priority,
        ubicacion_id: lugar?.ubicacion_id ?? null, activo_id: lugar?.activo_id ?? null, asignado_a: responsable,
        fecha_programada: scheduledDate || null, horas_estimadas: null, checklist, requiere_fotos: requirePhotos, obra_id: obra?.id ?? null,
      });
      // Materiales y fotos van en sus tablas, ya con la orden creada.
      const avisos: string[] = [];
      for (const m of materials.filter((x) => x.material_name.trim())) {
        try {
          await cargarMaterialOT({ ot_id: id, material_id: null, descripcion: m.material_name.trim(), cantidad: m.quantity > 0 ? m.quantity : 1, costo_unitario: 0, descontar: false });
        } catch { avisos.push(m.material_name); }
      }
      if (photos.length && sectorEfectivo) {
        for (const p of photos) {
          try { await subirFoto({ id, sector_id: sectorEfectivo.id }, p.file); } catch { toast.error(`Error subiendo ${p.file.name}`); }
        }
      }
      if (avisos.length) toast.error(`No se pudieron cargar: ${avisos.join(', ')}`);
      setCreated({ id, titulo: title.trim() });
      setStep(5);
      toast.success('¡Orden de trabajo creada exitosamente!');
    } catch (e) {
      toast.error(modoGuardado === 'futura_obra' ? 'Error al registrar la futura obra.' : 'Error al crear la OT. Intente nuevamente.');
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  const resetForm = () => {
    setStep(firstStep); setCreated(null); setShowQR(false); setLugar(null); setLocationSearch(''); setShowSuggestions(false);
    setTitle(''); setType('mantenimiento_correctivo'); setPriority('media'); setDescription(''); descAcumuladaRef.current = '';
    setChecklist([]); setScheduledDate(''); setMaterials([]); setPhotos([]); setRequirePhotos(false); setDismissedReglasOro(false);
    setModoGuardado('ot'); setAsignadoId('');
  };

  const canProceed = () => (step === 2 ? title.trim().length > 0 : true);

  // ── éxito
  if (step === 5 && created) {
    return (
      <div className="flex min-h-[80vh] items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-4">
        <div className="w-full max-w-sm space-y-6 rounded-2xl border border-border bg-card p-8 text-center shadow-2xl">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500/20">
            <CheckCircle2 className="h-10 w-10 text-emerald-400" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-foreground">{modoGuardado === 'futura_obra' ? '¡Futura Obra Registrada!' : '¡OT Creada!'}</h2>
            <p className="mt-1 text-sm font-medium text-muted-foreground">{created.titulo}</p>
            {lugar && <p className="mt-3 flex items-center justify-center gap-1 text-xs text-muted-foreground"><MapPin className="h-3 w-3" /> {lugar.nombre}</p>}
          </div>
          <div className="space-y-2">
            {modoGuardado === 'ot' && created.id && (
              <Button className="w-full gap-2" onClick={() => setShowQR(true)}><QrCode className="h-4 w-4" /> Ver QR de la OT</Button>
            )}
            {modoGuardado === 'futura_obra' && (
              <Button className="w-full gap-2 bg-amber-500 text-white hover:bg-amber-600" onClick={() => router.push('/gestion/pendientes')}>
                <Wrench className="h-4 w-4" /> Ver Pendientes / Obras
              </Button>
            )}
            <Button variant="outline" className="w-full" onClick={resetForm}>{modoGuardado === 'futura_obra' ? 'Registrar otra' : 'Crear otra OT'}</Button>
            <Button variant="ghost" className="w-full text-muted-foreground" onClick={() => router.push('/gestion/ots')}>Ir a Órdenes de Trabajo</Button>
          </div>
        </div>
        {showQR && created.id && (
          <QRCodeModal open onClose={() => setShowQR(false)} title={created.titulo} subtitle={lugar?.nombre ?? ''}
            value={lugar?.ubicacion_qr ? urlDeQR(lugar.ubicacion_qr) : `${window.location.origin}/ot/${created.id}`} />
        )}
      </div>
    );
  }

  return (
    <div className="-m-4 min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 sm:-m-5 lg:-m-6">
      <div className="sticky -top-4 z-10 border-b border-border bg-slate-950/80 px-4 pb-3 pt-4 backdrop-blur sm:-top-5 lg:-top-6">
        <div className="mx-auto max-w-2xl">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Link href="/gestion/ots" aria-label="Volver a Órdenes"
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:text-foreground">
                <ArrowLeft className="h-4 w-4" />
              </Link>
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-purple-500 to-pink-600">
                <ClipboardList className="h-4 w-4 text-white" />
              </div>
              <div>
                <h1 className="text-base font-bold text-foreground">Crear Orden de Trabajo</h1>
                <p className="text-xs text-muted-foreground">Paso {steps.findIndex((s) => s.id === step) + 1} de {steps.length}</p>
              </div>
            </div>
            <Button size="sm" variant="outline" onClick={() => setTemplateOpen(true)} className="gap-1.5 border-border text-xs text-muted-foreground hover:text-foreground">
              <Layers className="h-3.5 w-3.5" /> Plantilla
            </Button>
          </div>
          <div className="flex gap-1">
            {steps.map((s) => (
              <div key={s.id} className="flex-1">
                <div className={`h-1 rounded-full transition-colors ${step >= s.id ? 'bg-primary' : 'bg-border'}`} />
                <p className={`mt-1 text-center text-[10px] font-medium transition-colors ${step === s.id ? 'text-primary' : step > s.id ? 'text-muted-foreground' : 'text-border'}`}>{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-2xl space-y-5 px-4 py-6">
        {obra && (
          <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-300">
            <Wrench className="h-3.5 w-3.5 shrink-0" /> Orden de la obra <strong>{obra.titulo}</strong>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-5">
            <SectionTitle icon={Wrench} label="¿Qué activo intervenir?" sub="Seleccioná el equipo/activo del módulo Activos sobre el que se trabajará" />
            <div className="space-y-2">
              <div id="location-search-container" className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input ref={searchRef} value={locationSearch} placeholder="Escribí para buscar activo (nombre, sede, código)..."
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setLocationSearch(e.target.value); if (lugar) setLugar(null); setShowSuggestions(true); }}
                  onFocus={() => setShowSuggestions(true)} className="h-12 border-border bg-card pl-9 pr-9 text-foreground" />
                {locationSearch && (
                  <button type="button" aria-label="Borrar" onClick={handleClearLocation} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    <X className="h-4 w-4" />
                  </button>
                )}
                {showSuggestions && suggestions.length > 0 && (
                  <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-80 overflow-hidden overflow-y-auto rounded-xl border border-border bg-card shadow-xl">
                    {suggestions.map((a) => (
                      <button key={a.id} type="button" onMouseDown={() => handleSelectAsset(a)}
                        className="flex w-full items-center gap-3 border-b border-border/50 px-4 py-3 text-left transition-colors last:border-0 hover:bg-accent">
                        <Wrench className="h-4 w-4 shrink-0 text-primary" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-foreground">{a.etiqueta}</p>
                          <p className="truncate text-xs text-muted-foreground">{a.detalle || 'Sin sede asignada'}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                {showSuggestions && !lugar && locationSearch.trim().length >= 2 && !loadingAssets && suggestions.length === 0 && (
                  <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground shadow-xl">
                    Sin resultados para &quot;{locationSearch}&quot;
                  </div>
                )}
              </div>
              {loadingAssets && <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Cargando activos...</div>}
              {lugar && (
                <div className="space-y-1 rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm">
                  <p className="flex items-center gap-2 font-semibold text-foreground"><CheckCircle2 className="h-4 w-4 text-primary" /> {lugar.nombre}</p>
                  {lugar.address && <p className="flex items-center gap-1 text-xs text-muted-foreground"><MapPin className="h-3 w-3" />{lugar.address}</p>}
                  {autoJefeSitio ? (
                    <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-emerald-400"><CheckCircle2 className="h-3 w-3" /> Jefe de sitio: {autoJefeSitio}</p>
                  ) : (
                    <p className="mt-1 text-xs text-amber-400/80">El activo no tiene jefe de sitio asignado</p>
                  )}
                </div>
              )}
              {!lugar && !locationSearch && <p className="py-2 text-center text-xs text-muted-foreground">El activo es opcional — podés continuar sin seleccionarlo</p>}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5">
            <SectionTitle icon={ClipboardList} label="Detalle de la orden" sub="Completá los datos principales de la tarea" />
            <FieldGroup label="Título *">
              <Input placeholder="Ej: Revisar filtraciones en techo del aula 3" value={title} autoFocus
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)} className="h-12 border-border bg-card text-base text-foreground" />
            </FieldGroup>
            <FieldGroup label="Tipo de trabajo">
              <div className="grid grid-cols-3 gap-2">
                {TYPES.map((t) => {
                  const Icon = t.icon;
                  return (
                    <button key={t.value} type="button" onClick={() => setType(t.value)}
                      className={`flex flex-col items-center gap-1.5 rounded-xl border-2 px-2 py-3 text-xs font-medium transition-all ${type === t.value ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-card text-muted-foreground hover:border-muted-foreground'}`}>
                      <Icon className="h-4 w-4" />{t.label}
                    </button>
                  );
                })}
              </div>
            </FieldGroup>
            <FieldGroup label="Prioridad">
              <div className="grid grid-cols-4 gap-2">
                {PRIORITIES.map((p) => (
                  <button key={p.value} type="button" onClick={() => setPriority(p.value)}
                    className={`rounded-xl border-2 py-2.5 text-xs font-bold transition-all ${priority === p.value ? `${p.color} border-current ring-1 ring-current` : 'border-border bg-card text-muted-foreground hover:border-muted-foreground'}`}>
                    {p.label}
                  </button>
                ))}
              </div>
            </FieldGroup>
            <div className="flex gap-1 rounded-xl border border-border bg-card p-1">
              <button type="button" onClick={() => setModoGuardado('ot')}
                className={`flex flex-1 flex-col items-center gap-1 rounded-lg py-3 text-sm font-semibold transition-all ${modoGuardado === 'ot' ? 'bg-gradient-to-r from-purple-500 to-pink-600 text-white shadow' : 'text-muted-foreground hover:text-foreground'}`}>
                <ClipboardList className="h-4 w-4" />Orden de Trabajo
              </button>
              <button type="button" onClick={() => setModoGuardado('futura_obra')}
                className={`flex flex-1 flex-col items-center gap-1 rounded-lg py-3 text-sm font-semibold transition-all ${modoGuardado === 'futura_obra' ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow' : 'text-muted-foreground hover:text-foreground'}`}>
                <Wrench className="h-4 w-4" />Futura Obra
              </button>
            </div>
            {modoGuardado === 'futura_obra' && (
              <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/8 px-4 py-2.5 text-xs text-amber-300">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> Se registrará como pendiente en el módulo de Obras, sin generar una OT.
              </div>
            )}
            {esTrabajoElectrico && !dismissedReglasOro && <ReglasOroElectricidad onClose={() => setDismissedReglasOro(true)} />}
            <FieldGroup label="Instrucciones para el operario">
              <textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)}
                placeholder="Describí detalladamente el trabajo a realizar, o usá el micrófono para dictarlo..."
                className="w-full resize-none rounded-xl border border-border bg-card px-3 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
              <div className="mt-1 flex flex-wrap items-center gap-2">
                {recording ? (
                  <button type="button" onClick={stopRecording} className="flex items-center gap-2 rounded-xl border border-red-500/50 bg-red-500/20 px-3 py-2 text-xs font-semibold text-red-400">
                    <MicOff className="h-3.5 w-3.5" /> Detener<span className="h-2 w-2 animate-ping rounded-full bg-red-500" />
                  </button>
                ) : (
                  <button type="button" onClick={startRecording} className="flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 text-xs font-semibold text-primary transition-colors hover:bg-primary/20">
                    <Mic className="h-3.5 w-3.5" /> Dictar instrucciones
                  </button>
                )}
                {recording && <span className="flex items-center gap-1.5 text-xs font-medium text-red-400"><Loader2 className="h-3 w-3 animate-spin" /> Escuchando — hablá con normalidad</span>}
                {noSpeechSupport && <span className="text-xs text-destructive">Usá Chrome para grabación de voz</span>}
              </div>
            </FieldGroup>
            {modoGuardado === 'ot' && (
              <FieldGroup label="Fotos de referencia">
                {photos.length > 0 && (
                  <div className="mb-2 grid grid-cols-4 gap-2">
                    {photos.map((p, idx) => (
                      <div key={p.url} className="relative aspect-square overflow-hidden rounded-xl border border-border">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p.url} alt="" className="h-full w-full object-cover" />
                        <button type="button" aria-label="Quitar foto" onClick={() => setPhotos((prev) => prev.filter((_, i) => i !== idx))}
                          className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white"><X className="h-3 w-3" /></button>
                      </div>
                    ))}
                  </div>
                )}
                <input ref={fileRef} type="file" accept="image/*" multiple capture="environment" className="hidden" onChange={(e) => handlePhotos(e.target.files)} />
                <button type="button" onClick={() => fileRef.current?.click()}
                  className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-card text-sm font-medium text-muted-foreground transition-colors hover:border-primary/50">
                  <Camera className="h-4 w-4" /> Agregar foto(s) de referencia
                </button>
              </FieldGroup>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-5">
            <SectionTitle icon={Package} label="Materiales y confirmación" sub="Agregá los insumos necesarios y revisá el resumen antes de crear la OT" />
            <FieldGroup label="Fecha programada">
              <Input type="date" value={scheduledDate} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setScheduledDate(e.target.value)} className="h-11 border-border bg-card text-foreground" />
            </FieldGroup>
            {modoGuardado === 'ot' && (
              <FieldGroup label="Persona a cargo">
                <div className="relative">
                  <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <select value={asignadoId} onChange={(e) => setAsignadoId(e.target.value)} aria-label="Persona a cargo"
                    className="h-11 w-full rounded-md border border-border bg-card pl-9 pr-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring">
                    <option value="">Nombre de la persona responsable...</option>
                    {asignables.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                  </select>
                </div>
                {autoJefeSitio && !asignadoId && (
                  <p className="mt-1.5 flex items-center gap-1 text-xs text-amber-400/80">
                    <AlertTriangle className="h-3 w-3 shrink-0" /> Si no asignás una persona, se usará el jefe de sitio: {autoJefeSitio}
                  </p>
                )}
              </FieldGroup>
            )}
            <FieldGroup label="Materiales necesarios"
              action={<button type="button" onClick={() => setMaterials((p) => [...p, { material_name: '', quantity: 1 }])} className="flex items-center gap-1 text-xs text-primary hover:underline"><Plus className="h-3 w-3" /> Agregar material</button>}>
              {materials.length === 0 ? (
                <button type="button" onClick={() => setMaterials([{ material_name: '', quantity: 1 }])}
                  className="flex h-16 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-card text-sm text-muted-foreground transition-colors hover:border-primary/50">
                  <Package className="h-4 w-4" /> Agregar materiales / insumos
                </button>
              ) : (
                <div className="space-y-2">
                  <div className="grid grid-cols-[1fr_80px_36px] gap-2 px-1">
                    <span className="text-xs font-medium uppercase text-muted-foreground">Material</span>
                    <span className="text-xs font-medium uppercase text-muted-foreground">Cant.</span>
                    <span />
                  </div>
                  {materials.map((m, idx) => (
                    <div key={idx} className="group flex items-center gap-2">
                      <Input value={m.material_name} placeholder="Material / insumo..." className="h-9 flex-1 border-slate-700 bg-slate-800 text-sm text-white"
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMaterials((p) => p.map((x, i) => (i === idx ? { ...x, material_name: e.target.value } : x)))} />
                      <Input type="number" value={m.quantity || ''} placeholder="Cant." className="h-9 w-20 border-slate-700 bg-slate-800 text-sm text-white"
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMaterials((p) => p.map((x, i) => (i === idx ? { ...x, quantity: parseFloat(e.target.value) || 0 } : x)))} />
                      <button type="button" aria-label="Quitar material" onClick={() => setMaterials((p) => p.filter((_, i) => i !== idx))}
                        className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 text-slate-500 opacity-0 transition-colors hover:border-red-500/50 hover:text-red-400 group-hover:opacity-100 focus:opacity-100">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                  <button type="button" onClick={() => setMaterials((p) => [...p, { material_name: '', quantity: 1 }])}
                    className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border bg-card text-xs text-muted-foreground transition-colors hover:border-primary/50">
                    <Plus className="h-3 w-3" /> Agregar material
                  </button>
                </div>
              )}
            </FieldGroup>
            {modoGuardado === 'ot' && (
              <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-border bg-card p-3 transition-colors hover:border-primary/50">
                <input type="checkbox" checked={requirePhotos} onChange={(e) => setRequirePhotos(e.target.checked)} className="h-4 w-4 rounded accent-cyan-500" />
                <div>
                  <p className="text-sm font-medium text-foreground">Requiere fotos para completar</p>
                  <p className="text-xs text-muted-foreground">El operario deberá adjuntar fotos antes de marcar la OT como completada</p>
                </div>
              </label>
            )}
            <div className="space-y-3 rounded-xl border border-border bg-card p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Resumen</p>
              <SummaryRow label="Guardar como" value={modoGuardado === 'futura_obra' ? '🔨 Futura Obra' : '📋 Orden de Trabajo'} />
              <SummaryRow label="Título" value={title} />
              <SummaryRow label="Tipo" value={TYPES.find((t) => t.value === type)?.label} />
              <SummaryRow label="Prioridad" value={priority.charAt(0).toUpperCase() + priority.slice(1)} />
              {lugar && <SummaryRow label="Activo" value={lugar.nombre} />}
              {asignadoNombre && <SummaryRow label="Persona a cargo" value={asignadoNombre} />}
              {autoJefeSitio && !asignadoId && <SummaryRow label="Jefe de sitio (auto)" value={autoJefeSitio} />}
              {scheduledDate && <SummaryRow label="Fecha programada" value={scheduledDate} />}
              {checklist.length > 0 && <SummaryRow label="Tareas" value={`${checklist.length} tarea(s)`} />}
              {materials.filter((m) => m.material_name.trim()).length > 0 && <SummaryRow label="Materiales" value={`${materials.filter((m) => m.material_name.trim()).length} ítem(s)`} />}
              {photos.length > 0 && <SummaryRow label="Fotos adjuntas" value={`${photos.length} foto(s)`} />}
              {requirePhotos && <SummaryRow label="Requiere fotos" value="Sí" />}
            </div>
          </div>
        )}

        <div className="flex gap-3 pb-8 pt-2">
          {step > firstStep && (
            <Button variant="outline" className="h-12 flex-1 gap-2 border-border" onClick={() => setStep((s) => s - 1)}>
              <ChevronLeft className="h-4 w-4" /> Atrás
            </Button>
          )}
          {step < 3 ? (
            <Button className="h-12 flex-1 gap-2 bg-gradient-to-r from-purple-500 to-pink-600 shadow-purple-500/30 hover:shadow-lg"
              onClick={() => { if (!canProceed()) { toast.error('Completá el título para continuar'); return; } setStep((s) => s + 1); }}>
              Continuar <ChevronRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button onClick={handleCreate} disabled={saving || !perfil}
              className={`h-12 flex-1 gap-2 text-base font-bold hover:shadow-lg ${modoGuardado === 'futura_obra' ? 'bg-gradient-to-r from-amber-500 to-orange-500 shadow-amber-500/30' : 'bg-gradient-to-r from-emerald-500 to-teal-600 shadow-emerald-500/30'}`}>
              {saving ? <><Loader2 className="h-5 w-5 animate-spin" /> Guardando...</>
                : modoGuardado === 'futura_obra' ? <><Wrench className="h-5 w-5" /> Registrar como Futura Obra</>
                  : <><CheckCircle2 className="h-5 w-5" /> Crear Orden de Trabajo</>}
            </Button>
          )}
        </div>
      </div>

      <OTTemplateSelector open={templateOpen} onOpenChange={setTemplateOpen} onSelect={handleApplyTemplate} />
    </div>
  );
}
