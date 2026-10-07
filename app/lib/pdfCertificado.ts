// PDF del certificado: el mismo formato que la v1 (utils/exportCertificadoPDF.js de Base44): A4 apaisado, franja
// con el logo de Mejores, datos del contrato, la tabla de 14 columnas con la medición, totales y firmas.
// La diferencia: los montos (anticipo, fondo de reparo, total neto) son los que calculó la base, no los del navegador.

export interface ItemPDF {
  numero: number;
  descripcion: string;
  um: string;
  cantidad: number;
  importe_unitario: number;
  importe_total: number;
  med_acum_anterior_unidad: number;
  med_acum_anterior_importe: number;
  med_presente_unidad: number;
  med_presente_importe: number;
  med_acum_presente_unidad: number;
  med_acum_presente_importe: number;
  saldo_pendiente_unidad: number;
  saldo_pendiente_importe: number;
}

export interface DatosPDF {
  numero: number | string;
  tipo: string;
  estado: string;
  fecha_certificado: string | null;
  emprendimiento: string | null;
  obra_servicio: string | null;
  contratista: string | null;
  base: string | null;
  ada_numero: string | null;
  oc_numero: string | null;
  mes_periodo: string | null;
  fecha_inicio: string | null;
  plazo_obra: string | null;
  fecha_finalizacion: string | null;
  monto_contratado: number;
  items: ItemPDF[];
  anticipo_pct: number;
  anticipo_monto: number;
  anticipo_fijo: boolean;
  fondo_reparo_pct: number;
  fondo_reparo_monto: number;
  fondo_reparo_fijo: boolean;
  fondo_reparo_label: string | null;
  firma_jefe_url: string | null;
  firmado_por_jefe: string | null;
  fecha_firma_jefe: string | null;
  firma_gerente_url: string | null;
  aprobado_por: string | null;
  fecha_aprobacion: string | null;
}

const LOGO = '/certificados/mejores-logo.jpg';

// Con centavos, como el PDF que genera hoy la v1 ("$ 60.165,28", "24.710,74").
const r0 = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100;
const fmt = (n: unknown) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(r0(n));
const fmtC = (v: unknown) => { const n = r0(v); return n === 0 ? '0' : n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
const fmtU = (v: unknown) => { const n = r0(v); return n ? (Number.isInteger(n) ? String(n) : n.toLocaleString('es-AR', { maximumFractionDigits: 2 })) : ''; };
const fmtDate = (d: string | null) => { if (!d) return '—'; const [y, m, day] = d.slice(0, 10).split('-'); return y && m && day ? `${day}/${m}/${y}` : d; };

// Hay medición si algún ítem certifica distinto de su total (igual que la v1).
export const tieneMedicion = (items: ItemPDF[]) => items.some((it) => r0(it.med_presente_importe) !== r0(it.importe_total) || r0(it.med_acum_anterior_importe) > 0);

async function aBase64(url: string): Promise<string | null> {
  if (url.startsWith('data:')) return url;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((ok) => { const fr = new FileReader(); fr.onloadend = () => ok(fr.result as string); fr.readAsDataURL(blob); });
  } catch {
    return null;
  }
}

function dimensiones(base64: string): Promise<{ w: number; h: number } | null> {
  return new Promise((ok) => { const img = new Image(); img.onload = () => ok({ w: img.naturalWidth, h: img.naturalHeight }); img.onerror = () => ok(null); img.src = base64; });
}

