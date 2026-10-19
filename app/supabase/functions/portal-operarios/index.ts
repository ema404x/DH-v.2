// Edge function: portal-operarios
// Portal sin usuario desde el QR de un lugar o equipo (fase 16, decisión de Emanuel del 19/10/2026).
// Es una puerta delgada: todas las reglas están en la base (funciones portal_* de la fase 16, que actúan
// como el usuario "Portal QR" del sector, con la máquina de estados y el checklist de siempre). Acá solo:
// leer la IP para el límite de intentos y el registro, y subir las fotos al bucket.
//
// Usa la service_role key (Supabase la inyecta sola; nunca viaja al navegador). Sin JWT del usuario.
// Deploy:  supabase functions deploy portal-operarios --no-verify-jwt

import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const BUCKET = 'ot-fotos';
const MAX_FOTO = 2_000_000; // las fotos llegan comprimidas en el teléfono (~200–400 KB)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function responder(cuerpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(cuerpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

// Los errores de la base (P0001) son mensajes para el operario; el resto se resume.
function error(e: { message?: string; code?: string } | null): Response {
  if (e?.code === 'P0001') return responder({ error: (e.message ?? '').replace(/^ERROR:\s*/, '') }, 400);
  console.error(e);
  return responder({ error: 'No se pudo completar. Probá de nuevo en un rato.' }, 500);
}

const txt = (v: unknown, max = 2000) => (typeof v === 'string' ? v.slice(0, max) : null);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return responder({ error: 'Método no permitido.' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const servicio = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !servicio) return responder({ error: 'La función no está configurada.' }, 500);
  const sb = createClient(url, servicio, { auth: { persistSession: false } });

  let c: Record<string, unknown>;
  try {
    c = await req.json();
  } catch {
    return responder({ error: 'Los datos enviados no son válidos.' }, 400);
  }
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || req.headers.get('cf-connecting-ip') || 'desconocida';
  const pase = txt(c.pase, 100);
  const ot = typeof c.ot === 'string' && UUID.test(c.ot) ? c.ot : null;
  const gps = c.gps && typeof c.gps === 'object' ? c.gps : null;

  switch (c.accion) {
    case 'entrar': {
      const { data, error: e } = await sb.rpc('portal_entrar', { p_token: txt(c.token, 100), p_clave: txt(c.clave, 100), p_nombre: txt(c.nombre, 100), p_ip: ip });
      if (e) return error(e);
      return responder(data, (data as { error?: string })?.error ? 400 : 200);
    }
    case 'ordenes': {
      const { data, error: e } = await sb.rpc('portal_ordenes', { p_pase: pase });
      return e ? error(e) : responder({ ordenes: data });
    }
    case 'iniciar': {
      if (!ot) return responder({ error: 'Falta la orden.' }, 400);
      const { data, error: e } = await sb.rpc('portal_iniciar', { p_pase: pase, p_ot: ot, p_gps: gps });
      return e ? error(e) : responder(data);
    }
    case 'foto': {
      const foto = typeof c.foto_id === 'string' && UUID.test(c.foto_id) ? c.foto_id : null;
      const b64 = typeof c.imagen === 'string' ? c.imagen.replace(/^data:image\/jpeg;base64,/, '') : '';
      if (!ot || !foto || !b64) return responder({ error: 'Falta la foto.' }, 400);
      let bytes: Uint8Array;
      try {
        bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
      } catch {
        return responder({ error: 'La foto no es válida.' }, 400);
      }
      if (bytes.length > MAX_FOTO) return responder({ error: 'La foto es demasiado grande.' }, 400);
      if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return responder({ error: 'La foto tiene que ser JPEG.' }, 400);
      // La base dice dónde va (y si esta persona puede subirla) antes de tocar el bucket.
      const ruta = await sb.rpc('portal_ruta_foto', { p_pase: pase, p_ot: ot, p_foto: foto });
      if (ruta.error) return error(ruta.error);
      const path = ruta.data as string;
      const subida = await sb.storage.from(BUCKET).upload(path, bytes, { contentType: 'image/jpeg', upsert: false });
      if (subida.error && !/exists|duplicate/i.test(subida.error.message)) return error(subida.error);
      const publica = sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
      const alta = await sb.rpc('portal_foto', { p_pase: pase, p_ot: ot, p_foto: foto, p_path: path, p_url: publica });
      if (alta.error) {
        await sb.storage.from(BUCKET).remove([path]);
        return error(alta.error);
      }
      return responder({ url: publica });
    }
    case 'finalizar': {
      if (!ot) return responder({ error: 'Falta la orden.' }, 400);
      const hechas = Array.isArray(c.hechas) ? c.hechas.filter((h) => typeof h === 'string').slice(0, 200) : [];
      const firma = typeof c.firma_url === 'string' && c.firma_url.startsWith('data:image/') && c.firma_url.length <= 400000 ? c.firma_url : null;
      const { data, error: e } = await sb.rpc('portal_finalizar', {
        p_pase: pase, p_ot: ot, p_hechas: hechas, p_motivo: txt(c.motivo), p_notas: txt(c.notas),
        p_firma_url: firma, p_firma_nombre: txt(c.firma_nombre, 100), p_gps: gps,
      });
      return e ? error(e) : responder(data);
    }
    default:
      return responder({ error: 'Acción desconocida.' }, 400);
  }
});
