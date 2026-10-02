'use client';

import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { X } from 'lucide-react';
import { Boton } from './Boton';
import { tokenDeLectura } from '@/lib/qr';

interface Props {
  onToken: (token: string) => void;
  onCerrar: () => void;
}

// Lector de QR con la cámara trasera. Lee cuadros a baja resolución (alcanza para un QR
// y no calienta el teléfono) y corta la cámara apenas encuentra un código de DH1.
export function ScannerModal({ onToken, onCerrar }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const [aviso, setAviso] = useState('Apuntá la cámara al código QR.');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let activo = true;
    let flujo: MediaStream | null = null;
    let cuadro = 0;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    function leer() {
      const v = video.current;
      if (!activo || !v || !ctx) return;
      if (v.readyState === v.HAVE_ENOUGH_DATA && v.videoWidth > 0) {
        const escala = Math.min(1, 640 / v.videoWidth);
        canvas.width = Math.round(v.videoWidth * escala);
        canvas.height = Math.round(v.videoHeight * escala);
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const codigo = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
        if (codigo?.data) {
          const token = tokenDeLectura(codigo.data);
          if (token) {
            activo = false;
            onToken(token);
            return;
          }
          setAviso('Ese código no es de DH1. Buscá el QR de la ubicación o del equipo.');
        }
      }
      cuadro = requestAnimationFrame(leer);
    }

    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      .then((s) => {
        if (!activo) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        flujo = s;
        if (video.current) {
          video.current.srcObject = s;
          void video.current.play();
        }
        cuadro = requestAnimationFrame(leer);
      })
      .catch(() => setError('No se pudo abrir la cámara. Revisá que el navegador tenga permiso para usarla.'));

    if (!navigator.mediaDevices) {
      setError('Este navegador no permite usar la cámara.');
    }

    return () => {
      activo = false;
      cancelAnimationFrame(cuadro);
      flujo?.getTracks().forEach((t) => t.stop());
      canvas.width = 0;
      canvas.height = 0;
    };
  }, [onToken]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-fondo" role="dialog" aria-modal="true" aria-label="Escanear código QR">
      <div className="flex items-center justify-between gap-3 p-4">
        <h2>Escanear QR</h2>
        <Boton variante="fantasma" icono={X} onClick={onCerrar}>
          Cerrar
        </Boton>
      </div>
      <div className="relative flex-1 overflow-hidden">
        <video ref={video} playsInline muted className="h-full w-full object-cover" />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-64 w-64 rounded-lg border-4 border-primario" />
        </div>
      </div>
      <p className={`p-4 text-center ${error ? 'text-peligro' : 'text-suave'}`} role="status">
        {error ?? aviso}
      </p>
    </div>
  );
}
