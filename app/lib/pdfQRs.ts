// QRs de lugares en cantidad, en PDF (= utils/exportLocationsQR.js + ExportarQRsDialog de la v1).
// Tarjetas de 2 columnas en A4 con el QR único de la v2 (<origen>/q?t=<token>), nombre, dirección y código SAP.
// "Todos los jefes" va en un solo PDF con un salto de página por jefe (la v1 bajaba un ZIP con un PDF por jefe).

import QRCode from 'qrcode';
import { supabase } from './supabase/client';
import { exigir } from './errores';
import { urlDeQR } from './qr';

export interface LugarQR {
  id: string;
  nombre: string;
  codigo: string | null;
  zona: string | null;
  qr_token: string;
  direccion: string | null;
  jefe: string;
}

const SIN_JEFE = 'Sin jefe asignado';

export async function listarLugaresQR(): Promise<LugarQR[]> {
  const filas = exigir(await supabase().from('ubicaciones')
    .select('id, nombre, codigo, zona, qr_token, direccion, jefe_sitio_nombre, direcciones(direccion, jefe_sitio_nombre)')
    .eq('activa', true).order('zona').order('nombre').limit(5000)) as unknown as {
      id: string; nombre: string; codigo: string | null; zona: string | null; qr_token: string; direccion: string | null;
      jefe_sitio_nombre: string | null; direcciones: { direccion: string | null; jefe_sitio_nombre: string | null } | null;
    }[];
  return filas.map((f) => ({
    id: f.id, nombre: f.nombre, codigo: f.codigo, zona: f.zona, qr_token: f.qr_token,
    direccion: f.direcciones?.direccion ?? f.direccion,
    jefe: (f.jefe_sitio_nombre ?? f.direcciones?.jefe_sitio_nombre ?? '').trim() || SIN_JEFE,
  }));
}

export async function exportarQRsPDF(lugares: LugarQR[], titulo: string): Promise<void> {
  if (!lugares.length) return;
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  const pageW = 210, pageH = 297, margin = 12, gap = 6, cols = 2;
  const cardW = (pageW - margin * 2 - gap) / cols, cardH = 62, qrSize = 42;
  const startY = margin + 20, lineH = cardH + gap;

  // Por jefe, en orden; cada jefe arranca en hoja nueva.
  const grupos = new Map<string, LugarQR[]>();
  for (const l of lugares) grupos.set(l.jefe, [...(grupos.get(l.jefe) ?? []), l]);

  let primera = true;
  for (const [jefe, lista] of [...grupos].sort((a, b) => (a[0] === SIN_JEFE ? 1 : b[0] === SIN_JEFE ? -1 : a[0].localeCompare(b[0])))) {
    const header = () => {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(15, 23, 42);
      doc.text('Códigos QR · Ubicaciones', margin, margin + 5);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(100, 116, 139);
      doc.text(`${titulo} · ${lista.length} ubicaciones · ${new Date().toLocaleDateString('es-AR')}`, margin, margin + 10);
      doc.setFontSize(8);
      doc.text(doc.splitTextToSize(`Jefe de sitio: ${jefe}`, pageW - margin * 2)[0], margin, margin + 14);
      doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.3);
      doc.line(margin, margin + 16, pageW - margin, margin + 16);
    };
    if (!primera) doc.addPage();
    primera = false;
    header();
    let y = startY, c = 0;
    for (const l of lista) {
      if (y + cardH > pageH - margin) { doc.addPage(); header(); y = startY; c = 0; }
      const x = margin + c * (cardW + gap);
      doc.setDrawColor(203, 213, 225); doc.setLineWidth(0.3);
      doc.roundedRect(x, y, cardW, cardH, 2.5, 2.5);
      const png = await QRCode.toDataURL(urlDeQR(l.qr_token), { width: 300, margin: 1, errorCorrectionLevel: 'M' });
      doc.addImage(png, 'PNG', x + 5, y + 10, qrSize, qrSize, undefined, 'FAST');
      const textX = x + qrSize + 11, textW = cardW - qrSize - 13;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(15, 23, 42);
      doc.text(doc.splitTextToSize(l.nombre, textW).slice(0, 3), textX, y + 14);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(100, 116, 139);
      const extra = [l.direccion, [l.zona ? `Comuna ${l.zona}` : null, l.codigo].filter(Boolean).join(' · ')].filter(Boolean).join('\n');
      if (extra) doc.text(doc.splitTextToSize(extra, textW).slice(0, 4), textX, y + 30);
      doc.setFontSize(7); doc.setTextColor(148, 163, 184);
      doc.text('Escanear para ver las OTs de la ubicación', x + 5, y + cardH - 4);
      c++;
      if (c >= cols) { c = 0; y += lineH; }
    }
  }
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p); doc.setFontSize(7); doc.setTextColor(148, 163, 184);
    doc.text(`DH1 · Página ${p} de ${total}`, pageW - margin, pageH - 6, { align: 'right' });
  }
  const nombre = titulo.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  doc.save(`qrs-${nombre || 'ubicaciones'}.pdf`);
}