export async function descargarPDFCertificado(form: DatosPDF): Promise<void> {
  const { default: jsPDF } = await import('jspdf');
  const items = form.items;
  const hasMedicion = tieneMedicion(items);
  const subtotalContrato = r0(items.reduce((a, it) => a + r0(it.importe_total), 0));
  const totalPresente = hasMedicion ? r0(items.reduce((a, it) => a + r0(it.med_presente_importe), 0)) : 0;
  const totalSaldo = hasMedicion ? Math.max(0, subtotalContrato - totalPresente) : 0;
  const pdfSubtotal = hasMedicion ? totalPresente : subtotalContrato;
  const pdfAnticipo = r0(form.anticipo_monto);
  const pdfFondoReparo = r0(form.fondo_reparo_monto);
  const pdfTotalNeto = pdfSubtotal - pdfAnticipo - pdfFondoReparo;
  const montoContratado = r0(form.monto_contratado);

  const [logoBase64, firmaBase64, firmaJefeBase64] = await Promise.all([
    aBase64(LOGO),
    form.firma_gerente_url ? aBase64(form.firma_gerente_url) : Promise.resolve(null),
    form.firma_jefe_url ? aBase64(form.firma_jefe_url) : Promise.resolve(null),
  ]);

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const W = 297, H = 210, M = 10, C = W - M * 2;
  const FOOTER_H = 10;
  const SAFE_BOTTOM = H - FOOTER_H - 5;

  const drawPageHeader = () => {
    doc.setFillColor(15, 28, 46);
    doc.rect(0, 0, W, 22, 'F');
    if (logoBase64) {
      doc.addImage(logoBase64, 'JPEG', M, 1.5, 46, 18);
    } else {
      doc.setTextColor(255, 255, 255); doc.setFontSize(13); doc.setFont('helvetica', 'bold');
      doc.text('MEJORES', M, 12);
    }
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(12); doc.setFont('helvetica', 'bold');
    doc.text(`CERTIFICADO N° ${form.numero}`, W - M, 10, { align: 'right' });
    doc.setFontSize(7.5); doc.setFont('helvetica', 'normal');
    doc.text(`${form.tipo === 'abono_mensual' ? 'ABONO MENSUAL' : 'OBRA'} · ${fmtDate(form.fecha_certificado)}`, W - M, 17, { align: 'right' });
  };

  const drawFooter = (pageNum: number, totalPages: number | string) => {
    doc.setFillColor(15, 28, 46);
    doc.rect(0, H - FOOTER_H, W, FOOTER_H, 'F');
    doc.setTextColor(255, 255, 255); doc.setFontSize(6.5); doc.setFont('helvetica', 'normal');
    doc.text('Av. Córdoba 1351 1°Piso · (C1055AAD) CABA · Tel 4816-0111 · www.mejores.ar', M, H - 3.5);
    doc.text(`CERT N° ${form.numero} · Pág ${pageNum}/${totalPages}`, W - M, H - 3.5, { align: 'right' });
  };

  const TABLE_COLS = (() => {
    const withoutDesc = [
      { label: 'N°', align: 'right', w: 6 },
      { label: 'UM', align: 'left', w: 7 },
      { label: 'CANT.', align: 'right', w: 9 },
      { label: 'IMP.UNIT.', align: 'right', w: 23 },
      { label: 'IMP.TOT.', align: 'right', w: 23 },
      { label: 'A.A.', align: 'right', w: 7 },
      { label: 'A.ANT$', align: 'right', w: 23 },
      { label: 'PR.', align: 'right', w: 7 },
      { label: 'PRES.$', align: 'right', w: 23 },
      { label: 'A.P.', align: 'right', w: 7 },
      { label: 'A.PR.$', align: 'right', w: 23 },
      { label: 'SA.', align: 'right', w: 7 },
      { label: 'SALDO$', align: 'right', w: 23 },
    ];
    const fixedTotal = withoutDesc.reduce((s, d) => s + d.w, 0);
    const allDefs = [withoutDesc[0], { label: 'DESCRIPCIÓN', align: 'left', w: C - fixedTotal }, ...withoutDesc.slice(1)];
    let cx = M;
    return allDefs.map((d) => { const x = cx; cx += d.w; return { ...d, x }; });
  })();

  const drawTableHeader = (atY: number) => {
    const ROW_H = 8;
    doc.setFillColor(15, 28, 46);
    doc.rect(M, atY, C, ROW_H, 'F');
    doc.setTextColor(255, 255, 255); doc.setFontSize(5.5); doc.setFont('helvetica', 'bold');
    TABLE_COLS.forEach(({ x, w, label, align }) => {
      const PAD = 1.2;
      const cx = align === 'right' ? x + w - PAD : x + PAD;
      const fitted = (doc.splitTextToSize(label, w - PAD * 2) as string[])[0] || label;
      doc.text(fitted, cx, atY + 5.5, { align: align === 'right' ? 'right' : 'left' });
    });
    return atY + ROW_H;
  };

  drawPageHeader();
  let y = 26;

  const leftInfo: [string, string | null][] = [
    ['EMPRENDIMIENTO', form.emprendimiento], ['OBRA / SERVICIO', form.obra_servicio], ['CONTRATISTA', form.contratista], ['BASE', form.base || '—'],
  ];
  const rightInfo: [string, string | null][] = [
    ['ADA N°', form.ada_numero], ['OC N°', form.oc_numero || '—'], ['MES / PERÍODO', form.mes_periodo], ['FECHA INICIO', fmtDate(form.fecha_inicio)],
    ['PLAZO', form.plazo_obra || '—'], ['FIN', fmtDate(form.fecha_finalizacion)], ['MONTO CONTRATADO', fmt(montoContratado)],
  ];
  // Un texto largo no se encima con la columna de la derecha: se corta con "…".
  const recortar = (s: string, ancho: number) => { if (doc.getTextWidth(s) <= ancho) return s; let x = s; while (x.length > 1 && doc.getTextWidth(x + '…') > ancho) x = x.slice(0, -1); return x + '…'; };
  const INFO_LINE = 5.5;
  doc.setFontSize(8); doc.setTextColor(40, 40, 40);
  leftInfo.forEach(([k, v], i) => {
    const ry = y + i * INFO_LINE;
    doc.setFont('helvetica', 'bold'); doc.setTextColor(80, 80, 80); doc.text(k + ':', M, ry);
    doc.setFont('helvetica', 'normal'); doc.setTextColor(20, 20, 20); doc.text(recortar(String(v || '—'), W / 2 - M - 45), M + 40, ry);
  });
  rightInfo.forEach(([k, v], i) => {
    const ry = y + i * INFO_LINE;
    doc.setFont('helvetica', 'bold'); doc.setTextColor(80, 80, 80); doc.text(k + ':', W / 2 + 5, ry);
    doc.setFont('helvetica', 'normal'); doc.setTextColor(20, 20, 20); doc.text(String(v || '—'), W / 2 + 48, ry);
  });
  y += Math.max(leftInfo.length, rightInfo.length) * INFO_LINE + 4;

  doc.setDrawColor(200, 200, 200); doc.setLineWidth(0.3);
  doc.line(M, y, W - M, y);
  y += 4;
  y = drawTableHeader(y);

  doc.setFont('helvetica', 'normal');
  items.forEach((item, idx) => {
    doc.setFontSize(6);
    const descLines = doc.splitTextToSize(item.descripcion || '', TABLE_COLS[1].w - 2.4) as string[];
    const ROW_H = Math.max(7, descLines.length * 4.2 + 2);
    if (y + ROW_H > SAFE_BOTTOM) {
      doc.addPage();
      drawPageHeader(); y = 26; y = drawTableHeader(y);
    }
    const par = idx % 2 === 0;
    doc.setFillColor(par ? 255 : 245, par ? 255 : 247, par ? 255 : 250);
    doc.rect(M, y, C, ROW_H, 'F');
    doc.setDrawColor(220, 220, 220); doc.setLineWidth(0.15);
    doc.line(M, y + ROW_H, M + C, y + ROW_H);
    const ty = y + ROW_H / 2 + 2;
    doc.setTextColor(40, 40, 40);

    const cant = Number(item.cantidad) || 0;
    const cantStr = cant === 0 ? '' : Number.isInteger(cant) ? String(cant) : cant.toFixed(2).replace('.', ',');
    const PAD = 1.2;
    const cell = (text: unknown, colIdx: number, bold = false, fontSize = 6) => {
      const col = TABLE_COLS[colIdx];
      const str = String(text ?? '');
      if (!str) return;
      doc.setFontSize(fontSize);
      doc.setFont('helvetica', bold ? 'bold' : 'normal');
      const fitted = (doc.splitTextToSize(str, col.w - PAD * 2) as string[])[0] || str;
      if (col.align === 'right') doc.text(fitted, col.x + col.w - PAD, ty, { align: 'right' });
      else doc.text(fitted, col.x + PAD, ty, { align: 'left' });
    };
    const u = fmtU;
    doc.setFontSize(6); doc.setFont('helvetica', 'normal');
    doc.text(String(item.numero || idx + 1), TABLE_COLS[0].x + TABLE_COLS[0].w - PAD, ty, { align: 'right' });
    doc.text(descLines, TABLE_COLS[1].x + PAD, y + 4.2);
    cell(item.um || '', 2, false, 6);
    cell(cantStr, 3, false, 6);
    cell(fmtC(item.importe_unitario), 4, false, 5.5);
    cell(fmtC(item.importe_total), 5, true, 5.5);
    cell(u(item.med_acum_anterior_unidad), 6, false, 5.5);
    cell(r0(item.med_acum_anterior_importe) ? fmtC(item.med_acum_anterior_importe) : '', 7, false, 5.5);
    cell(u(item.med_presente_unidad), 8, false, 5.5);
    cell(r0(item.med_presente_importe) ? fmtC(item.med_presente_importe) : '', 9, false, 5.5);
    cell(u(item.med_acum_presente_unidad), 10, false, 5.5);
    cell(r0(item.med_acum_presente_importe) ? fmtC(item.med_acum_presente_importe) : '', 11, false, 5.5);
    cell(u(item.saldo_pendiente_unidad), 12, false, 5.5);
    cell(r0(item.saldo_pendiente_importe) ? fmtC(item.saldo_pendiente_importe) : '', 13, true, 5.5);
    y += ROW_H;
  });

  // Totales
  const TOTALS_H = hasMedicion ? 52 : 38;
  if (y + TOTALS_H > SAFE_BOTTOM) {
    doc.addPage();
    drawPageHeader(); y = 26;
  }
  y += 5;
  const pctCertificado = subtotalContrato > 0 ? (pdfSubtotal / subtotalContrato) * 100 : 0;
  if (hasMedicion) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(90, 90, 90);
    doc.text(`Total contrato: ${fmt(subtotalContrato)}`, W - M, y, { align: 'right' }); y += 6;
    doc.text(`Saldo pendiente: ${fmt(totalSaldo)}`, W - M, y, { align: 'right' }); y += 6;
  }
  doc.setFillColor(235, 243, 255);
  doc.rect(W - M - 90, y, 90, 8, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(15, 28, 46);
  doc.text(hasMedicion ? 'IMP. CERTIFICADO:' : 'SUBTOTAL:', W - M - 88, y + 5.5);
  doc.text(fmt(pdfSubtotal), W - M - 1, y + 5.5, { align: 'right' });
  y += 10;
  if (pctCertificado > 0) {
    doc.setFont('helvetica', 'italic'); doc.setFontSize(6.5); doc.setTextColor(140, 150, 165);
    doc.text(`Representa el ${pctCertificado.toFixed(1)}% del total del contrato`, W - M, y, { align: 'right' });
    y += 6;
  }
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(90, 90, 90);
  if (pdfAnticipo > 0) {
    const antiLabel = form.anticipo_fijo
      ? `Anticipo/Desacopio (monto fijo):   -${fmt(pdfAnticipo)}`
      : `Anticipo/Desacopio (${Number(form.anticipo_pct)}%):   -${fmt(pdfAnticipo)}`;
    doc.text(antiLabel, W - M, y, { align: 'right' }); y += 7;
  }
  if (pdfFondoReparo > 0) {
    const nombre = form.fondo_reparo_label || 'Fondo de Reparo';
    const fondoLabel = form.fondo_reparo_fijo
      ? `${nombre} (monto fijo):   -${fmt(pdfFondoReparo)}`
      : `${nombre} (${Number(form.fondo_reparo_pct)}%):   -${fmt(pdfFondoReparo)}`;
    doc.text(fondoLabel, W - M, y, { align: 'right' }); y += 7;
  }
  doc.setFillColor(15, 28, 46);
  doc.rect(W - M - 90, y, 90, 10, 'F');
  doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
  doc.text('TOTAL NETO:', W - M - 88, y + 7);
  doc.text(fmt(pdfTotalNeto), W - M - 1, y + 7, { align: 'right' });
  y += 18;

  // Firmas
  const hasFirmaJefe = !!firmaJefeBase64;
  const hasFirmaGerente = !!firmaBase64;
  if (hasFirmaJefe || hasFirmaGerente) {
    const BLOCK_W = 90, IMG_H = 34, TEXT_H = 22, BLOCK_H = IMG_H + TEXT_H, GAP = 20;
    const count = (hasFirmaJefe ? 1 : 0) + (hasFirmaGerente ? 1 : 0);
    const totalW = count * BLOCK_W + (count - 1) * GAP;
    const startX = (W - totalW) / 2;
    if (y + BLOCK_H + 18 > SAFE_BOTTOM) {
      doc.addPage();
      drawPageHeader(); y = 26;
    }
    y += 10;
    doc.setDrawColor(200, 212, 228); doc.setLineWidth(0.3);
    doc.line(M, y - 5, W - M, y - 5);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); doc.setTextColor(100, 115, 140);
    doc.text('FIRMAS Y APROBACIÓN', W / 2, y, { align: 'center' });
    y += 6;

    const bloque = async (base64: string, nombre: string, cargo: string, cargo2: string | null, sello: string | null, bx: number) => {
      const by = y;
      const dims = await dimensiones(base64);
      let drawW = BLOCK_W, drawH = IMG_H;
      if (dims && dims.w && dims.h) {
        const ratio = dims.w / dims.h;
        if (ratio > BLOCK_W / IMG_H) { drawW = BLOCK_W; drawH = BLOCK_W / ratio; } else { drawH = IMG_H; drawW = IMG_H * ratio; }
      }
      const fmtImg = base64.startsWith('data:image/jpeg') || base64.startsWith('data:image/jpg') ? 'JPEG' : 'PNG';
      doc.addImage(base64, fmtImg, bx + (BLOCK_W - drawW) / 2, by + (IMG_H - drawH) / 2, drawW, drawH, undefined, 'NONE');
      const lineY = by + IMG_H;
      doc.setDrawColor(170, 188, 212); doc.setLineWidth(0.4);
      doc.line(bx + 6, lineY, bx + BLOCK_W - 6, lineY);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(15, 28, 46);
      doc.text(nombre, bx + BLOCK_W / 2, lineY + 5.5, { align: 'center', maxWidth: BLOCK_W - 4 });
      doc.setFont('helvetica', 'normal'); doc.setFontSize(6); doc.setTextColor(80, 95, 120);
      doc.text(cargo, bx + BLOCK_W / 2, lineY + 10.5, { align: 'center', maxWidth: BLOCK_W - 4 });
      if (cargo2) doc.text(cargo2, bx + BLOCK_W / 2, lineY + 15, { align: 'center', maxWidth: BLOCK_W - 4 });
      if (sello) {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(5.5); doc.setTextColor(34, 120, 70);
        doc.text(sello, bx + BLOCK_W / 2, by + BLOCK_H - 2.5, { align: 'center' });
      }
    };
    const fecha = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : null);
    let i = 0;
    if (hasFirmaJefe) {
      const f = fecha(form.fecha_firma_jefe);
      await bloque(firmaJefeBase64!, form.firmado_por_jefe || 'Jefe de Sitio', 'Jefe de Sitio', f ? `Firmado: ${f}` : null, 'Conforme', startX + i * (BLOCK_W + GAP));
      i++;
    }
    if (hasFirmaGerente) {
      const f = fecha(form.fecha_aprobacion);
      await bloque(firmaBase64!, form.aprobado_por || 'Gerencia', 'Gerente de Contratos', 'Mejores Hospitales S.A.', f ? `Aprobado: ${f}` : 'Aprobado', startX + i * (BLOCK_W + GAP));
    }
  }

  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    drawFooter(p, totalPages);
  }
  doc.save(`Certificado_N${form.numero}_${(form.contratista || '').replace(/ /g, '_')}.pdf`);
}
