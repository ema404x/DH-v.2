'use client';

import { useEffect, useRef, useState } from 'react';
import { Eraser } from 'lucide-react';
import { Boton } from './Boton';

// Firma con el dedo, el lápiz o el mouse. Devuelve un PNG (data URL) recortado al trazo, o null si está vacía.
export function FirmaCanvas({ onCambio, inicial }: { onCambio: (png: string | null) => void; inicial?: string | null }) {
  const lienzo = useRef<HTMLCanvasElement>(null);
  const dibujando = useRef(false);
  const ultimo = useRef<{ x: number; y: number } | null>(null);
  const [vacia, setVacia] = useState(!inicial);

  useEffect(() => {
    const c = lienzo.current;
    if (!c) return;
    const escala = window.devicePixelRatio || 1;
    c.width = c.offsetWidth * escala;
    c.height = c.offsetHeight * escala;
    const ctx = c.getContext('2d')!;
    ctx.scale(escala, escala);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#111827';
    if (inicial) {
      const img = new Image();
      img.onload = () => {
        const r = Math.min(c.offsetWidth / img.width, c.offsetHeight / img.height, 1);
        ctx.drawImage(img, (c.offsetWidth - img.width * r) / 2, (c.offsetHeight - img.height * r) / 2, img.width * r, img.height * r);
      };
      img.src = inicial;
    }
  }, [inicial]);

  const punto = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  function exportar() {
    const c = lienzo.current!;
    const ctx = c.getContext('2d')!;
    const { width, height } = c;
    const datos = ctx.getImageData(0, 0, width, height).data;
    let x0 = width, y0 = height, x1 = -1, y1 = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (datos[(y * width + x) * 4 + 3] > 0) {
          if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) { onCambio(null); return; }
    const m = 8;
    const recorte = document.createElement('canvas');
    recorte.width = x1 - x0 + 2 * m;
    recorte.height = y1 - y0 + 2 * m;
    recorte.getContext('2d')!.drawImage(c, x0 - m, y0 - m, recorte.width, recorte.height, 0, 0, recorte.width, recorte.height);
    onCambio(recorte.toDataURL('image/png'));
  }

  function borrar() {
    const c = lienzo.current!;
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
    setVacia(true);
    onCambio(null);
  }

  return (
    <div className="space-y-2">
      <canvas
        ref={lienzo}
        aria-label="Espacio para firmar"
        className="h-40 w-full touch-none rounded border border-dashed bg-white"
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); dibujando.current = true; ultimo.current = punto(e); }}
        onPointerMove={(e) => {
          if (!dibujando.current || !ultimo.current) return;
          const p = punto(e);
          const ctx = e.currentTarget.getContext('2d')!;
          ctx.beginPath();
          ctx.moveTo(ultimo.current.x, ultimo.current.y);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
          ultimo.current = p;
          setVacia(false);
        }}
        onPointerUp={() => { if (dibujando.current) { dibujando.current = false; ultimo.current = null; exportar(); } }}
        onPointerCancel={() => { dibujando.current = false; ultimo.current = null; }}
      />
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-suave">{vacia ? 'Firmá dentro del recuadro.' : 'Listo. Si no quedó bien, borrá y firmá de nuevo.'}</p>
        <Boton variante="fantasma" icono={Eraser} onClick={borrar}>Borrar</Boton>
      </div>
    </div>
  );
}
