# DH1 v2 — Puesta en marcha

ERP de mantenimiento (órdenes de trabajo por QR, activos, ubicaciones y certificación de avance)
sobre Supabase + Next.js 15. El contexto completo y las decisiones cerradas están en `CLAUDE.md`.

## Qué hay en esta carpeta

| Archivo | Qué es |
|---|---|
| `dh1-v2-fundacion.sql` | Fase 1: sectores, perfiles, RLS por sector, ubicaciones, activos, OTs, máquina de estados, QR, KPIs |
| `dh1-v2-fase3-gestion.sql` | Preventivo, vistas `v_ordenes` y `v_expediente_activo`, `buscar()` |
| `dh1-v2-fase4-certificacion.sql` | Contratos, ítems, certificados, emisión, aprobación, rechazo |
| `dh1-v2-fase5-migracion.sql` | `id_origen` + `importar_certificado_historico()` |
| `app/` | La aplicación (Next.js), la edge function y el script de migración |
| `pruebas/` | Pruebas de aceptación del SQL sobre un Postgres embebido (no toca Supabase) |
| `guia-estilo-visual-dh1.md` | Guía de estilo aplicada en la app |

## Antes de tocar Supabase: probar el SQL en local

```bash
cd pruebas
npm install
npm test
```

Son dos tandas y las dos tienen que terminar en `0 fallaron`:

- **SQL (107 verificaciones):** carga los cuatro `.sql` en un Postgres embebido (PGlite), simula los
  roles de Supabase y prueba aislamiento por sector, perfil protegido, máquina de estados, historial,
  preventivo, certificación, importación histórica y los reenvíos de la cola sin señal.
- **Cola sin señal (35 verificaciones):** el motor que guarda el trabajo del operario en el teléfono y
  lo envía al volver la red. Necesita Node 23.6 o superior.

## Orden de puesta en marcha

Los `.sql` están pensados para un **proyecto de Supabase limpio**. Si el proyecto ya tiene tablas de
un intento anterior, hay que vaciar el esquema `public` antes (eso borra datos: decidirlo a conciencia).

1. SQL Editor → correr `dh1-v2-fundacion.sql`.
2. Correr `dh1-v2-fase3-gestion.sql`.
3. Correr `dh1-v2-fase4-certificacion.sql`.
4. Correr `dh1-v2-fase5-migracion.sql`.
5. Correr `dh1-v2-fase6-operacion.sql` (información general, pendientes SAP, emergencias, rutinas, calendario,
   calefacción, inspecciones).
   Y `dh1-v2-fase7-informe-ia.sql` (informe de inspección con IA en segundo plano). Después, una vez, con la
   dirección del proyecto: `select public.programar_reintento_informes('https://<ref>.supabase.co');`
   Y `dh1-v2-fase8-gente.sql` (empleados, fichaje, tablets de cuadrilla, horas de las órdenes, mapa).
   Y `dh1-v2-fase9-obras.sql` (proveedores, obras, cobro por ciclo, presupuestos, solicitudes de certificado,
   abonos del mes y el bucket privado `documentos`).
   Y `dh1-v2-fase10-panol.sql` (pañol: materiales, movimientos, préstamos de herramientas, requerimientos de compra,
   materiales de cada orden).
   Y `dh1-v2-fase11-control.sql` (auditoría, alertas, informes y reportes).
   Y `dh1-v2-fase12-administracion.sql` (riesgos, foro, sugerencias, búsqueda global, resumen de sectores).
   Y `dh1-v2-fase13-ajustes.sql` (numeración de a uno en solicitudes, requerimientos e informes; cantidades con su
   unidad legible).
   La fase 9 trae al principio una corrección de seguridad de la fase 4 (los ayudantes de la bandera de
   certificación ya no se pueden llamar sueltos, por ejemplo desde GraphQL).
   Siempre en ese orden y de a uno. Para no copiar y pegar archivos largos a mano:
   `node herramientas/abrir-en-supabase.mjs <ref>` abre el SQL Editor con el archivo exacto.
5. Storage: correr `dh1-v2-storage.sql` (crea el bucket `ot-fotos` público y sus 2 políticas).
6. Edge function:
   ```bash
   cd app
   npx supabase login
   npx supabase link --project-ref <ref-del-proyecto>
   npx supabase functions deploy invitar-usuario
   ```
7. `app/.env.local` (copiar de `.env.example`) con `NEXT_PUBLIC_SUPABASE_URL` y
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`. La `service_role` no va en este archivo.
8. Primer administrador: crear el usuario en Authentication → Users y después, en el SQL Editor:
   ```sql
   insert into public.perfiles (id, email, nombre, rol, sector_id)
   select u.id, u.email, 'Nombre Apellido', 'admin', s.id
     from auth.users u, public.sectores s
    where u.email = 'correo@del.admin' and s.clave = 'escuela';
   ```
   El resto de los usuarios se invitan desde la app (Gestión → Usuarios).
9. `cd app && npm install && npm run dev` → `http://localhost:3000` → ingresar → `/gestion`.
10. Migración desde la v1: ver `app/migracion/README.md`. Primero el simulacro, después `--apply`.

## Pruebas de aceptación contra el Supabase real

Lo que `pruebas/` verifica en local hay que repetirlo una vez contra el proyecto real
(lista completa en `CLAUDE.md` §7). Lo mínimo antes de cargar datos de producción:

- Un usuario común de `bapro` entra a `/mis-ots` y no ve nada de `escuela`.
- Un admin ve un solo sector por vez; con "ver todos", ambos.
- `update perfiles set sector_id = ...` como usuario común da error.
- Emitir un certificado que supera la cantidad de un ítem da error.
- Tres fotos seguidas desde un teléfono de gama media, sin error de memoria.
