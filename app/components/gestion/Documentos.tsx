'use client';

import { useRef, useState } from 'react';
import { FileText, Paperclip, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Boton } from '../Boton';
import { abrirDocumento, borrarArchivo, fmtTamano, subirDocumento, type Documento } from '@/lib/obras';
import { limpiarError } from '@/lib/errores';

const LIMITE = 25 * 1024 * 1024;

// Lista de documentos de un registro (obra, solicitud). Sube al bucket privado y avisa la lista nueva;
// quien la usa la guarda en la base. Si guardar falla, el archivo recién subido se borra.
export function Documentos({ sectorId, carpeta, documentos, puedeEditar, onCambio }: {
  sectorId: string;
  carpeta: string;
  documentos: Documento[];
  puedeEditar: boolean;
  onCambio: (docs: Documento[]) => Promise<void>;
}) {
  const entrada = useRef<HTMLInputElement>(null);
  const [subiendo, setSubiendo] = useState(false);

  async function subir(archivos: FileList | null) {
    if (!archivos?.length) return;
    const grandes = [...archivos].filter((a) => a.size > LIMITE);
    if (grandes.length) {
      toast.error(`${grandes.map((a) => a.name).join(', ')}: pasa de 25 MB.`);
      return;
    }
    setSubiendo(true);
    const nuevos: Documento[] = [];
    try {
      for (const a of archivos) nuevos.push(await subirDocumento(sectorId, carpeta, a));
      await onCambio([...documentos, ...nuevos]);
      toast.success(nuevos.length === 1 ? 'Documento agregado.' : `${nuevos.length} documentos agregados.`);
    } catch (e) {
      await Promise.all(nuevos.map((d) => borrarArchivo(d.path)));
      toast.error(limpiarError(e));
    } finally {
      setSubiendo(false);
      if (entrada.current) entrada.current.value = '';
    }
  }

  async function quitar(d: Documento) {
    if (!window.confirm(`¿Quitar "${d.nombre}"?`)) return;
    try {
      await onCambio(documentos.filter((x) => x.path !== d.path));
      await borrarArchivo(d.path);
    } catch (e) {
      toast.error(limpiarError(e));
    }
  }

  return (
    <div className="space-y-3">
      {documentos.length === 0 ? (
        <p className="text-suave">Sin documentos.</p>
      ) : (
        <ul className="divide-y rounded border">
          {documentos.map((d) => (
            <li key={d.path} className="flex items-center gap-3 px-3 py-2">
              <FileText className="h-5 w-5 shrink-0 text-suave" aria-hidden />
              <button type="button" className="min-h-control min-w-0 flex-1 truncate text-left text-primario hover:underline"
                onClick={() => abrirDocumento(d.path).catch((e) => toast.error(limpiarError(e)))}>
                {d.nombre}
              </button>
              <span className="shrink-0 text-xs text-suave">{fmtTamano(d.tamano)}</span>
              {puedeEditar && (
                <button type="button" className="flex min-h-control min-w-control items-center justify-center rounded text-suave hover:bg-elevado hover:text-peligro"
                  aria-label={`Quitar ${d.nombre}`} onClick={() => quitar(d)}>
                  <Trash2 className="h-5 w-5" aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {puedeEditar && (
        <>
          <input ref={entrada} type="file" multiple hidden onChange={(e) => subir(e.target.files)} />
          <Boton icono={Paperclip} cargando={subiendo} onClick={() => entrada.current?.click()}>Agregar documentos</Boton>
        </>
      )}
    </div>
  );
}
