'use client';

import { useState, type DragEvent, type FormEvent } from 'react';
import { AlertTriangle, CheckCircle2, FileText, Plus, Save, Sparkles, Trash2, Upload, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { Boton } from '../Boton';
import { Area, Campo, Casilla, Selector, oNull } from '../Campos';
import { corregirItemsPDF, crearContrato, fmtPesos, leerContratoPDF, type ContratoLeido, type ItemLeido } from '@/lib/certificacion';
import { borrarArchivo, subirDocumento } from '@/lib/obras';
import { limpiarError } from '@/lib/errores';
import { useSesion } from '@/lib/sesion';

interface Fila {
  clave: string;
  descripcion: string;
  um: string;
  cantidad: string;
  importe_unitario: string;
  // La IA leyó este renglón pero parece un subtotal: se marca para que lo mire una persona.
  sospechoso?: boolean;
}

const filaVacia = (): Fila => ({ clave: crypto.randomUUID(), descripcion: '', um: 'u', cantidad: '', importe_unitario: '' });
const numero = (v: string) => Number(v.replace(',', '.'));
const aFila = (i: ItemLeido): Fila => ({
  clave: crypto.randomUUID(), descripcion: i.descripcion, um: i.um, cantidad: String(i.cantidad), importe_unitario: String(i.importe_unitario),
  sospechoso: i.subtotal_sospechoso,
});
// Igual que la v1: se acepta hasta 0,5 % de diferencia (redondeos del PDF).
const TOLERANCIA = 0.005;
const MAX_MB = 15;

// Alta de un contrato con sus ítems. El monto contratado no se carga: es la suma de los ítems y lo calcula la base.
// Se puede completar a mano o desde el PDF del ADA / orden de compra: la IA lo lee y llena el formulario,
// y una persona lo revisa antes de guardar (la IA no guarda nada).
export function FormContrato({ onCreado, onCancelar }: { onCreado: (id: string) => void; onCancelar: () => void }) {
  const { sectorEfectivo } = useSesion();
  const [tipo, setTipo] = useState<'abono_mensual' | 'obra'>('abono_mensual');
  const [contratista, setContratista] = useState('');
  const [cuit, setCuit] = useState('');
  const [obra, setObra] = useState('');
  const [emprendimiento, setEmprendimiento] = useState('');
  const [ada, setAda] = useState('');
  const [oc, setOc] = useState('');
  const [inicio, setInicio] = useState('');
  const [fin, setFin] = useState('');
  const [plazo, setPlazo] = useState('');
  const [condiciones, setCondiciones] = useState('');
  const [anticipo, setAnticipo] = useState('0');
  const [fondo, setFondo] = useState('5');
  const [aplicarFondo, setAplicarFondo] = useState(false);
  const [items, setItems] = useState<Fila[]>([filaVacia()]);
  const [guardando, setGuardando] = useState(false);

  // Lectura del PDF
  const [tipoPDF, setTipoPDF] = useState<'auto' | 'abono_mensual' | 'obra'>('auto');
  const [pdf, setPdf] = useState<{ path: string; nombre: string } | null>(null);
  const [totalDocumento, setTotalDocumento] = useState<number | null>(null);
  const [paso, setPaso] = useState<'' | 'subiendo' | 'leyendo' | 'corrigiendo'>('');
  const [aviso, setAviso] = useState('');
  const [arrastrando, setArrastrando] = useState(false);

  const total = items.reduce((t, i) => t + (numero(i.cantidad) || 0) * (numero(i.importe_unitario) || 0), 0);
  const coincide = totalDocumento ? Math.abs(total - totalDocumento) <= totalDocumento * TOLERANCIA : null;
  const cambiar = (clave: string, campo: keyof Fila, valor: string) =>
    setItems((actual) => actual.map((i) => (i.clave === clave ? { ...i, [campo]: valor } : i)));

  function volcar(d: ContratoLeido) {
    if (d.tipo === 'abono_mensual' || d.tipo === 'obra') setTipo(d.tipo);
    setContratista(d.contratista);
    setCuit(d.contratista_cuit);
    setObra(d.obra_servicio);
    setEmprendimiento(d.emprendimiento);
    setAda(d.ada_numero);
    setOc(d.oc_numero);
    setInicio(d.fecha_inicio);
    setFin(d.fecha_fin);
    setPlazo(d.plazo);
    setCondiciones(d.condiciones_pago);
    if (d.anticipo_pct) setAnticipo(String(d.anticipo_pct));
    if (d.fondo_reparo_pct) setFondo(String(d.fondo_reparo_pct));
    setItems(d.items.length ? d.items.map(aFila) : [filaVacia()]);
  }

  async function leerPDF(archivo: File | undefined) {
    if (!archivo) return;
    if (archivo.type !== 'application/pdf' && !archivo.name.toLowerCase().endsWith('.pdf')) {
      toast.error('Solo se leen archivos PDF.');
      return;
    }
    if (archivo.size > MAX_MB * 1024 * 1024) {
      toast.error(`El PDF pesa más de ${MAX_MB} MB.`);
      return;
    }
    if (!sectorEfectivo) {
      toast.error('Elegí un sector (no "ver todos") para cargar el contrato.');
      return;
    }
    try {
      setPaso('subiendo');
      // Si ya había otro PDF leído y sin guardar, se reemplaza.
      if (pdf) await borrarArchivo(pdf.path).catch(() => undefined);
      const doc = await subirDocumento(sectorEfectivo.id, 'contratos', archivo);
      setPdf({ path: doc.path, nombre: archivo.name });
      setPaso('leyendo');
      const r = await leerContratoPDF(doc.path, tipoPDF);
      volcar(r.datos);
      setTotalDocumento(r.validacion.total_documento);
      setAviso(r.aviso ?? '');
      const sospechosos = r.datos.items.filter((i) => i.subtotal_sospechoso).length;
      if (r.validacion.coincide === false) toast.warning('Datos leídos, pero la suma de los ítems no da el total del documento: revisalos.');
      else if (sospechosos) toast.warning('Datos leídos. Hay renglones que parecen subtotales: revisalos antes de guardar.');
      else toast.success('Datos leídos del PDF. Revisalos y guardá el contrato.');
    } catch (err) {
      toast.error(limpiarError(err));
    } finally {
      setPaso('');
    }
  }

  async function corregir() {
    if (!pdf || !totalDocumento) return;
    setPaso('corrigiendo');
    try {
      const r = await corregirItemsPDF(pdf.path, totalDocumento, Math.round(total * 100) / 100);
      setItems(r.items.map(aFila));
      if (r.validacion.coincide) toast.success('Ítems corregidos: ahora la suma da el total del documento.');
      else toast.warning('La IA corrigió los ítems pero la suma sigue sin dar: revisalos a mano.');
    } catch (err) {
      toast.error(limpiarError(err));
    } finally {
      setPaso('');
    }
  }

  async function cancelar() {
    // El PDF subido para leer y no usado no queda suelto en el bucket.
    if (pdf) await borrarArchivo(pdf.path).catch(() => undefined);
    onCancelar();
  }

  async function guardar(e: FormEvent) {
    e.preventDefault();
    const validos = items.filter((i) => i.descripcion.trim());
    if (validos.length === 0) {
      toast.error('Cargá al menos un ítem con descripción, cantidad y precio.');
      return;
    }
    if (validos.some((i) => !(numero(i.cantidad) > 0) || !(numero(i.importe_unitario) >= 0))) {
      toast.error('Revisá los ítems: la cantidad tiene que ser mayor a cero y el precio no puede ser negativo.');
      return;
    }
    if (validos.some((i) => i.sospechoso) && !window.confirm('Hay renglones marcados como posible subtotal. ¿Guardar igual?')) return;
    setGuardando(true);
    try {
      const id = await crearContrato({
        tipo,
        contratista: contratista.trim(),
        contratista_cuit: oNull(cuit),
        obra_servicio: obra.trim(),
        emprendimiento: oNull(emprendimiento),
        ada_numero: oNull(ada),
        oc_numero: oNull(oc),
        fecha_inicio: oNull(inicio),
        fecha_fin: oNull(fin),
        plazo: oNull(plazo),
        condiciones_pago: oNull(condiciones),
        anticipo_pct: numero(anticipo) || 0,
        fondo_reparo_pct: numero(fondo) || 0,
        fondo_reparo_aplicar: aplicarFondo,
        ada_pdf_url: pdf?.path ?? null,
        items: validos.map((i) => ({
          descripcion: i.descripcion.trim(),
          um: i.um.trim() || 'u',
          cantidad: numero(i.cantidad),
          importe_unitario: numero(i.importe_unitario),
        })),
      });
      toast.success('Contrato creado.');
      onCreado(id);
    } catch (err) {
      toast.error(limpiarError(err));
      setGuardando(false);
    }
  }

  const ocupado = paso !== '';
  const soltar = (e: DragEvent) => {
    e.preventDefault();
    setArrastrando(false);
    if (!ocupado) leerPDF(e.dataTransfer.files[0]);
  };

  return (
    <form onSubmit={guardar} className="tarjeta space-y-5">
      <h2>Nuevo contrato</h2>

      <section className="space-y-3 rounded border bg-elevado/40 p-4" aria-label="Cargar desde el PDF">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primario" aria-hidden />
          <h3 className="font-semibold">Cargar desde el PDF del ADA u orden de compra</h3>
        </div>
        <p className="text-sm text-suave">
          La IA lee el PDF y completa el formulario. Nada se guarda hasta que lo revises y toques &quot;Guardar contrato&quot;.
        </p>
        <div className="grid gap-3 md:grid-cols-[14rem_1fr] md:items-end">
          <Selector etiqueta="Tipo de documento" value={tipoPDF} disabled={ocupado} onChange={(e) => setTipoPDF(e.target.value as typeof tipoPDF)}
            opciones={{ auto: 'Que lo detecte la IA', abono_mensual: 'Abono mensual', obra: 'Obra o presupuesto' }} />
          <label
            onDragOver={(e) => { e.preventDefault(); setArrastrando(true); }}
            onDragLeave={() => setArrastrando(false)}
            onDrop={soltar}
            className={`flex min-h-control cursor-pointer items-center justify-center gap-3 rounded border-2 border-dashed px-4 py-3 text-center ${arrastrando ? 'border-primario bg-primario/10' : 'border-borde'} ${ocupado ? 'cursor-wait opacity-70' : ''}`}
          >
            <input type="file" accept="application/pdf,.pdf" className="sr-only" disabled={ocupado}
              onChange={(e) => { leerPDF(e.target.files?.[0]); e.target.value = ''; }} />
            {ocupado ? (
              <span className="flex items-center gap-2 font-medium">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />
                {paso === 'subiendo' ? 'Subiendo el PDF…' : paso === 'leyendo' ? 'Leyendo el PDF (puede tardar hasta un minuto)…' : 'Corrigiendo los ítems…'}
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <Upload className="h-5 w-5" aria-hidden />
                Arrastrá el PDF acá o tocá para elegirlo
              </span>
            )}
          </label>
        </div>
        {pdf && (
          <p className="flex items-center gap-2 text-sm">
            <FileText className="h-4 w-4" aria-hidden /> {pdf.nombre}: queda guardado con el contrato.
          </p>
        )}
        {aviso && <p className="flex items-start gap-2 text-sm text-alerta"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{aviso}</p>}
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <Selector etiqueta="Tipo" value={tipo} onChange={(e) => setTipo(e.target.value as typeof tipo)} opciones={{ abono_mensual: 'Abono mensual', obra: 'Obra' }} />
        <Campo etiqueta="Contratista" required value={contratista} onChange={(e) => setContratista(e.target.value)} />
        <Campo etiqueta="Obra o servicio" required value={obra} onChange={(e) => setObra(e.target.value)} />
        <Campo etiqueta="Emprendimiento" value={emprendimiento} onChange={(e) => setEmprendimiento(e.target.value)} />
        <Campo etiqueta="CUIT del contratista" value={cuit} onChange={(e) => setCuit(e.target.value)} />
        <Campo etiqueta="N° de ADA" value={ada} onChange={(e) => setAda(e.target.value)} />
        <Campo etiqueta="N° de orden de compra" value={oc} onChange={(e) => setOc(e.target.value)} />
        <Campo etiqueta="Plazo" value={plazo} onChange={(e) => setPlazo(e.target.value)} />
        <Campo etiqueta="Inicio" type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} />
        <Campo etiqueta="Fin" type="date" value={fin} onChange={(e) => setFin(e.target.value)} />
        <Campo etiqueta="Anticipo a descontar (%)" inputMode="decimal" value={anticipo} onChange={(e) => setAnticipo(e.target.value)} />
        <Campo etiqueta="Fondo de reparo (%)" inputMode="decimal" value={fondo} onChange={(e) => setFondo(e.target.value)} />
      </div>
      <Area etiqueta="Condiciones de pago" value={condiciones} onChange={(e) => setCondiciones(e.target.value)} />
      <Casilla etiqueta="Descontar el fondo de reparo del total de cada certificado" checked={aplicarFondo} onChange={(e) => setAplicarFondo(e.target.checked)} />

      <fieldset className="space-y-3">
        <legend className="etiqueta">Ítems del contrato</legend>
        {items.map((i, n) => (
          <div key={i.clave} className={`grid grid-cols-2 gap-2 rounded border p-3 md:grid-cols-[1fr_6rem_8rem_10rem_auto] ${i.sospechoso ? 'border-alerta bg-alerta/10' : 'bg-elevado/40'}`}>
            {i.sospechoso && (
              <p className="col-span-2 flex items-center gap-2 text-sm text-alerta md:col-span-5">
                <AlertTriangle className="h-4 w-4" aria-hidden /> Parece un subtotal, no un ítem: si es así, quitalo.
              </p>
            )}
            <input className="control col-span-2 md:col-span-1" aria-label={`Descripción del ítem ${n + 1}`} placeholder={`Ítem ${n + 1}: descripción`} value={i.descripcion} onChange={(e) => cambiar(i.clave, 'descripcion', e.target.value)} />
            <input className="control" aria-label="Unidad" placeholder="Unidad" value={i.um} onChange={(e) => cambiar(i.clave, 'um', e.target.value)} />
            <input className="control num" aria-label="Cantidad" placeholder="Cantidad" inputMode="decimal" value={i.cantidad} onChange={(e) => cambiar(i.clave, 'cantidad', e.target.value)} />
            <input className="control num" aria-label="Precio unitario" placeholder="Precio unitario" inputMode="decimal" value={i.importe_unitario} onChange={(e) => cambiar(i.clave, 'importe_unitario', e.target.value)} />
            <Boton variante="fantasma" icono={Trash2} disabled={items.length === 1} onClick={() => setItems((a) => a.filter((x) => x.clave !== i.clave))}>
              Quitar
            </Boton>
          </div>
        ))}
        <Boton icono={Plus} onClick={() => setItems((a) => [...a, filaVacia()])}>
          Agregar ítem
        </Boton>
      </fieldset>

      <div className="space-y-2">
        <p className="text-lg">
          Monto contratado: <strong className="num">{fmtPesos(total)}</strong>
        </p>
        {totalDocumento !== null && (
          coincide ? (
            <p className="flex items-center gap-2 text-exito"><CheckCircle2 className="h-5 w-5" aria-hidden />Coincide con el total del PDF ({fmtPesos(totalDocumento)}).</p>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <p className="flex items-center gap-2 text-peligro">
                <AlertTriangle className="h-5 w-5" aria-hidden />
                El PDF dice {fmtPesos(totalDocumento)}: hay una diferencia de {fmtPesos(total - totalDocumento)}.
              </p>
              <Boton icono={Wand2} cargando={paso === 'corrigiendo'} disabled={ocupado} onClick={corregir}>Pedir a la IA que corrija los ítems</Boton>
            </div>
          )
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        <Boton type="submit" variante="primario" icono={Save} cargando={guardando} disabled={ocupado}>
          Guardar contrato
        </Boton>
        <Boton variante="fantasma" onClick={cancelar} disabled={guardando || ocupado}>
          Cancelar
        </Boton>
      </div>
    </form>
  );
}
