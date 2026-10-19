'use client';

import { useMemo, useState } from 'react';
import { FileDown, X } from 'lucide-react';
import { toast } from 'sonner';
import { Boton } from '@/components/Boton';
import { Selector } from '@/components/Campos';
import { ErrorVista, Esqueleto } from '@/components/Estados';
import { exportarQRsPDF, listarLugaresQR } from '@/lib/pdfQRs';
import { limpiarError } from '@/lib/errores';
import { useCarga } from '@/lib/useCarga';

// Exportar QRs en cantidad (ExportarQRsDialog de la v1): por jefe de sitio y por comuna, en un PDF para imprimir.
export function ExportarQRs({ onCerrar }: { onCerrar: () => void }) {
  const carga = useCarga(listarLugaresQR, []);
  const [jefe, setJefe] = useState('');
  const [zona, setZona] = useState('');
  const [generando, setGenerando] = useState(false);
  const lugares = carga.datos ?? [];

  const jefes = useMemo(() => {
    const n = new Map<string, number>();
    for (const l of lugares) if (!zona || l.zona === zona) n.set(l.jefe, (n.get(l.jefe) ?? 0) + 1);
    return [...n].sort((a, b) => a[0].localeCompare(b[0]));
  }, [lugares, zona]);
  const zonas = useMemo(() => [...new Set(lugares.map((l) => l.zona).filter(Boolean) as string[])].sort(), [lugares]);
  const elegidos = lugares.filter((l) => (!zona || l.zona === zona) && (!jefe || l.jefe === jefe));

  async function exportar() {
    setGenerando(true);
    try {
      const titulo = [zona ? `Comuna ${zona}` : 'Todas las comunas', jefe || null].filter(Boolean).join(' · ');
      await exportarQRsPDF(elegidos, titulo);
      toast.success(`PDF listo: ${elegidos.length} ${elegidos.length === 1 ? 'QR' : 'QRs'}.`);
    } catch (e) {
      toast.error(limpiarError(e));
    } finally {
      setGenerando(false);
    }
  }

  return (
    <section className="tarjeta space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2>Exportar QRs</h2>
          <p className="text-sm text-suave">Un PDF para imprimir con el QR de cada lugar. Con «todos los jefes», cada jefe arranca en hoja nueva.</p>
        </div>
        <Boton variante="fantasma" icono={X} onClick={onCerrar}>Cerrar</Boton>
      </div>
      {carga.cargando && !carga.datos ? <Esqueleto filas={2} /> : carga.error ? <ErrorVista mensaje={carga.error} onReintentar={carga.recargar} /> : (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            <Selector etiqueta="Comuna" value={zona} onChange={(e) => { setZona(e.target.value); setJefe(''); }}
              opciones={{ '': `Todas (${lugares.length})`, ...Object.fromEntries(zonas.map((z) => [z, `Comuna ${z} (${lugares.filter((l) => l.zona === z).length})`])) }} />
            <Selector etiqueta="Jefe de sitio" value={jefe} onChange={(e) => setJefe(e.target.value)}
              opciones={{ '': 'Todos los jefes', ...Object.fromEntries(jefes.map(([j, n]) => [j, `${j} (${n})`])) }} />
          </div>
          <Boton variante="primario" icono={FileDown} cargando={generando} disabled={elegidos.length === 0} onClick={exportar}>
            Bajar PDF con {elegidos.length} {elegidos.length === 1 ? 'QR' : 'QRs'}
          </Boton>
        </>
      )}
    </section>
  );
}
