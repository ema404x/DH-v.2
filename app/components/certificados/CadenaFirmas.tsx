'use client';

import { useState } from 'react';
import { DragDropContext, Draggable, Droppable, type DropResult } from '@hello-pangea/dnd';
import { CheckCircle2, GripVertical, PenTool, Search, X } from 'lucide-react';
import { listarPosiblesFirmantes } from '@/lib/certificados';
import { useCarga } from '@/lib/useCarga';

// Cadena de firmas del borrador (CadenaFirmasPanel de la v1): firmantes en orden (arrastrar para ordenar) elegidos
// entre los usuarios del sector. Sin cadena, el certificado va directo a aprobación gerencial.
export function CadenaFirmas({ value, onChange, deshabilitado }: { value: string[]; onChange: (v: string[]) => void; deshabilitado?: boolean }) {
  const [search, setSearch] = useState('');
  const carga = useCarga(listarPosiblesFirmantes, []);
  const perfiles = carga.datos ?? [];
  const porId = new Map(perfiles.map((p) => [p.id, p]));
  const q = search.toLowerCase();
  const disponibles = perfiles
    .filter((p) => !value.includes(p.id))
    .filter((p) => !search || p.nombre.toLowerCase().includes(q) || p.email.toLowerCase().includes(q));

  const onDragEnd = (r: DropResult) => {
    if (!r.destination) return;
    const v = [...value];
    const [m] = v.splice(r.source.index, 1);
    v.splice(r.destination.index, 0, m);
    onChange(v);
  };

  return (
    <div className="space-y-4 rounded-lg border border-dashed border-primario/30 bg-superficie p-5">
      <div className="flex items-center gap-2">
        <PenTool className="h-4 w-4 text-primario" aria-hidden />
        <h3 className="text-sm font-semibold uppercase tracking-wide">Cadena de Firmas</h3>
        <span className="ml-auto text-xs text-suave">Firma secuencial · {value.length} firmante(s)</span>
      </div>

      {value.length === 0 && (
        <p className="text-xs italic text-suave">
          Sin cadena: el certificado va directo a aprobación gerencial. Agregá firmantes para que revisen y firmen antes de llegar al gerente.
        </p>
      )}

      {value.length > 0 && (
        <DragDropContext onDragEnd={onDragEnd}>
          <Droppable droppableId="cadena-firmas">
            {(provided) => (
              <div ref={provided.innerRef} {...provided.droppableProps} className="space-y-2">
                {value.map((id, idx) => {
                  const p = porId.get(id);
                  const nombre = p?.nombre ?? 'Usuario';
                  return (
                    <Draggable key={id} draggableId={`firmante-${id}`} index={idx} isDragDisabled={deshabilitado}>
                      {(prov) => (
                        <div ref={prov.innerRef} {...prov.draggableProps}
                          className="flex items-center gap-3 rounded-lg border bg-elevado/40 p-3 transition-colors hover:border-primario/30">
                          <div {...prov.dragHandleProps} className="cursor-grab text-suave active:cursor-grabbing" aria-label="Arrastrar para ordenar"><GripVertical className="h-4 w-4" aria-hidden /></div>
                          <span className="w-5 text-center text-xs font-bold text-suave">{idx + 1}°</span>
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primario/15"><span className="text-xs font-bold text-primario">{nombre.charAt(0).toUpperCase()}</span></div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{nombre}</p>
                            <p className="truncate text-xs text-suave">{p?.email ?? ''}</p>
                          </div>
                          {p?.firma_url
                            ? <span className="flex shrink-0 items-center gap-1 text-xs text-exito"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Firma</span>
                            : <span className="shrink-0 text-xs text-alerta">Sin firma</span>}
                          {!deshabilitado && (
                            <button type="button" onClick={() => onChange(value.filter((x) => x !== id))} aria-label={`Quitar a ${nombre}`}
                              className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-peligro hover:bg-peligro/10"><X className="h-4 w-4" aria-hidden /></button>
                          )}
                        </div>
                      )}
                    </Draggable>
                  );
                })}
                {provided.placeholder}
              </div>
            )}
          </Droppable>
        </DragDropContext>
      )}

      {!deshabilitado && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-suave" aria-hidden />
          <input className="control w-full pl-9" placeholder="Buscar usuario para agregar..." value={search} onChange={(e) => setSearch(e.target.value)}
            disabled={carga.cargando} aria-label="Buscar usuario para agregar a la cadena" />
          {search && disponibles.length > 0 && (
            <div className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border bg-superficie shadow-lg">
              {disponibles.slice(0, 8).map((p) => (
                <button key={p.id} type="button" onClick={() => { onChange([...value, p.id]); setSearch(''); }}
                  className="flex min-h-control w-full items-center gap-3 p-2.5 text-left hover:bg-elevado">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primario/15"><span className="text-xs font-bold text-primario">{p.nombre.charAt(0).toUpperCase()}</span></div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{p.nombre}</p>
                    <p className="truncate text-xs text-suave">{p.email}</p>
                  </div>
                  {p.firma_url && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-exito" aria-hidden />}
                </button>
              ))}
            </div>
          )}
          {search && disponibles.length === 0 && !carga.cargando && (
            <div className="absolute z-20 mt-1 w-full rounded-lg border bg-superficie p-3 text-center text-xs text-suave shadow-lg">No se encontraron usuarios con ese nombre o email</div>
          )}
        </div>
      )}
    </div>
  );
}
