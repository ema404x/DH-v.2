'use client';

import { useState, type FormEvent } from 'react';
import { Package, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Boton } from './Boton';
import { Campo, Casilla } from './Campos';
import { BuscadorRemoto } from './gestion/BuscadorRemoto';
import { limpiarError } from '@/lib/errores';
import { cant, cargarMaterialOT, materialesDeOT, quitarMaterialOT } from '@/lib/panol';
import { useCarga } from '@/lib/useCarga';
import { useSesion } from '@/lib/sesion';
import type { ResultadoBusqueda } from '@/lib/types';

const pesos = (n: number) => n.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });

// Materiales usados en una orden. Cualquiera los anota; gerencia y los jefes de sitio pueden además sacarlos del pañol
// (descuenta stock). Quitar uno que salió del pañol lo devuelve al stock. Necesita conexión.
export function MaterialesOT({ otId }: { otId: string }) {
  const { perfil, puedeValidar } = useSesion();
  const carga = useCarga(() => materialesDeOT(otId), [otId]);
  const [agregando, setAgregando] = useState(false);
  const [material, setMaterial] = useState<ResultadoBusqueda | null>(null);
  const [descripcion, setDescripcion] = useState('');
  const [cantidad, setCantidad] = useState('1');
  const [costo, setCosto] = useState('');
  const [descontar, setDescontar] = useState(true);
  const [guardando, setGuardando] = useState(false);

  const filas = carga.datos ?? [];
  const total = filas.reduce((t, m) => t + Number(m.total), 0);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    const n = Number(cantidad.replace(',', '.'));
    if (!material && !descripcion.trim()) {
      toast.error('Elegí un material del pañol o escribí cuál fue.');
      return;
    }
    if (!(n > 0)) {
      toast.error('La cantidad tiene que ser mayor a cero.');
      return;
    }
    setGuardando(true);
    try {
      await cargarMaterialOT({
        ot_id: otId, material_id: material?.id ?? null, descripcion: material ? '' : descripcion.trim(), cantidad: n,
        costo_unitario: costo.trim() ? Number(costo.replace(/\./g, '').replace(',', '.')) || 0 : 0, descontar: !!material && puedeValidar && descontar,
      });
      toast.success(material && puedeValidar && descontar ? 'Material cargado y descontado del pañol.' : 'Material anotado.');
      setAgregando(false); setMaterial(null); setDescripcion(''); setCantidad('1'); setCosto('');
      await carga.recargar();
    } catch (err) {
      toast.error(limpiarError(err));
    } finally {
      setGuardando(false);
    }
  }

  async function quitar(id: string, delPanol: boolean) {
    if (delPanol && !window.confirm('Salió del pañol: al quitarlo vuelve al stock. ¿Seguir?')) return;
    try {
      await quitarMaterialOT(id);
      await carga.recargar();
    } catch (e) {
      toast.error(limpiarError(e));
    }
  }

  if (carga.error) return null;

  return (
    <section className="tarjeta space-y-3" aria-label="Materiales usados">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2"><Package className="h-5 w-5" aria-hidden />Materiales</h2>
        {filas.length > 0 && total > 0 && <p className="text-sm text-suave">{pesos(total)}</p>}
      </div>

      {filas.length === 0 && !agregando && <p className="text-suave">{carga.cargando ? 'Cargando' : 'Todavía no se cargaron materiales en esta orden.'}</p>}
      {filas.length > 0 && (
        <ul className="divide-y">
          {filas.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <p className="font-medium">{m.descripcion}</p>
                <p className="text-sm text-suave">{[m.descontar ? 'salió del pañol' : 'anotado', m.cargado_por_nombre].filter(Boolean).join(' · ')}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="num font-semibold">{cant(m.cantidad, m.unidad)}</span>
                {(puedeValidar || (m.created_by === perfil?.id && !m.descontar)) && (
                  <button type="button" onClick={() => quitar(m.id, m.descontar)} aria-label={`Quitar ${m.descripcion}`}
                    className="flex h-11 w-11 items-center justify-center rounded text-suave hover:bg-elevado hover:text-peligro">
                    <Trash2 className="h-5 w-5" aria-hidden />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {agregando ? (
        <form onSubmit={guardar} className="space-y-3 rounded border bg-elevado/40 p-3">
          <BuscadorRemoto etiqueta="Material del pañol" tabla="materiales" valor={material} onCambio={setMaterial} />
          {!material && <Campo etiqueta="O cuál fue (si no es del pañol)" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />}
          <div className="grid grid-cols-2 gap-3">
            <Campo etiqueta="Cantidad" inputMode="decimal" required value={cantidad} onChange={(e) => setCantidad(e.target.value)} />
            {!material && <Campo etiqueta="Costo unitario (opcional)" inputMode="decimal" value={costo} onChange={(e) => setCosto(e.target.value)} />}
          </div>
          {material && puedeValidar && <Casilla etiqueta="Sale del pañol (descuenta el stock)" checked={descontar} onChange={(e) => setDescontar(e.target.checked)} />}
          {material && !puedeValidar && <p className="text-sm text-suave">Queda anotado. El jefe de sitio lo descuenta del pañol.</p>}
          <div className="flex flex-wrap gap-2">
            <Boton type="submit" icono={Plus} cargando={guardando}>Cargar material</Boton>
            <Boton variante="fantasma" onClick={() => setAgregando(false)} disabled={guardando}>Cancelar</Boton>
          </div>
        </form>
      ) : (
        <Boton icono={Plus} onClick={() => setAgregando(true)}>Cargar material</Boton>
      )}
    </section>
  );
}
