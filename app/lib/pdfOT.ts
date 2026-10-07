import { listarFotos } from './ot';
import { materialesDeOT } from './panol';
import type { FilaTablero } from './tablero';

// PDF de una orden de trabajo: port de utils/exportWorkOrderPDF.js de la v1 (A4, cabecera oscura de MEJORES,
// datos, lista de tareas, materiales a utilizar y faltantes con filas para completar a mano, motivos,
// fotos, notas y firmas). Sin tildes en el texto, como el original (Helvetica de jsPDF).

type RGB = [number, number, number];
const C: Record<string, RGB> = {
  dark: [30, 30, 30], red: [192, 57, 43], redLt: [253, 235, 232], green: [39, 174, 96], greenLt: [232, 248, 238],
  amber: [180, 120, 0], amberLt: [255, 248, 220], white: [255, 255, 255], offWht: [248, 248, 250], gray1: [40, 40, 40],
  gray2: [90, 90, 90], gray3: [150, 150, 150], gray4: [215, 215, 215], rowAlt: [244, 245, 250], blue: [41, 128, 185], blueLt: [232, 242, 251],
};

// La v1 no tenía color para "en validación" (caía en PENDIENTE); acá tiene el suyo.
const STATUS_CFG: Record<string, { color: RGB; label: string }> = {
  pendiente: { color: [150, 150, 150], label: 'PENDIENTE' },
  asignada: { color: [80, 80, 80], label: 'ASIGNADA' },
  en_progreso: { color: [41, 128, 185], label: 'EN PROGRESO' },
  pendiente_validacion: { color: [180, 120, 0], label: 'EN VALIDACION' },
  completada: { color: [39, 174, 96], label: 'COMPLETADA' },
  cancelada: { color: [150, 50, 50], label: 'CANCELADA' },
  obra: { color: [190, 60, 120], label: 'FUTURA OBRA' },
};
const PRIORITY_CFG: Record<string, { color: RGB }> = {
  baja: { color: [150, 150, 150] }, media: { color: [41, 128, 185] }, alta: { color: [192, 100, 0] }, urgente: { color: [192, 57, 43] },
};
const TYPE_LABELS: Record<string, string> = {
  mantenimiento_preventivo: 'Mantenimiento Preventivo', mantenimiento_correctivo: 'Mantenimiento Correctivo',
  instalacion: 'Instalacion', inspeccion: 'Inspeccion', reparacion: 'Reparacion', emergencia: 'Emergencia',
};

const LOGO_V1 = 'https://media.base44.com/images/public/69bc7d2a6f0e7ed160c90003/b6844473f_mejores_cover.jpg';
const LOGO_LOCAL = '/certificados/mejores-logo.jpg';

const fmt = (n: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n || 0);
const fmtDate = (d?: string | Date | null) => {
  if (!d) return '-';
  const x = typeof d === 'string' && d.length === 10 ? new Date(`${d}T12:00:00`) : new Date(d);
  return Number.isNaN(x.getTime()) ? String(d) : x.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

async function aBase64(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.size || !blob.type.startsWith('image/')) return null;
    return await new Promise((ok) => { const fr = new FileReader(); fr.onloadend = () => ok(fr.result as string); fr.onerror = () => ok(null); fr.readAsDataURL(blob); });
  } catch {
    return null;
  }
}

