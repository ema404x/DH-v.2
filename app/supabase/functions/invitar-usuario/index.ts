// Edge function: invitar-usuario
// Alta de un usuario: crea la cuenta en Supabase Auth (le llega un correo para definir su contraseña)
// y su fila en perfiles, con rol y sector. Solo responde a un administrador activo.
//
// Usa la service_role key (la otra función que la usa es el reintento de informes de inspección). La key vive
// en el entorno de la función (Supabase la inyecta sola); nunca viaja al navegador.
//
// Deploy:  npx supabase functions deploy invitar-usuario

import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ROLES = ['admin', 'gerente_general', 'gerente', 'jefe_sitio', 'inspector', 'operario'];

function responder(cuerpo: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(cuerpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return responder({ error: 'Método no permitido.' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  const servicio = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anon || !servicio) return responder({ error: 'La función no está configurada.' }, 500);

  // 1. Quién llama: se valida su token y se lee su perfil con SU sesión (pasa por la RLS).
  const autorizacion = req.headers.get('Authorization') ?? '';
  const comoUsuario = createClient(url, anon, { global: { headers: { Authorization: autorizacion } } });
  const { data: quien, error: errorToken } = await comoUsuario.auth.getUser();
  if (errorToken || !quien.user) return responder({ error: 'Tenés que iniciar sesión.' }, 401);

  const { data: perfil } = await comoUsuario.from('perfiles').select('rol, activo').eq('id', quien.user.id).maybeSingle();
  if (!perfil || !perfil.activo || perfil.rol !== 'admin') {
    return responder({ error: 'Solo un administrador puede invitar usuarios.' }, 403);
  }

  // 2. Datos del alta. El sector es obligatorio: no hay sector por defecto.
  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = await req.json();
  } catch {
    return responder({ error: 'Los datos enviados no son válidos.' }, 400);
  }
  const email = String(cuerpo.email ?? '').trim().toLowerCase();
  const nombre = String(cuerpo.nombre ?? '').trim();
  const rol = String(cuerpo.rol ?? '');
  const sectorId = String(cuerpo.sector_id ?? '');
  const idOrigen = cuerpo.id_origen ? String(cuerpo.id_origen) : null;

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return responder({ error: 'El correo no es válido.' }, 400);
  if (!nombre) return responder({ error: 'Falta el nombre.' }, 400);
  if (!ROLES.includes(rol)) return responder({ error: 'El rol no es válido.' }, 400);
  if (!sectorId) return responder({ error: 'Falta el sector del usuario.' }, 400);

  const admin = createClient(url, servicio, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: sector } = await admin.from('sectores').select('id').eq('id', sectorId).eq('activo', true).maybeSingle();
  if (!sector) return responder({ error: 'El sector no existe o está inactivo.' }, 400);

  const { data: yaEsta } = await admin.from('perfiles').select('id').ilike('email', email).maybeSingle();
  if (yaEsta) return responder({ error: 'Ya hay un usuario con ese correo.' }, 409);

  // 3. Cuenta de Auth + perfil. Si el perfil falla, se borra la cuenta: no queda un usuario sin sector.
  const { data: invitado, error: errorInvitacion } = await admin.auth.admin.inviteUserByEmail(email, { data: { nombre } });
  if (errorInvitacion || !invitado.user) {
    return responder({ error: `No se pudo enviar la invitación: ${errorInvitacion?.message ?? 'error desconocido'}` }, 400);
  }

  const { error: errorPerfil } = await admin.from('perfiles').insert({
    id: invitado.user.id,
    email,
    nombre,
    rol,
    sector_id: sectorId,
    ...(idOrigen ? { id_origen: idOrigen } : {}),
  });
  if (errorPerfil) {
    await admin.auth.admin.deleteUser(invitado.user.id);
    return responder({ error: `No se pudo crear el perfil: ${errorPerfil.message}` }, 400);
  }

  return responder({ ok: true, id: invitado.user.id });
});
