'use client';

import { useState, type FormEvent } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Boton } from '../Boton';
import { Campo, Casilla, Selector, oNull } from '../Campos';
import { crearContrato, fmtPesos } from '@/lib/certificacion';
import { limpiarError } from '@/lib/errores';

interface Fila {
  clave: string;
  descripcion: string;
  um: string;
  cantidad: string;
  importe_unitario: string;
}

const filaVacia = (): Fila => ({ clave: crypto.randomUUID(), descripcion: '', um: 'u', cantidad: '', importe_unitario: '' });
const numero = (v: string) => Number(v.replace(',', '.'));

// Alta de un contrato con sus ítems. El monto contratado no se carga: es la suma de los ítems
// y lo calcula la base.
export function FormContrato({ onCreado, onCancelar }: { onCreado: (id: string) => void; onCancelar: () => void }) {
  const [tipo, setTipo] = useState<'abono_mensual' | 'obra'>('abono_mensual');
  const [contratista, setContratista] = useState('');
  const [cuit, setCuit] = useState('');
  const [obra, setObra] = useState('');
  const [ada, setAda] = useState('');
  const [oc, setOc] = useState('');
  const [inicio, setInicio] = useState('');
  const [fin, setFin] = useState('');
  const [anticipo, setAnticipo] = useState('0');
  const [fondo, setFondo] = useState('5');
  const [aplicarFondo, setAplicarFondo] = useState(false);
  const [items, setItems] = useState<Fila[]>([filaVacia()]);
  const [guardando, setGuardando] = useState(false);

  const total = items.reduce((t, i) => t + (numero(i.cantidad) || 0) * (numero(i.importe_unitario) || 0), 0);
  const cambiar = (clave: string, campo: keyof Fila, valor: string) =>
    setItems((actual) => actual.map((i) => (i.clave === clave ? { ...i, [campo]: valor } : i)));

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
    setGuardando(true);
    try {
      const id = await crearContrato({
        tipo,
        contratista: contratista.trim(),
        contratista_cuit: oNull(cuit),
        obra_servicio: obra.trim(),
        ada_numero: oNull(ada),
        oc_numero: oNull(oc),
        fecha_inicio: oNull(inicio),
        fecha_fin: oNull(fin),
        anticipo_pct: numero(anticipo) || 0,
        fondo_reparo_pct: numero(fondo) || 0,
        fondo_reparo_aplicar: aplicarFondo,
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

  return (
    <form onSubmit={guardar} className="tarjeta space-y-5">
      <h2>Nuevo contrato</h2>

      <div className="grid gap-4 md:grid-cols-2">
        <Selector etiqueta="Tipo" value={tipo} onChange={(e) => setTipo(e.target.value as typeof tipo)} opciones={{ abono_mensual: 'Abono mensual', obra: 'Obra' }} />
        <Campo etiqueta="Contratista" required value={contratista} onChange={(e) => setContratista(e.target.value)} />
        <Campo etiqueta="Obra o servicio" required value={obra} onChange={(e) => setObra(e.target.value)} />
        <Campo etiqueta="CUIT del contratista" value={cuit} onChange={(e) => setCuit(e.target.value)} />
        <Campo etiqueta="N° de ADA" value={ada} onChange={(e) => setAda(e.target.value)} />
        <Campo etiqueta="N° de orden de compra" value={oc} onChange={(e) => setOc(e.target.value)} />
        <Campo etiqueta="Inicio" type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} />
        <Campo etiqueta="Fin" type="date" value={fin} onChange={(e) => setFin(e.target.value)} />
        <Campo etiqueta="Anticipo a descontar (%)" inputMode="decimal" value={anticipo} onChange={(e) => setAnticipo(e.target.value)} />
        <Campo etiqueta="Fondo de reparo (%)" inputMode="decimal" value={fondo} onChange={(e) => setFondo(e.target.value)} />
      </div>
      <Casilla etiqueta="Descontar el fondo de reparo del total de cada certificado" checked={aplicarFondo} onChange={(e) => setAplicarFondo(e.target.checked)} />

      <fieldset className="space-y-3">
        <legend className="etiqueta">Ítems del contrato</legend>
        {items.map((i, n) => (
          <div key={i.clave} className="grid grid-cols-2 gap-2 rounded border bg-elevado/40 p-3 md:grid-cols-[1fr_6rem_8rem_10rem_auto]">
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

      <p className="text-lg">
        Monto contratado: <strong className="num">{fmtPesos(total)}</strong>
      </p>

      <div className="flex flex-wrap gap-3">
        <Boton type="submit" variante="primario" icono={Save} cargando={guardando}>
          Guardar contrato
        </Boton>
        <Boton variante="fantasma" onClick={onCancelar} disabled={guardando}>
          Cancelar
        </Boton>
      </div>
    </form>
  );
}
