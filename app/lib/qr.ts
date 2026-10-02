import QRCode from 'qrcode';
import { supabase } from './supabase/client';
import { exigir } from './errores';

// Un solo formato de QR para ubicaciones y activos: <origen>/q?t=<token opaco>.

export function urlDeQR(token: string): string {
  return `${window.location.origin}/q?t=${encodeURIComponent(token)}`;
}

// Saca el token de lo que leyó la cámara. Solo acepta el formato de DH1 v2.
export function tokenDeLectura(texto: string): string | null {
  const limpio = texto.trim();
  try {
    const url = new URL(limpio);
    const t = url.searchParams.get('t');
    return url.pathname === '/q' && t ? t : null;
  } catch {
    return /^[0-9a-f]{32}$/.test(limpio) ? limpio : null;
  }
}

export async function imagenDeQR(token: string): Promise<string> {
  return QRCode.toDataURL(urlDeQR(token), { width: 480, margin: 2, errorCorrectionLevel: 'M' });
}

export interface DestinoQR {
  tipo: 'ubicacion' | 'activo';
  id: string;
  nombre: string;
}

// La base resuelve el token con la RLS del usuario: un QR de otro sector "no existe".
export async function resolverQR(token: string): Promise<DestinoQR> {
  return exigir(await supabase().rpc('resolver_qr', { p_token: token })) as DestinoQR;
}
