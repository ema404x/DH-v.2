import { supabase } from './supabase/client';
import { exigir } from './errores';

// Ubicar lugares en el mapa por su dirección, con OpenStreetMap (Nominatim).
//
// Lo hace el navegador de quien lo pide, no un servidor: Nominatim rechaza los pedidos que salen de los
// servidores de las funciones de Supabase (responde 403). Nominatim pide no más de un pedido por segundo:
// se respeta. La forma de buscar sale de la configuración del sector (sectores.config.geocodificacion):
//   { "sufijo": "Ciudad Autónoma de Buenos Aires, Argentina", "viewbox": "-58.55,-34.52,-58.33,-34.74" }
// Sin configuración, se busca en toda la Argentina. Lo que no se encuentra queda marcado para no repetirlo.

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const PAUSA_MS = 1100;
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface ConfigGeo {
  sufijo?: string;
  viewbox?: string;
}

// Limpia la dirección antes de buscarla (mismas reglas que la v1).
export function limpiarDireccion(crudo: string): string {
  let d = crudo.replace(/\(.*?\)/g, '').trim();
  if (d.includes('/')) d = d.split('/')[0].trim();
  return d
    .replace(/\bAVDA\.\s*/gi, 'AVENIDA ')
    .replace(/\bAVDA\b/gi, 'AVENIDA')
    .replace(/\bAV\.\s*/gi, 'AVENIDA ')
    .replace(/\bGRAL\.\s*/gi, 'GENERAL ')
    .replace(/\bDR\.\s*/gi, 'DOCTOR ')
    .replace(/\bTTE\s+/gi, 'TENIENTE ')
    .replace(/\bCNEL\.\s*/gi, 'CORONEL ')
    .replace(/\bPJE\.\s*/gi, 'PASAJE ')
    .replace(/\bB°\s*/gi, 'BARRIO ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Los textos a probar, en orden: la dirección limpia; si es una esquina ("X Y Z"), la primera calle; y solo calle y número.
export function intentosDe(direccion: string): string[] {
  const limpia = limpiarDireccion(direccion);
  const intentos = [limpia];
  if (/ Y /i.test(limpia)) intentos.push(limpia.split(/ Y /i)[0].trim());
  const calle = limpia.match(/^([A-ZÁÉÍÓÚÑ\s.]+?)\s+(\d+)/i);
  if (calle) intentos.push(`${calle[1].trim()} ${calle[2]}`);
  return [...new Set(intentos)];
}

let ultimo = 0;
async function consultar(texto: string, c: ConfigGeo): Promise<{ lat: number; lng: number } | null> {
  const espera = ultimo + PAUSA_MS - Date.now();
  if (espera > 0) await dormir(espera);
  ultimo = Date.now();
  const p = new URLSearchParams({ q: `${texto}, ${c.sufijo || 'Argentina'}`, format: 'json', limit: '1' });
  if (c.viewbox) {
    p.set('viewbox', c.viewbox);
    p.set('bounded', '1');
  }
  const r = await fetch(`${NOMINATIM}?${p}`, { headers: { 'Accept-Language': 'es' } });
  if (!r.ok) throw new Error(`OpenStreetMap respondió ${r.status}`);
  const datos = (await r.json()) as { lat: string; lon: string }[];
  return datos.length > 0 ? { lat: Number(datos[0].lat), lng: Number(datos[0].lon) } : null;
}

async function buscar(direccion: string, c: ConfigGeo): Promise<{ lat: number; lng: number } | null> {
  for (const texto of intentosDe(direccion)) {
    const r = await consultar(texto, c);
    if (r) return r;
  }
  return null;
}

export interface Progreso {
  ubicados: number;
  sinEncontrar: number;
  quedan: number;
}

// Ubica, de a uno, los lugares activos con dirección que todavía no se buscaron. Avisa el avance en cada paso.
export async function ubicarPorDireccion(config: ConfigGeo, alAvanzar: (p: Progreso) => void): Promise<Progreso> {
  const sb = supabase();
  const pendientes = exigir(
    await sb.from('v_mapa_ubicaciones').select('id, domicilio').is('lat', null).not('domicilio', 'is', null).is('geo_intento_at', null).eq('activa', true).order('nombre').limit(500),
  ) as { id: string; domicilio: string }[];
  const p: Progreso = { ubicados: 0, sinEncontrar: 0, quedan: pendientes.length };
  alAvanzar({ ...p });
  const cache = new Map<string, { lat: number; lng: number } | null>();
  for (const l of pendientes) {
    let pos = cache.get(l.domicilio);
    if (pos === undefined) {
      pos = await buscar(l.domicilio, config);
      cache.set(l.domicilio, pos);
    }
    const ahora = new Date().toISOString();
    exigir(
      await sb.from('ubicaciones')
        .update(pos ? { lat: pos.lat, lng: pos.lng, geo_origen: 'direccion', geo_intento_at: ahora } : { geo_intento_at: ahora })
        .eq('id', l.id).select('id').single(),
    );
    if (pos) p.ubicados++;
    else p.sinEncontrar++;
    p.quedan--;
    alAvanzar({ ...p });
  }
  return p;
}
