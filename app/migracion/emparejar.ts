// Emparejar las escuelas de la v1 (LocationData) con los lugares que ya están en la v2 (por ejemplo, los importados
// el 19/10/2026 desde la planilla "LISTADO ESCUELAS POR COMUNA"). Sin esto, el --apply crea un duplicado por escuela.
// Medido ese día: de 330 escuelas de la v1, 217 tienen un único par por nombre y comuna, 8 son homónimas y 105 no
// están en la planilla.
//
// Regla: mismo sector, misma zona (comuna) y mismo nombre normalizado, y que el par sea ÚNICO de los dos lados.
// Ante la duda (homónimos), no se empareja: se crea aparte y se reporta.

export interface LugarV2 { id: string; sector_id: string; nombre: string; zona: string | null; id_origen: string | null }
export interface EscuelaV1 { id_origen: string; sector_id: string; nombre: string; zona: string | null }

// "CFP N° 04 ([A])" → "cfp n° 04"; acentos, Nº/N°, espacios y mayúsculas no cuentan.
export function normNombre(s: unknown): string {
  return String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\(\s*\[?\s*a\s*\]?\s*\)|\[\s*a\s*\]/g, '').replace(/[º°]/g, '°').replace(/n\s*°\s*/g, 'n° ')
    .replace(/\s+/g, ' ').trim();
}

const clave = (sector: string, zona: string | null, nombre: string) => `${sector}|${(zona ?? '').trim().toUpperCase()}|${normNombre(nombre)}`;

// Devuelve id_origen de la v1 → id del lugar existente en la v2, y los que quedaron ambiguos.
export function emparejar(escuelas: EscuelaV1[], existentes: LugarV2[]): { pares: Map<string, string>; ambiguos: string[] } {
  const libres = existentes.filter((l) => !l.id_origen);
  const porClaveV2 = new Map<string, LugarV2[]>();
  for (const l of libres) {
    const k = clave(l.sector_id, l.zona, l.nombre);
    porClaveV2.set(k, [...(porClaveV2.get(k) ?? []), l]);
  }
  const porClaveV1 = new Map<string, EscuelaV1[]>();
  for (const e of escuelas) {
    const k = clave(e.sector_id, e.zona, e.nombre);
    porClaveV1.set(k, [...(porClaveV1.get(k) ?? []), e]);
  }
  const pares = new Map<string, string>();
  const ambiguos: string[] = [];
  for (const [k, v1] of porClaveV1) {
    const v2 = porClaveV2.get(k) ?? [];
    if (v2.length === 0) continue;
    if (v1.length === 1 && v2.length === 1) pares.set(v1[0].id_origen, v2[0].id);
    else ambiguos.push(...v1.map((e) => e.nombre));
  }
  return { pares, ambiguos };
}

// La ubicación técnica de SAP tiene la forma C-IE-0000575(-0381). En la v1 el campo "ubic_tecnica" casi siempre
// trae el nombre de la escuela: eso no es un código y no se carga como tal (la fase 17 empareja por código).
export const codigoSAP = (s: unknown): string | null => {
  const t = String(s ?? '').trim().toUpperCase();
  return /^C-[A-Z]{2}-\d{5,}(-\d+)?$/.test(t) ? t : null;
};
