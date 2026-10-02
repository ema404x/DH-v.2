// Los errores de negocio los redacta la base (raise exception) y se muestran tal cual.
// Acá solo se traducen los errores técnicos que el usuario no tiene por qué leer en crudo.

interface ErrorConCodigo {
  message?: string;
  code?: string;
  details?: string;
}

export function limpiarError(e: unknown): string {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return 'No hay conexión. Probá de nuevo cuando vuelva la señal.';
  }
  const err = (e ?? {}) as ErrorConCodigo;
  const mensaje = typeof e === 'string' ? e : err.message ?? '';
  const codigo = err.code ?? '';

  if (/failed to fetch|networkerror|load failed/i.test(mensaje)) {
    return 'No se pudo conectar con el servidor. Revisá la conexión y probá de nuevo.';
  }
  if (codigo === '42501' || /row-level security|permission denied/i.test(mensaje)) {
    return 'No tenés permiso para hacer esto en este sector.';
  }
  if (codigo === '23505') {
    return 'Ya existe un registro con esos datos.';
  }
  if (codigo === '23503') {
    return 'No se puede: hay otros registros que dependen de este.';
  }
  if (codigo === '23514' || codigo === '23502') {
    return 'Hay un dato incompleto o fuera de rango. Revisá el formulario.';
  }
  if (codigo === 'PGRST116') {
    return 'El registro no existe o no es de tu sector.';
  }
  if (/invalid login credentials/i.test(mensaje)) {
    return 'El correo o la contraseña no son correctos.';
  }
  if (/jwt expired|refresh token/i.test(mensaje)) {
    return 'La sesión venció. Volvé a ingresar.';
  }
  return mensaje.trim() || 'Algo salió mal. Probá de nuevo.';
}

// Para usar con los resultados de supabase-js: tira si vino error, devuelve los datos si no.
export function exigir<T>(res: { data: T | null; error: unknown }): T {
  if (res.error) throw res.error;
  return res.data as T;
}
