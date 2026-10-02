'use client';

import { useEffect, useState } from 'react';
import { Printer } from 'lucide-react';
import { Boton } from '../Boton';
import { imagenDeQR } from '@/lib/qr';

interface Props {
  token: string;
  titulo: string;
  subtitulo?: string | null;
}

// Etiqueta con el QR de una ubicación o de un activo, lista para imprimir y pegar.
export function QRImprimible({ token, titulo, subtitulo }: Props) {
  const [imagen, setImagen] = useState<string | null>(null);
  const [fallo, setFallo] = useState(false);

  useEffect(() => {
    let vigente = true;
    setImagen(null);
    setFallo(false);
    imagenDeQR(token)
      .then((d) => vigente && setImagen(d))
      .catch(() => vigente && setFallo(true));
    return () => {
      vigente = false;
    };
  }, [token]);

  function imprimir() {
    if (!imagen) return;
    const v = window.open('', '_blank', 'width=420,height=560');
    if (!v) return;
    const doc = v.document;
    doc.title = `QR ${titulo}`;
    const caja = doc.createElement('div');
    caja.style.cssText = 'font-family:system-ui,sans-serif;text-align:center;padding:24px';
    const img = doc.createElement('img');
    img.src = imagen;
    img.style.width = '320px';
    const h = doc.createElement('h1');
    h.textContent = titulo;
    h.style.cssText = 'font-size:22px;margin:12px 0 4px';
    const p = doc.createElement('p');
    p.textContent = subtitulo ?? '';
    p.style.cssText = 'font-size:16px;margin:0';
    caja.append(img, h, p);
    doc.body.append(caja);
    img.onload = () => {
      v.print();
      v.close();
    };
  }

  return (
    <div className="flex flex-col items-center gap-3">
      {fallo ? (
        <p className="text-peligro">No se pudo generar el QR.</p>
      ) : imagen ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imagen} alt={`Código QR de ${titulo}`} className="h-48 w-48 rounded bg-papel p-2" />
      ) : (
        <div className="esqueleto h-48 w-48" role="status" aria-label="Generando QR" />
      )}
      <Boton icono={Printer} onClick={imprimir} disabled={!imagen}>
        Imprimir QR
      </Boton>
    </div>
  );
}
