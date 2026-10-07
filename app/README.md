# DH1 v2 — aplicación

Next.js 15 (App Router) + React 18 + `@supabase/ssr` + Tailwind 3 + PWA (`@ducanh2912/next-pwa`).

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # build de producción (genera el service worker en public/)
npm run lint     # chequeo de tipos (tsc --noEmit)
```

Hace falta `.env.local` con `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY`
(ver `.env.example`). Sin eso la app arranca y muestra el aviso de configuración.

## Mapa

```
app/login, app/mis-ots, app/ot/[id], app/q           portal del operario + destino de los QR
app/gestion/{page,ots,ots/nueva,activos,activos/[id],ubicaciones,usuarios}
app/gestion/certificacion/{page,[contratoId],[contratoId]/[certId]}
components/            Boton, Campos, EstadoBadge, Estados, OTCard, Checklist, FotoUploader, ScannerModal
components/gestion/    Nav, SectorSwitcher, BuscadorRemoto, QRImprimible, Tabla, FormContrato
lib/                   sesion, ot, gestion, certificacion, imagen, qr, errores, useCarga, types, supabase/client
middleware.ts          sesión y redirecciones
migracion/             migrar.ts (Deno) + README
supabase/functions/invitar-usuario/index.ts
```

Convenciones: las páginas son client components y no hay server actions. La app pide y muestra;
lo que se puede o no se puede lo decide la base (RLS y triggers). Los errores de Postgres pasan por
`limpiarError()` y se muestran con `sonner`. Todos los colores salen de los tokens de
`app/globals.css`; los textos visibles, en español de obra.

## Storage: bucket de fotos

Una sola vez, en el SQL Editor de Supabase:

```sql
insert into storage.buckets (id, name, public)
values ('ot-fotos', 'ot-fotos', true)
on conflict (id) do nothing;

-- Las fotos se guardan en <sector_id>/<ot_id>/<uuid>.jpg.
-- Solo se sube y se borra dentro de la carpeta del sector en el que está parado el usuario.
create policy "ot-fotos subir" on storage.objects for insert to authenticated
  with check (bucket_id = 'ot-fotos' and (storage.foldername(name))[1] = public.sector_efectivo()::text);

create policy "ot-fotos borrar" on storage.objects for delete to authenticated
  using (bucket_id = 'ot-fotos' and (storage.foldername(name))[1] = public.sector_efectivo()::text);
```

El bucket es público para lectura: las fotos se ven por URL (la ruta lleva dos UUID, no se adivina).
Si eso no alcanza, el paso siguiente es pasarlo a privado y servir las fotos con URL firmadas.

## Edge function `invitar-usuario`

Crea la cuenta de Auth y el perfil con rol y sector. Solo responde a un administrador.

```bash
npx supabase login
npx supabase link --project-ref <ref>
npx supabase functions deploy invitar-usuario
```

Usa `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY`, que Supabase inyecta sola
en el entorno de la función. Para que el correo de invitación lleve a la app, configurar en
Authentication → URL Configuration la URL del sitio.

## Edge function `informe-inspeccion`

Arma el informe técnico de una inspección y propone órdenes de trabajo a partir de ese informe.
Lo redacta Gemini (modelo `gemini-3.8-flash`, plan gratis de Google AI Studio). Si Gemini no está configurado,
se pasó del tope gratis, tarda demasiado o falla, el informe sale igual armado con una plantilla y la app avisa
por qué. Se puede volver a generar más tarde.

```bash
npx supabase functions deploy informe-inspeccion
npx supabase secrets set GEMINI_API_KEY=<clave de aistudio.google.com>
```

La clave también se puede cargar en el panel: Edge Functions → Secrets. `GEMINI_MODEL` (opcional) cambia el modelo.
En el plan gratis, Google puede usar lo que se le envía (notas y fotos) para mejorar sus productos; con facturación
activada, no. La función pide que no se guarde la conversación (`store: false`).
Lee y guarda con la sesión del usuario, así que valen la RLS de sector y los permisos de rol.

## Edge function `leer-contrato-pdf`

Lee con Gemini el PDF de un ADA, orden de compra o presupuesto y devuelve la cabecera y los ítems para el formulario
de contrato (Certificación → Nuevo contrato → arrastrar el PDF). No guarda nada: una persona revisa y guarda.
Compara la suma de los ítems con el total del documento (±0,5 %), marca los renglones que parecen subtotales y, si no
cuadra, ofrece pedirle a la IA que los corrija (como `extractADA` + `correctADAItems` de la v1).
El PDF se sube antes al bucket `documentos` (carpeta del sector) y la función lo baja con la sesión del usuario;
queda guardado con el contrato (`contratos.ada_pdf_url`). Solo gerencia. Usa el mismo `GEMINI_API_KEY`.

```bash
npx supabase functions deploy leer-contrato-pdf
npx deno test supabase/functions/leer-contrato-pdf/control.test.ts   # pruebas sin IA
```

## Planillas de Excel

Información general, Pendientes SAP y Calefacción importan planillas `.xlsx` (no `.xls` ni `.csv`: hay que
guardarlas como "Libro de Excel"). El archivo se lee en el navegador (`lib/excel.ts`) y la base decide qué se
crea y qué se omite. Todas las importaciones se pueden repetir sin duplicar.

## PWA

El service worker lo genera el build (Workbox). En desarrollo está desactivado.
No fuerza recargas: `reloadOnOnline` está en `false` para que el operario no pierda un reporte a medias.
Los iconos de `public/icons/` son provisorios.

## Trabajo de campo sin señal

El operario hace todo su trabajo con o sin señal: iniciar, marcar tareas, notas, fotos y finalizar.

- **Qué necesita:** haber abierto "Mis órdenes" con señal al menos una vez en el día. Ahí se guardan en el
  teléfono sus órdenes (y el portal mismo, vía service worker).
- **Qué pasa sin señal:** cada acción queda en una cola en el teléfono (IndexedDB), la pantalla muestra la
  orden como quedó y un aviso de "falta enviar". Las fotos se comprimen y se guardan ahí también.
- **Cuándo se envía:** sola, al volver la señal, al volver a la app y cada 30 segundos mientras quede algo.
  También con el botón "Enviar ahora".
- **Si la base rechaza algo** (por ejemplo, cancelaron la orden mientras tanto): la orden queda marcada
  "No se pudo enviar", con el motivo. Lo cargado no se pierde: se puede probar de nuevo o descartar.
- **Si se cierra la app a mitad del trabajo:** el checklist y las notas quedan como estaban (borrador local).
- **Solo con conexión:** aprobar, devolver, cancelar, y todo el panel de gestión.

Código: `lib/offline/motor.ts` (reglas, con pruebas en `../pruebas/offline.test.mjs`), `cola.ts`, `db.ts`,
`useCola.ts`. El portal es una sola página (`/mis-ots`; la orden abierta va en `?ot=`), para no depender
del servidor al navegar.

Para probarlo hay que usar el build (`npm run build && npm run start`): en `npm run dev` el service worker
está apagado.