export async function descargarPDFOrden(order: FilaTablero): Promise<void> {
  const { default: jsPDF } = await import('jspdf');
  const W = 210, M = 14, COL = W - M * 2;

  const [logoB64, materiales, fotos] = await Promise.all([
    aBase64(LOGO_V1).then((b) => b ?? aBase64(LOGO_LOCAL)),
    materialesDeOT(order.id).catch(() => []),
    listarFotos(order.id).catch(() => []),
  ]);

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  let y = 0;
  const sectionTitle = (label: string, x: number, yy: number, lineLen = 60) => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...C.red);
    doc.text(label, x, yy);
    doc.setDrawColor(...C.red); doc.setLineWidth(0.5);
    doc.line(x, yy + 1.8, x + lineLen, yy + 1.8);
  };

  // ── cabecera
  doc.setFillColor(...C.dark); doc.rect(0, 0, W, 48, 'F');
  if (logoB64) doc.addImage(logoB64, 'JPEG', M, 5, 55, 20);
  else { doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.setTextColor(...C.white); doc.text('MEJORES', M, 18); }
  doc.setFillColor(...C.red); doc.rect(0, 44, W, 4, 'F');
  doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(...C.gray4);
  doc.text('info@mejores.com.ar  ·  +54 (11) 4000-0000', M, 39);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(...C.white);
  doc.text('ORDEN DE TRABAJO', W - M, 13, { align: 'right' });
  const st = STATUS_CFG[order.estado] || STATUS_CFG.pendiente;
  doc.setFillColor(...st.color); doc.roundedRect(W - M - 52, 17, 52, 8, 1.5, 1.5, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...C.white);
  doc.text(st.label, W - M - 26, 22.2, { align: 'center' });
  const pr = PRIORITY_CFG[order.prioridad] || PRIORITY_CFG.media;
  doc.setFillColor(...pr.color); doc.roundedRect(W - M - 52, 28, 52, 7, 1.5, 1.5, 'F');
  doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(...C.white);
  doc.text(`Prioridad: ${(order.prioridad || '').toUpperCase()}`, W - M - 26, 32.8, { align: 'center' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...C.gray4);
  doc.text(`Codigo: ${order.codigo || '-'}  |  Tipo: ${TYPE_LABELS[order.tipo] || order.tipo || '-'}`, W - M, 41, { align: 'right' });
  y = 56;

  // ── datos
  doc.setFillColor(...C.offWht); doc.roundedRect(M, y, COL, 42, 2, 2, 'F');
  doc.setDrawColor(...C.gray4); doc.setLineWidth(0.3); doc.roundedRect(M, y, COL, 42, 2, 2, 'S');
  const cell = (label: string, val: string | null | undefined, cx: number, cy: number, cw: number) => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6); doc.setTextColor(...C.gray3);
    doc.text(label.toUpperCase(), cx, cy);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...C.gray1);
    doc.text(doc.splitTextToSize(String(val || '-'), cw - 2)[0], cx, cy + 4.5);
  };
  const half = (COL - 8) / 2;
  const third = (COL - 8) / 3;
  const lugar = [order.ubicacion_nombre, order.ubicacion_direccion].filter(Boolean).join(' · ');
  cell('Titulo de la tarea', order.titulo, M + 3, y + 6, COL - 6);
  cell('Lugar / Ubicacion', lugar, M + 3, y + 16, half);
  cell('Equipo o activo', order.activo_nombre, M + 3 + half + 4, y + 16, half);
  cell('Asignado a', order.asignado_nombre, M + 3, y + 26, third);
  cell('Fecha programada', fmtDate(order.fecha_programada), M + 3 + third + 4, y + 26, third);
  cell('Fecha completada', order.estado === 'completada' ? fmtDate(order.fecha_validacion) : '-', M + 3 + 2 * (third + 4), y + 26, third);
  cell('Impreso el', fmtDate(new Date()), M + 3, y + 36, COL / 2);
  y += 48;

  // ── descripción
  if (order.descripcion) {
    doc.setFillColor(...C.blueLt);
    const descLines = doc.splitTextToSize(order.descripcion, COL - 8);
    const dh = descLines.length * 4.5 + 10;
    doc.roundedRect(M, y, COL, dh, 2, 2, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...C.blue);
    doc.text('Descripcion del trabajo', M + 4, y + 5.5);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...C.gray1);
    doc.text(descLines, M + 4, y + 10.5);
    y += dh + 6;
  }

  // ── checklist
  const checklist = order.checklist || [];
  if (checklist.length > 0) {
    if (y + 20 > 272) { doc.addPage(); y = 14; }
    sectionTitle('LISTA DE TAREAS', M, y, 50);
    y += 5;
    const done = checklist.filter((t) => t.hecho).length;
    const pct = Math.round((done / checklist.length) * 100);
    doc.setFillColor(...C.gray4); doc.roundedRect(M, y, COL, 5, 1, 1, 'F');
    if (pct > 0) { doc.setFillColor(...(pct === 100 ? C.green : pct > 50 ? C.blue : C.red)); doc.roundedRect(M, y, Math.max((COL * pct) / 100, 2), 5, 1, 1, 'F'); }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...C.gray1);
    doc.text(`${done} de ${checklist.length} tareas completadas (${pct}%)`, M, y + 10);
    y += 14;
    for (const task of checklist) {
      const hasNotes = !!task.nota?.trim();
      const taskH = hasNotes ? 14 : 10;
      if (y + taskH > 272) { doc.addPage(); y = 14; }
      doc.setFillColor(...(task.hecho ? C.greenLt : C.offWht)); doc.roundedRect(M, y, COL, taskH, 1.5, 1.5, 'F');
      doc.setDrawColor(...(task.hecho ? C.green : C.gray4)); doc.setLineWidth(0.3); doc.roundedRect(M, y, COL, taskH, 1.5, 1.5, 'S');
      doc.setFillColor(...(task.hecho ? C.green : C.white)); doc.setDrawColor(...(task.hecho ? C.green : C.gray3)); doc.setLineWidth(0.6);
      doc.roundedRect(M + 3, y + 2.5, 6, 6, 1, 1, task.hecho ? 'FD' : 'S');
      if (task.hecho) { doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...C.white); doc.text('OK', M + 4.2, y + 7); }
      doc.setFont('helvetica', task.hecho ? 'normal' : 'bold'); doc.setFontSize(8.5); doc.setTextColor(...(task.hecho ? C.gray3 : C.gray1));
      doc.text(doc.splitTextToSize(task.tarea, COL - 16)[0], M + 12, y + 7);
      if (hasNotes) { doc.setFont('helvetica', 'italic'); doc.setFontSize(7); doc.setTextColor(...C.gray3); doc.text(`Nota: ${task.nota}`, M + 12, y + 12); }
      y += taskH + 2;
    }
    y += 4;
  }

  // ── materiales a utilizar (siempre)
  if (y + 30 > 272) { doc.addPage(); y = 14; }
  sectionTitle('MATERIALES A UTILIZAR', M, y, 65);
  y += 6;
  doc.setFillColor(...C.dark); doc.roundedRect(M, y, COL, 7, 1, 1, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...C.white);
  doc.text('Material / Descripcion', M + 3, y + 4.8);
  doc.text('Cantidad', M + 108, y + 4.8, { align: 'right' });
  doc.text('Unidad', M + 140, y + 4.8, { align: 'right' });
  doc.text('Observaciones', W - M - 2, y + 4.8, { align: 'right' });
  y += 8;
  let matTotal = 0;
  materiales.forEach((m, i) => {
    if (y + 7 > 272) { doc.addPage(); y = 14; }
    matTotal += Number(m.total) || 0;
    doc.setFillColor(...(i % 2 === 0 ? C.white : C.rowAlt)); doc.rect(M, y, COL, 7, 'F');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...C.gray1);
    doc.text(doc.splitTextToSize(m.descripcion || '', 95)[0], M + 3, y + 4.8);
    doc.text(String(m.cantidad || 0), M + 108, y + 4.8, { align: 'right' });
    doc.setTextColor(...C.gray2);
    doc.text(m.unidad || '-', M + 140, y + 4.8, { align: 'right' });
    doc.text(Number(m.costo_unitario) > 0 ? fmt(Number(m.costo_unitario)) : '-', W - M - 2, y + 4.8, { align: 'right' });
    y += 7;
  });
  const filasEnBlanco = (n: number, color: RGB) => {
    for (let b = 0; b < Math.max(5 - n, 4); b++) {
      if (y + 7 > 272) { doc.addPage(); y = 14; }
      doc.setFillColor(...((n + b) % 2 === 0 ? C.white : C.rowAlt)); doc.rect(M, y, COL, 7, 'F');
      doc.setDrawColor(...color); doc.setLineWidth(0.2); doc.setLineDashPattern([1, 1], 0);
      doc.line(M + 3, y + 5.5, M + 95, y + 5.5); doc.line(M + 98, y + 5.5, M + 112, y + 5.5);
      doc.line(M + 130, y + 5.5, M + 143, y + 5.5); doc.line(M + 152, y + 5.5, W - M - 2, y + 5.5);
      doc.setLineDashPattern([], 0);
      y += 7;
    }
  };
  filasEnBlanco(materiales.length, C.gray4);
  if (matTotal > 0) {
    doc.setFillColor(...C.dark); doc.roundedRect(W - M - 58, y + 1, 58, 8, 1, 1, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...C.white);
    doc.text('TOTAL MATERIALES', W - M - 56, y + 6);
    doc.setTextColor(...C.red); doc.text(fmt(matTotal), W - M - 2, y + 6, { align: 'right' });
    y += 10;
  } else y += 4;

  // ── faltantes (siempre)
  if (y + 30 > 272) { doc.addPage(); y = 14; }
  doc.setFillColor(...C.amberLt); doc.roundedRect(M, y, COL, 10, 2, 2, 'F');
  doc.setDrawColor(...C.amber); doc.setLineWidth(0.5); doc.roundedRect(M, y, COL, 10, 2, 2, 'S');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...C.amber);
  doc.text('MATERIALES QUE FALTARON', M + 4, y + 6.5);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(...C.gray2);
  doc.text('(para que el operario complete en campo)', W - M - 2, y + 6.5, { align: 'right' });
  y += 12;
  doc.setFillColor(180, 120, 0); doc.roundedRect(M, y, COL, 7, 1, 1, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...C.white);
  doc.text('Material que falto', M + 3, y + 4.8);
  doc.text('Cantidad', M + 108, y + 4.8, { align: 'right' });
  doc.text('Unidad', M + 140, y + 4.8, { align: 'right' });
  doc.text('Motivo / Comentario', W - M - 2, y + 4.8, { align: 'right' });
  y += 8;
  const faltantes = order.materiales_faltantes || [];
  faltantes.forEach((f, i) => {
    if (y + 7 > 272) { doc.addPage(); y = 14; }
    doc.setFillColor(...(i % 2 === 0 ? C.white : C.rowAlt)); doc.rect(M, y, COL, 7, 'F');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...C.gray1);
    doc.text(doc.splitTextToSize(f.material || '', 90)[0], M + 3, y + 4.8);
    doc.text(String(f.cantidad || ''), M + 108, y + 4.8, { align: 'right' });
    doc.setTextColor(...C.gray2);
    doc.text(f.motivo || '-', W - M - 2, y + 4.8, { align: 'right' });
    y += 7;
  });
  filasEnBlanco(faltantes.length, C.amber);
  y += 6;

  // ── motivos de incompleto
  const motivos = order.motivos_incompleto || [];
  if (motivos.length > 0) {
    if (y + 20 > 272) { doc.addPage(); y = 14; }
    const mH = motivos.length * 9 + 22;
    doc.setFillColor(...C.redLt); doc.roundedRect(M, y, COL, mH, 2, 2, 'F');
    doc.setDrawColor(...C.red); doc.setLineWidth(0.5); doc.roundedRect(M, y, COL, mH, 2, 2, 'S');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...C.red);
    doc.text('POR QUE NO SE TERMINO', M + 4, y + 7);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...C.gray2);
    doc.text('Motivos informados por el operario', M + 4, y + 12);
    let my = y + 15;
    for (const m of motivos) {
      if (my + 8 > 272) { doc.addPage(); my = 14; }
      doc.setFillColor(...C.white); doc.roundedRect(M + 3, my, COL - 6, 7.5, 1, 1, 'F');
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...C.gray1);
      doc.text(`- ${m.texto || ''}`, M + 5, my + 5);
      my += 9;
    }
    y = my + 4;
  }

  // ── fotos
  const enviadas = fotos.filter((f) => !f.enEspera);
  if (enviadas.length > 0) {
    const valid = (await Promise.all(enviadas.map((f) => aBase64(f.url)))).filter((x): x is string => !!x);
    if (valid.length > 0) {
      if (y + 20 > 272) { doc.addPage(); y = 14; }
      sectionTitle('FOTOS DE LA OBRA', M, y, 48);
      y += 6;
      const perRow = 3;
      const imgW = (COL - (perRow - 1) * 4) / perRow;
      const imgH = imgW * 0.65;
      for (let i = 0; i < valid.length; i += perRow) {
        if (y + imgH + 6 > 272) { doc.addPage(); y = 14; }
        valid.slice(i, i + perRow).forEach((b64, j) => {
          const px = M + j * (imgW + 4);
          doc.addImage(b64, 'JPEG', px, y, imgW, imgH);
          doc.setDrawColor(...C.gray4); doc.setLineWidth(0.3); doc.rect(px, y, imgW, imgH, 'S');
          doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(...C.gray3);
          doc.text(`Foto ${i + j + 1}`, px + imgW / 2, y + imgH + 3.5, { align: 'center' });
        });
        y += imgH + 8;
      }
      y += 2;
    }
  }

  // ── notas
  if (order.notas) {
    if (y + 20 > 272) { doc.addPage(); y = 14; }
    sectionTitle('NOTAS Y OBSERVACIONES', M, y, 60);
    y += 5;
    const lines = doc.splitTextToSize(order.notas, COL - 8);
    const nh = lines.length * 4.5 + 8;
    doc.setFillColor(...C.offWht); doc.roundedRect(M, y, COL, nh, 1.5, 1.5, 'F');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...C.gray2);
    doc.text(lines, M + 4, y + 6);
    y += nh + 8;
  }

  // ── firmas
  if (y + 38 > 272) { doc.addPage(); y = 14; }
  let sigY = Math.max(y + 4, 240);
  if (sigY + 38 > 285) { doc.addPage(); sigY = 14; }
  const sigW = (COL - 16) / 2;
  doc.setFillColor(...C.offWht); doc.roundedRect(M, sigY, sigW, 32, 2, 2, 'F');
  doc.setDrawColor(...C.gray4); doc.setLineWidth(0.3); doc.roundedRect(M, sigY, sigW, 32, 2, 2, 'S');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...C.gray2);
  doc.text('FIRMA DEL OPERARIO', M + sigW / 2, sigY + 6, { align: 'center' });
  doc.setDrawColor(...C.gray3); doc.setLineWidth(0.4); doc.line(M + 6, sigY + 24, M + sigW - 6, sigY + 24);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...C.gray3);
  doc.text(order.asignado_nombre || 'Nombre y apellido', M + sigW / 2, sigY + 28, { align: 'center' });
  // Firma de conformidad (si la tiene), respetando su proporción, como la v1.
  if (order.firma_url) {
    const maxW = sigW - 12, maxH = 14;
    let dw = maxW, dh = maxH;
    await new Promise<void>((ok) => {
      const img = new Image();
      img.onload = () => {
        if (img.naturalWidth && img.naturalHeight) {
          const r = img.naturalWidth / img.naturalHeight;
          if (r > maxW / maxH) { dw = maxW; dh = maxW / r; } else { dh = maxH; dw = maxH * r; }
        }
        ok();
      };
      img.onerror = () => ok();
      img.src = order.firma_url!;
    });
    doc.addImage(order.firma_url, 'PNG', M + 6 + (maxW - dw) / 2, sigY + 8 + (maxH - dh) / 2, dw, dh);
    doc.setFont('helvetica', 'italic'); doc.setFontSize(6.5); doc.setTextColor(...C.green);
    doc.text(`Firmado: ${order.firma_nombre || ''}`, M + sigW / 2, sigY + 23, { align: 'center' });
  }
  const s2x = M + sigW + 16;
  doc.setFillColor(...C.offWht); doc.roundedRect(s2x, sigY, sigW, 32, 2, 2, 'F');
  doc.setDrawColor(...C.gray4); doc.roundedRect(s2x, sigY, sigW, 32, 2, 2, 'S');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...C.gray2);
  doc.text('FIRMA DEL JEFE DE SITIO', s2x + sigW / 2, sigY + 6, { align: 'center' });
  doc.setDrawColor(...C.gray3); doc.setLineWidth(0.4); doc.line(s2x + 6, sigY + 24, s2x + sigW - 6, sigY + 24);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...C.gray3);
  doc.text('Fecha:  _____ / _____ / _________', s2x + sigW / 2, sigY + 28, { align: 'center' });

  // ── pie
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFillColor(...C.dark); doc.rect(0, 286, W, 11, 'F');
    doc.setFillColor(...C.red); doc.rect(0, 285, W, 1.5, 'F');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(...C.gray4);
    doc.text('MEJORES - Mantenimiento, Obras y Servicios  |  info@mejores.com.ar', M, 292);
    doc.text(`${order.codigo || 'OT'}  |  Pagina ${i} de ${pages}`, W - M, 292, { align: 'right' });
    if (i > 1) { doc.setFillColor(...C.red); doc.rect(0, 0, W, 2, 'F'); }
  }

  doc.save(`OT_${order.codigo || order.id}_MEJORES.pdf`);
}
