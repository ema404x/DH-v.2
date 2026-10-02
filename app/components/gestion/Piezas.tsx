'use client';

import { useRef, useState, type ReactNode } from 'react';
import { FileSpreadsheet, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Boton } from '../Boton';
import { limpiarError } from '@/lib/errores';

// Piezas chicas que comparten las pantallas de gestión.

export interface Pestana<T extends string> {
  id: T;
  texto: string;
  cuenta?: number;
  // resalta la cuenta cuando hay algo que atender
  alerta?: boolean;
}

export function Pestanas<T extends string>({ pestanas, activa, onCambio }: { pestanas: Pestana<T>[]; activa: T; onCambio: (id: T) => void }) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto overflow-y-hidden border-b">
      {pestanas.map((p) => (
        <button
          key={p.id}
          role="tab"
          type="button"
          aria-selected={p.id === activa}
          onClick={() => onCambio(p.id)}
          className={`-mb-px flex min-h-control shrink-0 items-center gap-2 border-b-2 px-4 text-sm font-medium transition-colors ${
            p.id === activa ? 'border-primario text-primario' : 'border-transparent text-suave hover:text-texto'
          }`}
        >
          {p.texto}
          {p.cuenta !== undefined && (
            <span className={`rounded px-1.5 text-xs ${p.alerta && p.cuenta > 0 ? 'bg-peligro/15 text-peligro' : 'bg-elevado text-suave'}`}>{p.cuenta}</span>
          )}
        </button>
      ))}
    </div>
  );
}

type Tono = 'neutro' | 'exito' | 'alerta' | 'peligro' | 'info';
const TONO: Record<Tono, string> = { neutro: 'text-suave', exito: 'text-exito', alerta: 'text-alerta', peligro: 'text-peligro', info: 'text-info' };

export function Indicador({ titulo, valor, icono: Icono, tono = 'neutro', nota }: { titulo: string; valor: ReactNode; icono: LucideIcon; tono?: Tono; nota?: string }) {
  return (
    <div className="tarjeta flex items-center gap-3">
      <Icono className={`h-8 w-8 shrink-0 ${TONO[tono]}`} aria-hidden />
      <div className="min-w-0">
        <p className="text-2xl font-bold">{valor}</p>
        <p className="text-sm text-suave">{titulo}</p>
        {nota && <p className="text-xs text-suave">{nota}</p>}
      </div>
    </div>
  );
}

export function Indicadores({ children }: { children: ReactNode }) {
  return <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</section>;
}

// Botón para elegir una planilla. `leer` la interpreta; si el formato no sirve, se muestra por qué.
export function ElegirExcel<T>({ texto, leer, onLeido }: { texto: string; leer: (archivo: File) => Promise<T>; onLeido: (datos: T, nombre: string) => void }) {
  const entrada = useRef<HTMLInputElement>(null);
  const [leyendo, setLeyendo] = useState(false);

  async function alElegir(archivo: File | undefined) {
    if (!archivo) return;
    setLeyendo(true);
    try {
      onLeido(await leer(archivo), archivo.name);
    } catch (e) {
      toast.error(limpiarError(e));
    } finally {
      setLeyendo(false);
      if (entrada.current) entrada.current.value = '';
    }
  }

  return (
    <>
      <input ref={entrada} type="file" accept=".xlsx" hidden onChange={(e) => alElegir(e.target.files?.[0])} />
      <Boton icono={FileSpreadsheet} cargando={leyendo} onClick={() => entrada.current?.click()}>
        {texto}
      </Boton>
    </>
  );
}

// Chips para filtrar por un valor (zona, estado). `null` = todos.
export function Chips<T extends string>({ opciones, valor, onCambio, todos = 'Todos' }: { opciones: { id: T; texto: string }[]; valor: T | null; onCambio: (v: T | null) => void; todos?: string }) {
  const clase = (activo: boolean) =>
    `min-h-control shrink-0 rounded border px-3 text-sm font-medium transition-colors ${activo ? 'border-primario bg-primario/15 text-primario' : 'bg-elevado text-suave hover:text-texto'}`;
  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" aria-pressed={valor === null} className={clase(valor === null)} onClick={() => onCambio(null)}>
        {todos}
      </button>
      {opciones.map((o) => (
        <button key={o.id} type="button" aria-pressed={valor === o.id} className={clase(valor === o.id)} onClick={() => onCambio(o.id)}>
          {o.texto}
        </button>
      ))}
    </div>
  );
}

// Descarga un CSV que Excel abre bien: con BOM, punto y coma, y comillas escapadas.
export function descargarCSV(nombre: string, encabezados: string[], filas: (string | number | null)[][]) {
  const celda = (v: string | number | null) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const texto = '﻿' + [encabezados, ...filas].map((f) => f.map(celda).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([texto], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  a.click();
  URL.revokeObjectURL(url);
}
