# DH1 v2 — Briefing para Claude Code

> Este archivo va en la raíz del proyecto como `CLAUDE.md`. Es el contexto completo: qué es el
> sistema, qué decisiones ya están tomadas (no reabrir), en qué estado está, qué falta, y cómo
> trabajar con Emanuel.

---

## 1. Qué es esto

**DH1** es un ERP de gestión de mantenimiento (escuelas, hospitales, bancos) que Emanuel construyó y
usa en producción en **Mejores Hospitales S.A.**, para el sector de mantenimiento. Núcleo del
negocio: **órdenes de trabajo (OTs) ejecutadas por operarios en campo vía QR, activos, ubicaciones,
y certificación de avance de obra**. DH1 **no factura ni cobra** — eso lo hace otro sector con su
propio sistema. Solo certifica y controla la certificación.

**DH1 v1** corre en **Base44** (React + funciones Deno + RLS de plantilla). Repo: `ema404x/DH1b44`.
Es la fuente de los datos a migrar. Su aislamiento multi-sector resultó estructuralmente frágil
(ver §6): por eso existe v2.

**DH1 v2** (este proyecto) es la reconstrucción sobre **Supabase (Postgres con RLS nativa) +
Next.js 15 + edge functions Deno**. El objetivo: mismo núcleo funcional, con las garantías en la base
de datos y no en el código de aplicación.

Emanuel es desarrollador full-stack independiente, autodidacta, técnico. Hablarle en **español
rioplatense (voseo)**, directo, sin edulcorar.

## 2. Decisiones de arquitectura CERRADAS (no reabrir sin que él lo pida)

1. **Aislamiento por sector estructural.** Cada tabla de negocio tiene `sector_id`; una sola política
   RLS para todas: `sector_id = sector_efectivo() OR ve_todos_sectores()`. La aplica Postgres a cada
   consulta. **Ninguna** rama especial, **ningún** `default` de sector, **ninguna** función que la
   saltee. Un registro sin sector no puede existir (trigger `estampar_sector` falla cerrado).
2. **Modelo B de sectores.** Cada usuario tiene UN sector (`perfiles.sector_id`, inmutable por él).
   El rol `gerente_general` y `admin` pueden cambiar su **sector activo** (`sector_activo_id`) solo
   vía `cambiar_sector_activo()`, uno por vez. **Nunca ven dos sectores mezclados.**
3. **Admin "ver todos"** es un toggle explícito (`perfiles.ver_todos`, vía `set_ver_todos()`), por
   defecto apagado. El admin trabaja dentro de un sector; ver todo es un acto consciente.
4. **Fail-closed siempre.** Sin sector → error, nunca "escuela" por defecto. La cadena `|| 'escuela'`
   está prohibida en todo el código.
5. **Un solo formato de QR**: `<origen>/q?t=<token opaco>`, para ubicaciones y activos. Se resuelve
   con `resolver_qr()` **dentro del sector del usuario**. Nada de múltiples formatos (v1 tenía 8).
6. **La base es la autoridad; el cliente muestra.** Máquina de estados de OT en trigger
   (`validar_transicion_ot`), checklist obligatorio para cerrar, fotos si `requiere_fotos`.
   Transición inválida = error de Postgres con mensaje claro; la UI lo muestra tal cual.
7. **OT: el que la inicia queda asignado SOLO si estaba libre** (decisión conservadora de Emanuel).
   Si ya tenía asignado, se respeta. Iniciar/finalizar: cualquier usuario del sector.
   Aprobar/rechazar/completar: solo gerencia o `jefe_sitio`.
8. **Certificación server-authoritative** (Fase 4): ítems de contrato con **id estable**; el cliente
   solo edita `med_presente_unidad`; `recalcular_certificado()` dispone anterior/acumulado/totales;
   `emitir_certificado()` **bloquea sobre-certificación** (por ítem y total), numera con **índice
   único parcial** por contrato (sin carrera), y sella. Emitido/aprobado **inmutables** (trigger con
   bandera `dh1.cert_fn`). **Quien emite no aprueba** (separación de funciones). Fuente única de lo ya
   certificado: el acumulado por ítem — **no existe "% pagado anteriormente"**.
9. **Historial de activos automático** (triggers): OT completada, cambio de estado, movimiento. Nadie
   lo carga a mano. Jerarquía padre/hijo mismo sector, sin ciclos.
10. **Mantenimiento preventivo**: `generar_ots_preventivas(dias)` crea OTs de activos por vencer,
    idempotente. (Idea tomada de UpKeep; es la #1 en valor.)
11. **Fotos comprimidas en el dispositivo** antes de subir (1600 px, ~0.8 JPEG), **de a una**,
    liberando bitmap y canvas. Resuelve el "memoria insuficiente" real de los operarios.
12. **Búsqueda remota** en combos (`buscar(tabla,q)` → 10 resultados). Nunca descargar tablas enteras
    para elegir un registro (v1 bajaba 1500 registros al abrir el form de OT).
13. **PWA con `@ducanh2912/next-pwa`** (Workbox, precache automático). Sin service worker a mano.
    **Sin recargas forzadas** al operario (podría perder un reporte a mitad).
14. **Guía de estilo** — REEMPLAZADA el 7/10/2026 por el aspecto de la v1 (ver "Aspecto y Órdenes de Trabajo de la v1"). Texto original: (`guia-estilo-visual-dh1.md`): tema oscuro azulado de DH1, tokens en
    `globals.css` + `tailwind.config.ts`, **cero colores hardcodeados**, Inter, **16 px base, nada
    bajo 14 px en móvil**, **controles ≥44 px (48 px en campo)**, icono + texto en todo estado (nunca
    color solo), **los cuatro estados** en cada vista (cargando/vacío/error/datos), **un solo botón
    primario por pantalla**, copy en lenguaje de obra.

## 2 bis. Alcance ampliado (decisión de Emanuel, 30/9/2026)

**v2 tiene que tener todas las funciones y lógicas de la v1**, no solo el núcleo. Se construye por tandas,
leyendo la lógica de cada módulo en el repo de la v1 (`ema404x/DH1b44`) y pasándola a v2 con las garantías
de §2 (sector, permisos y reglas en la base). Decisiones tomadas al ampliar:

- **Todo con login.** Las pantallas que en la v1 funcionaban sin sesión (fichar, ejecutar orden pública,
  portal tablet) en v2 exigen usuario. No se reabre §2.1.
- **Sin Facturación ni Finanzas.** DH1 certifica y controla; no factura ni cobra. Clientes, proyectos,
  presupuestos y cotizaciones sí entran.
- Lo que en la v1 sea código muerto, utilidades de una sola vez o bugs, no se copia: se anota y se le avisa.

Orden de las tandas:
1. **Operación** (construida el 30/9/2026, ver "Tanda 1" en §3): Rutinas, Calendario, Emergencias,
   Pendientes SAP, Inspección de colegio, Calefacción, Información general.
2. Gente y campo: ficha de empleados, fichaje por QR, portal tablet de cuadrilla, mapas.
3. Obras: proyectos, clientes, presupuestos de obra, certificación de obras, cotizaciones.
4. Pañol: inventario, materiales, movimientos, requerimientos de compra.
5. Control y reportes: exports Excel/PDF, informes y su calendario, control de riesgo, alertas,
   automatizaciones, auditoría.
6. Administración: permisos por rol configurables, seguridad (2FA, backups), importar datos,
   administración de sectores, foro, tutorial, notificaciones, buscador global.

## 3. Estado del proyecto

> El paquete original de las Fases 1–5 no estaba en la máquina de trabajo (solo este briefing). Se
> **reconstruyó completo el 30/9/2026** a partir de este documento, con el repo de la v1 como
> referencia. El SQL de esta carpeta es el vigente: **no coincide necesariamente con lo que se haya
> corrido antes en Supabase** con el paquete original (ver "Puesta en marcha").

### Paquete (Fases 1–5)
| Archivo | Qué es |
|---|---|
| `dh1-v2-fundacion.sql` | Fase 1: tablas, enums, RLS, triggers, máquina de estados, QR, KPIs (vistas), `cambiar_sector_activo`, `set_ver_todos` |
| `dh1-v2-fase3-gestion.sql` | Preventivo, vistas `v_ordenes`/`v_expediente_activo` (security_invoker), `buscar()` |
| `dh1-v2-fase4-certificacion.sql` | `contratos`, `contrato_items`, `certificados`, `certificado_items`, locks, `crear/recalcular/emitir/aprobar/rechazar_certificado`, vistas |
| `dh1-v2-fase5-migracion.sql` | `id_origen` en tablas + `importar_certificado_historico()` |
| `pruebas/` | Pruebas de aceptación del SQL sobre Postgres embebido (PGlite): `npm test` |
| `app/` | Next.js 15.5.26 + React 18.3.1 + @supabase/ssr. Portal operario (`/mis-ots`, `/ot/[id]`), gestión (`/gestion/*`), certificación (`/gestion/certificacion/*`), `/q`, `/login`, middleware de sesión |
| `app/supabase/functions/invitar-usuario` | Edge function Deno: alta Auth + perfil con sector (solo admin) |
| `app/migracion/migrar.ts` | Migración Base44→v2 en Deno. **Dry-run por defecto**, `--apply` para escribir, `--solo=` por entidad, `--desde=` para leer JSON exportados |
| `guia-estilo-visual-dh1.md` | Guía de estilo aplicada |

### Decisiones de implementación tomadas en la reconstrucción (revisables por Emanuel)
- **Roles** (`rol_usuario`): `admin`, `gerente_general`, `gerente`, `jefe_sitio`, `inspector`, `operario`.
  Gerencia = los tres primeros. "Validar" = gerencia + `jefe_sitio`.
- **Quién crea OTs**: gerencia o `jefe_sitio`. El operario no crea órdenes.
- **Escritura por rol** con el trigger `exigir_rol` (la RLS solo aísla por sector): ubicaciones,
  plantillas y contratos → gerencia; activos → gerencia o jefe de sitio; borrar → gerencia.
- **Únicas funciones SECURITY DEFINER**: `sector_efectivo()`, `ve_todos_sectores()`, `rol_actual()`.
  Leen el perfil propio (sin eso la política de `perfiles` se llamaría a sí misma). Todo lo demás
  corre con la RLS del usuario.
- **Mismo sector entre tablas** garantizado por claves foráneas compuestas `(id, sector_id)`.
- **Estado `obra` de la v1** no existe en v2: en la migración pasa a `en_progreso`.
- **Certificados**: un solo borrador por contrato. **Rechazar** devuelve el certificado a borrador y
  libera su número; solo se rechaza el último del contrato. Emite gerencia o jefe de sitio; aprueba
  y rechaza solo gerencia, y nunca quien lo emitió.
- **Sectores sembrados**: `escuela` y `bapro`. Los demás entran por la migración o por SQL.

### Verificado (30/9/2026 — Windows, node 24.18, npm 11.16)
- `pruebas/aceptacion.mjs`: **166 de 166** verificaciones pasan sobre PGlite con los `.sql` de las fases 1
  a 6 cargados en orden (aislamiento, perfil protegido, máquina de estados, historial, preventivo
  idempotente, certificación, importación histórica, reenvíos de la cola sin señal, y la operación:
  directorio, pendientes, emergencias, rutinas, calendario, calefacción, inspecciones).
- `pruebas/offline.test.mjs`: **35 de 35** sobre el motor de la cola sin señal (orden, fusión, corte
  de red, rechazos, reintento, descarte, vista local, validación adelantada).
- `npm install` OK; `npm run build` verde en Next 15.5.26 (17 rutas, middleware, service worker
  generado); `tsc --noEmit` limpio.
- `deno check` (Deno 2.9.6 vía `npx deno`) limpio en `migracion/migrar.ts` y en la edge function.
- Simulacro de migración corrido contra `migracion/ejemplo/` (datos inventados): reporta los
  sin-sector y no escribe.
- `npm audit --omit=dev`: 0 critical; 7 avisos (5 moderate, 2 high), todos de la cadena de build de
  `next-pwa`/workbox.
- En el navegador: `/login`, `/~offline` y el estado de error de `/mis-ots`.

### Supabase real: proyecto "DH1 v.2" (`akxfwaqfhslouvqneccd`), puesto en marcha el 30/9/2026
Estaba vacío. Hecho y verificado ahí mismo:
- Corridos en orden `fundacion`, `fase3`, `fase4`, `fase5` y `dh1-v2-storage.sql`, sin errores, con el
  contenido exacto de los archivos (hash comprobado en el editor antes de cada corrida).
- 12 tablas, todas con RLS activa; 6 vistas; 41 funciones; sectores `escuela` y `bapro`; bucket
  `ot-fotos` con sus 2 políticas; `anon` sin acceso a tablas ni funciones (la API responde 401/42501).
- Edge function `invitar-usuario` desplegada desde el editor del dashboard, con "Verify JWT with
  legacy secret" apagado (la función valida el token ella misma). Sin sesión responde 401.
- `app/.env.local` con la URL y la **clave publicable** (`sb_publishable_…`). La app abre el login sin errores.
- **Falta**: crear el primer administrador (usuario de Auth + fila en `perfiles`). El usuario y la
  contraseña los crea Emanuel; la fila de `perfiles` se inserta después por SQL (LEEME, paso 8).

### No verificado todavía
- **La app con datos reales**: ingresar, crear y ejecutar una orden, certificar, invitar un usuario,
  subir una foto al bucket. Depende de que exista el primer administrador.
- Las pantallas de gestión, la OT y la certificación compilan pero no se usaron con datos.
- "Emitir dos veces en paralelo": en local se verificó el índice único y el rechazo de la doble
  emisión en serie, no la concurrencia real (PGlite es de una sola conexión).
- La lectura por **API de Base44** (URL y cabecera `api_key`, sin probar). Alternativa: `--desde=`.
- Cámara, QR y PWA en un teléfono.
- **El trabajo sin señal de punta a punta en un teléfono real**: el motor de la cola y las reglas de la
  base están probados; falta la prueba de campo (modo avión → iniciar, tareas, fotos, finalizar →
  volver la señal → ver que llegó). Incluye comprobar que `/mis-ots` abre sin señal desde el service worker.

### Trabajo de campo sin señal (agregado el 30/9/2026)
Decisión de Emanuel: **el trabajo de campo en el teléfono tiene que ser perfecto**, con o sin señal.
- Todo el portal del operario vive en **una sola página** (`/mis-ots`; la orden abierta es `?ot=<id>` con
  `history.pushState`). No hay navegación que dependa del servidor. El service worker la precachea.
- `lib/offline/motor.ts` (lógica pura, probada), `cola.ts` (IndexedDB + envío a Supabase), `db.ts`,
  `useCola.ts`. `lib/ot.ts` es el único punto de escritura del operario.
- **Escribir**: con red y nada en espera, va directo (la base responde al momento). Sin red, o si se
  corta, queda en la cola del teléfono y se envía sola: al volver la señal, al volver a la app y cada
  30 s. Un solo envío a la vez (Web Locks).
- **Todas las operaciones son repetibles** (id y ruta de la foto se fijan en el teléfono): reenviar no duplica.
- **La base sigue siendo la autoridad.** Un rechazo no se pierde: la operación queda guardada con el
  motivo, la orden se marca "No se pudo enviar", y el operario elige probar de nuevo o descartar.
- **Borrador local**: checklist y notas se guardan en el teléfono a cada cambio; cerrar la app no pierde nada.
- **QR sin señal**: `v_ordenes` trae los tokens de QR; el lector busca primero en las órdenes guardadas.
- **Solo con conexión**: aprobar, devolver y cancelar (jefe de sitio/gerencia), gestión y certificación.
- Cada usuario envía solo lo suyo. Salir con cambios sin enviar avisa y no los borra.
- Límite conocido de una PWA: con la app cerrada no sincroniza (en iPhone nunca; en Android no es
  confiable). Se envía al abrirla con señal. Si eso no alcanza, el paso siguiente es Capacitor.

### Tanda 1: operación (agregada el 30/9/2026)
`dh1-v2-fase6-operacion.sql` + pantallas en `/gestion/{informacion,pendientes,emergencias,rutinas,calendario,calefaccion,inspecciones}`
+ `/emergencia` (reportar desde el portal de campo) + edge function `informe-inspeccion`. Lógica relevada módulo por módulo
en el repo de la v1. Corrida en el Supabase real (21 tablas, todas con RLS; 14 vistas) y función desplegada.

Qué se hizo distinto a la v1, a propósito:
- **Jefe de sitio e inspector por id de usuario**, no por nombre escrito. Lo importado sin usuario conserva el nombre
  (`*_nombre`) hasta que se lo enganche. `direcciones` → `ubicaciones` (`direccion_id`); cambiar el responsable de una
  dirección se propaga a sus ubicaciones en la misma transacción.
- **No existe "Edificio"** (era una copia de las escuelas): las rutinas cuelgan de `ubicaciones`.
- **Rutinas que sí generan órdenes**: la frecuencia sale del ciclo, una sola orden abierta por rutina y ubicación,
  la próxima fecha avanza al generar, y fuera de temporada espera al primer mes que corresponde. En la v1 los edificios
  sincronizados nunca generaban órdenes y todo se reprogramaba a 30 días.
- **Importaciones idempotentes** (directorio, pendientes SAP, calefacción): reimportar no duplica. El formato de la
  planilla de SAP se reconoce por el contenido, no por la comuna elegida. Una orden cerrada en SAP entra resuelta.
- **Historial de pendientes automático** (trigger), venga el cambio de donde venga.
- **Emergencia + su OT urgente en una sola transacción** (`reportar_emergencia`); la ve y la atiende el jefe del lugar;
  resolverla cierra su OT. Aviso en tiempo real (Supabase Realtime) a gerencia y jefes de sitio.
- **Calefacción por período**: selector de relevamiento (la v1 sumaba todos juntos), un solo umbral de estado
  (50 / 75 / 90), reemplazo del período en una transacción.
- **Calendario**: pide el rango del mes visible; suma las rutinas por vencer. Todavía no muestra informes (tanda 5).
- **Inspección**: 4 niveles de urgencia únicos; el informe lo redacta Gemini (`gemini-3.8-flash`, plan gratis; decisión de Emanuel del 30/9/2026: sin costo) desde la edge function, con una plantilla de respaldo que arma el informe sin IA si Gemini no está o falla (secreto `GEMINI_API_KEY`, opcional),
  con las primeras 10 fotos; las órdenes propuestas usan el informe completo (la v1 lo cortaba a 6000 caracteres).
  PDF por impresión del navegador. En el plan gratis Google puede usar lo enviado para mejorar sus productos
  (Emanuel lo aceptó); la función pide `store: false`. La API de Gemini que se usa es la de `interactions`.
  Verificado en vivo el 30/9/2026 con la clave cargada: informe redactado por Gemini y órdenes propuestas por Gemini.
  En el plan gratis Google responde 503 "high demand" seguido (3 de 4 intentos ese día): la función prueba con
  `gemini-3.5-flash-lite` de reserva.
  **Fase 7 (`dh1-v2-fase7-informe-ia.sql`, corrida en el Supabase real el 30/9/2026)**: el informe sale al instante por
  plantilla y la redacción con IA va en segundo plano (`EdgeRuntime.waitUntil`); cuando sale reemplaza a la plantilla
  (la pantalla mira cada 15 s). Si no sale, la tarea `dh1-informes-ia` de `pg_cron` llama cada 10 min a la función
  (`accion: "reintentar"`, sin sesión, con la clave de servicio) solo si hay pendientes; `tomar_informes_pendientes`
  decide cuáles y espacia los intentos (10, 20, 40… tope 6 h, 12 intentos). Un token por pedido evita que una
  redacción vieja pise un informe nuevo. Verificado en vivo: informe instantáneo, reemplazo solo por la versión con IA
  (~3 min), tarea programada y corriendo, permisos. **No verificado en vivo**: el camino completo del reintento por
  la tarea periódica (pendiente → cron → función → IA), porque ese día Gemini respondió al primer intento.

No copiado (muerto o roto en la v1): entidades `DireccionMapa`/`EscuelaMapa`, 7 componentes sin montar de Información
general, `importarPendientesSAPMultiple`, `PendientesImportModal`, `can_delete_pendientes`, las categorías vacías
"Electricidad" y "Plomería" de Calefacción, la pestaña estática "Anexo 3" (el catálogo de rutinas la reemplaza),
la vista de tarjetas y la edición rápida de Pendientes (queda la tabla con su formulario).

**Recorrida con datos reales (30/9/2026, sesión de Emanuel, Supabase real, `npm run dev`)** — todo lo que sigue se
usó de punta a punta y funcionó: tablero y preventivo (generar dos veces no duplica); ubicación + QR; orden nueva →
iniciar → finalizar → aprobar; emergencia → atender → resolver (con su orden); rutinas (catálogo → sincronizar →
procesar → generar orden → ejecutada); calendario; pendientes (alta, cambio de estado, historial automático,
importación de planilla); información general (importación de planilla, direcciones y jefe heredado); calefacción
(importación, tablero, alertas, detalle); inspección (alta, sección con autoguardado; "Generar informe" avisa que
falta la clave); activo + expediente + historial de estado; certificación (contrato → certificado → la base rechaza
la sobre-certificación → emitir N° 1 → "lo emitiste vos, lo aprueba otro"); usuarios (solo la lista).
Las tres importaciones se probaron con planillas inventadas (`pruebas/planillas/generar.mjs`), no con las reales.
Corregido en la recorrida: "Iniciar trabajo" quedaba colgado esperando el permiso de ubicación (tope de 4 s);
avisos que tapaban pestañas y botones (ahora abajo a la derecha en pantalla grande); contador de zona de Pendientes
que mostraba los vencidos en vez del total; plurales ("1 órdenes"); título del calendario; barras de desplazamiento;
la sección abierta del menú lateral queda a la vista.
En el proyecto real quedaron **datos de prueba, todos con el prefijo PRUEBA** (2 ubicaciones, 2 direcciones, las órdenes hasta la OT-000005,
1 emergencia, 1 rutina con su asignación y orden, 3 pendientes, 3 registros de calefacción, 1 inspección, 1 activo,
1 contrato con su certificado N° 1 emitido). **Borrados el 30/9/2026 con el OK de Emanuel** (quedan solo sectores y
su perfil; las secuencias de numeración se reiniciaron: la primera orden real es OT-000001).

Sigue sin verificar de la tanda 1: las **planillas reales** de Excel (SAP, calefacción, direcciones y jefes), el aviso
en tiempo real con dos usuarios, el dictado por voz, la generación del informe (falta la clave), invitar un usuario,
aprobar un certificado con un segundo usuario, y subir fotos desde un teléfono.
Punto abierto: marcar a mano como ejecutada la única rutina de una orden de trabajo `[Rutinas]` no cierra esa orden
(al revés sí: completar la orden ejecuta sus rutinas). Decidir si debe cerrarla o cancelarla.

### Tanda 2: gente y campo (construida el 30/9/2026)
`dh1-v2-fase8-gente.sql` + `/gestion/empleados` (personal, fichajes, tablets), `/gestion/mapa` (lugares, fichajes,
órdenes), `/cuadrilla` (fichar a la gente), fichaje propio en `/mis-ots`, horas en `/ot/[id]`, búsqueda de
direcciones en `lib/geocodificar.ts`, paso `gente` en la migración. Lógica relevada en la v1 (Employee, AttendanceLog, TimeLog,
Tablet, LocationQR/LocationData, páginas Employees, Fichar, FicharUbicacion, PortalTablet, Mapa, MapaJefes).

Decisiones (las marcadas con ★ las tomó Emanuel):
- ★ **Datos reservados de la ficha** (DNI, costo por hora, contacto de emergencia, notas) en `empleados_reservado`:
  los lee gerencia y el propio empleado. Es una excepción a la política única de §2.1, con el sector siempre primero.
- **Fichajes con GPS**: los lee quien valida, el propio empleado, quien lo registró y la tablet de su cuadrilla (misma
  excepción, en el espíritu de la decisión anterior; en la v1 los leía solo el admin y quien los creó). Revisable.
- **Fichar con login** (decisión de ampliación): cada uno ficha con su usuario; ya no hay QR por empleado ni fichaje
  escribiendo el nombre. Quien no tiene usuario lo ficha la tablet de su cuadrilla, su jefe de sitio o gerencia, y
  queda anotado quién. Sin firma dibujada (la v1 la pedía porque no había login).
- **Un solo QR** (§2.5): el del lugar sirve para ver sus órdenes y para fichar ahí. El lugar del fichaje sale del QR
  o del lugar más cercano dentro del radio del sector (300 m); si está lejos se marca, no se bloquea. No se manda la
  posición a un servicio de terceros para "adivinar la dirección" (la v1 lo hacía con cada fichaje).
- **Fichaje sin señal**: la marca queda en el teléfono (localStorage) con su hora y un id propio, y se envía sola;
  la base acepta hasta 3 días atrás (más viejas, gerencia). Doble toque = una sola marca.
- **Tablet de cuadrilla**: un usuario propio (rol operario) atado a un jefe de sitio, en vez del código de activación.
  En `/mis-ots` ve las órdenes de los lugares de ese jefe (sirve sin señal, igual que el portal) y en `/cuadrilla`
  ficha a la gente cuyo jefe de sitio es ese.
- **Personal asignado a un lugar** por id (`ubicacion_empleados`), no por lista de nombres.
- **Horas por orden** (`ot_horas`, ex TimeLog): cualquiera del sector carga; cambia o borra quien cargó, jefe o
  gerencia; el costo (horas × costo por hora) solo lo ve quien puede leer el costo.
- **Mapa**: Leaflet directo (sin react-leaflet: con React 19 en desarrollo creaba dos mapas sobre el mismo
  elemento) y teselas de OpenStreetMap oscurecidas con un filtro (las de CARTO ahora piden clave). Semáforo por lugar
  calculado en la base (`v_mapa_ubicaciones`), por id y no por parecido de nombre como en la v1. Ubicar por dirección
  con Nominatim **desde el navegador** (desde las funciones de Supabase Nominatim responde 403; se probó y se borró la
  función), de a uno por segundo y recordando los que no se encontraron; ubicar o corregir a mano tocando o
  arrastrando (gerencia).
- No copiado: "Asignación automática" de empleados (copiaba a la ficha los lugares del jefe; en v2 se calculan),
  "Sincronizar empleados" (ahora el enganche ficha-usuario por correo es automático, con un botón para hacerlo en
  lote), el modo "cluster" del mapa de jefes (queda colorear por jefe o por zona), el tablero de proyectos del mapa
  (llega con la tanda 3), el contador de escaneos del QR y la subida pública de archivos de `publicFichar`.

Verificado: pruebas del SQL 243/243 (43 nuevas de la tanda 2), cola sin señal 35/35, `tsc`, `deno check` y `build`
verdes, simulacro de migración con datos de ejemplo. `dh1-v2-fase8-gente.sql` corrido en el Supabase real el 30/9/2026
(hash comprobado; tablas con RLS, políticas, vistas, permisos y configuración consultados después).
En vivo, con la sesión de Emanuel: alta de empleado con datos reservados (se guardan y se leen), fichaje propio desde
Mis órdenes, fichaje de otra persona desde `/cuadrilla`, jornadas en Empleados → Fichajes, horas en una orden con su
costo, mapa (ubicar por dirección, detalle del lugar, sumar personal, pestaña de órdenes).
**No verificado en vivo**: la tablet de cuadrilla (hace falta un segundo usuario), la invitación desde la ficha, el
fichaje sin señal en un teléfono, el fichaje con GPS y el marcado de "lejos", arrastrar una marca en el mapa.
Los datos de prueba de esta recorrida se borraron el 30/9/2026 con el OK de Emanuel (la base quedó con sus 2 sectores
y su perfil; numeraciones reiniciadas).

### Tanda 3: obras (construida el 30/9 y 1/10/2026)
`dh1-v2-fase9-obras.sql` + `/gestion/obras` (planilla de obras con ficha: datos, documentos, órdenes, cobro),
`/gestion/cobros` (tablero de cobro por ciclo, hoja por comuna para imprimir), `/gestion/solicitudes`,
`/gestion/presupuestos`, `/gestion/proveedores`, panel "Abonos del mes" en `/gestion/certificacion`, obra en la
orden nueva, lectores de planilla en `lib/excel.ts`, datos en `lib/obras.ts`, paso `obras` en la migración.
Lógica relevada en la v1 (Project, Client, ObraCertificacion, SolicitudCertificado, PresupuestoExcel, AbonoMaestro;
páginas Proyectos, Clientes, Presupuestos Obra, Certificación de Obras, Aprobación de certificados, Abonos).

Decisiones (revisables por Emanuel):
- **Obras con columnas de verdad**: comuna, jefe, inspector y detalle ya no van dentro de las notas. Clave de la
  planilla: N° de orden SAP (único por sector; en la v1 se repetía); sin número, el título normalizado. Reimportar
  actualiza sin borrar lo que la planilla trae vacío (en la v1, cambiar el título en SAP creaba otra obra).
- **Cobro por ciclo** (ex "Certificación de obras"): un ciclo abierto por sector; cerrar es atómico y pasa al ciclo
  nuevo lo que sigue en curso (la v1 archivaba fila por fila y dejaba el tablero vacío). Historial automático por
  trigger. "Observado" exige motivo. Importar por MTOM ya no se saltea obras que estuvieron en ciclos anteriores.
- **Solicitudes de certificado**: máquina de estados en la base; nadie aprueba lo que pidió (en la v1 sí); rechazar
  pide motivo; cambiar de estado no toca lo pedido.
- **Abonos del mes**: `certificar_abonos_del_mes` crea y emite el certificado de cada contrato de abono vigente con
  cantidad ÷ meses de vigencia; el último mes completa el saldo; no repite un período; cada contrato independiente.
  Reemplaza `generarLoteAbonos`. Los AbonoMaestro migran a contratos de abono (o completan fechas del existente).
- **Presupuestos**: repositorio de planillas con estado (lo único vivo de la v1). Bucket privado `documentos`
  (`<sector>/...`, enlaces firmados de 5 minutos). Los documentos de la v1 migran como enlace a Base44.
- **Alerta de plazo** (estaba escrita en la v1 pero no se mostraba): avance esperado por días transcurridos.
- No copiado (código muerto en la v1): Cotizaciones, el motor de presupuesto por ítems PCP/PAPORC, el plan de
  trabajos, ProjectAlerts como pantalla y la importación de preciario.

Verificado (1/10/2026): pruebas del SQL 296/296 (53 nuevas), cola sin señal 35/35, `tsc`, `deno check` y `build`
verdes, simulacro de migración con datos de ejemplo, lectores de planilla corridos contra
`pruebas/planillas/prueba-obras.xlsx` y `prueba-cobros.xlsx`.
**Pendiente: correr `dh1-v2-fase9-obras.sql` en el Supabase real** (el permiso automático lo bloqueó; necesita el OK
explícito de Emanuel en el momento) y recorrer las pantallas en vivo.

### Tanda 4: pañol (construida el 1/10/2026)
`dh1-v2-fase10-panol.sql` + `/gestion/panol` (stock con ficha y movimientos, libro de movimientos, importación del
catálogo), `/gestion/prestamos`, `/gestion/requerimientos`, materiales en `/ot/[id]` (`components/MaterialesOT.tsx`),
datos en `lib/panol.ts`, lector `leerCatalogoMateriales` en `lib/excel.ts`, paso `panol` en la migración. También
`/gestion/plantillas` (alta y edición de plantillas de OT, pendiente de §4). Lógica relevada en la v1: una sola
pantalla `/inventario` (Stock, Movimientos, Requerimientos) con Material, MovimientoPanol y RequerimientoCompra.

Decisiones (revisables por Emanuel):
- **El stock lo mueve solo la base** (`registrar_movimiento`, con la fila del material bloqueada): nunca negativo, sin
  "clamp" a cero que esconda errores, y el stock no se edita a mano. En la v1 lo escribía el navegador en dos pasos con
  el número que tenía en memoria, y por la RLS solo el admin podía operar. Ahora operan gerencia y jefes de sitio.
- **Movimientos inmutables** (un error se corrige con un ajuste); alta con stock = movimiento de "stock inicial";
  **inventario físico** = ajuste por la diferencia; **costo promedio ponderado** en cada compra con costo.
- **Préstamo de herramientas (nuevo, no existía en la v1)**: materiales marcados como "se presta"; préstamo con
  persona y fecha de devolución, vuelta al stock, o "perdida" (decide gerencia; el stock no vuelve).
- **Requerimientos de compra** con circuito en la base (nadie aprueba lo que pidió, rechazar pide motivo, a compra con
  N° de OC) y **recepción que suma stock** (parcial o total; en la v1 "recibido" no movía nada). Numeración por
  secuencia (en la v1 `REQ-` + conteo, que se repetía). Los ve todo el sector (en la v1 solo quien lo pidió y el admin).
- **Materiales de la orden** (`ot_materiales`): cualquiera anota; gerencia o jefe "saca del pañol" (descuenta) y al
  quitarlo vuelve al stock. Costo de materiales por obra en `v_consumo_obra`.
- **Importación del catálogo** sin duplicar (por código o nombre), columnas tomadas una sola vez (en la v1 "Stock mínimo"
  se leía como stock y "1.5" como 15; `num()` de `lib/excel.ts` corregido para todos los importadores).
- No copiado: el "IA" cosmético del importador, `LowStockAlert`, `OTEjecucionModal`, `ValidacionJefePanel`,
  `WorkOrderCostSummary` (muertos), los campos de requerimiento que nada escribía.

Verificado (1/10/2026): pruebas del SQL 354/354 (58 nuevas del pañol), `tsc`, `deno check`, `build`, simulacro de
migración. **Pendiente: correr `dh1-v2-fase10-panol.sql` en el Supabase real (después de la fase 9) y recorrer en vivo.**

### Tanda 5: control y reportes (construida el 1/10/2026)
`dh1-v2-fase11-control.sql` + `/gestion/alertas`, `/gestion/reportes`, `/gestion/informes`, `/gestion/auditoria`
(solo gerencia), sección "Para atender" en el tablero, contador de alertas en el menú (que ahora está agrupado por
tema), informes y devoluciones en el calendario, gráficos livianos en `components/gestion/Graficos.tsx`, datos en
`lib/control.ts`, paso `control` en la migración. Lógica relevada en la v1: Dashboard, Reportes, Automatizaciones,
Alertas Proactivas (checkAlertas/AlertaLog/AlertaConfig), Auditoría (autoLogAudit/AuditLog), Informes, Calendario.

Decisiones (revisables por Emanuel):
- **Auditoría por triggers** en las tablas importantes (`auditar()`): alta/cambio/baja con quién, su rol y el antes y
  después de cada campo; inmutable; **la lee solo gerencia** — excepción a la política única de §2.1 (como
  `empleados_reservado`), con el sector primero. No se audita lo que hace la migración (sin usuario). En la v1
  `autoLogAudit` no pedía login (se podían cargar registros falsos) y el admin podía editar o borrar la auditoría.
- **Alertas calculadas al momento** (`v_alertas`): órdenes y pendientes vencidos, garantías, mantenimiento, stock,
  préstamos, obras con el plazo en riesgo, emergencias abiertas y repetidas, informes vencidos, compras atrasadas.
  Umbrales por sector (`sectores.config.alertas`, los de la v1 por defecto; los cambia un admin). "Ya la vi" por
  persona por 7 días. Reemplaza `checkAlertas` + `AlertaLog` (que se disparaba sin login con un encabezado y
  re-alertaba todos los días). **No hay mails**: hace falta un proveedor de correo (decisión de Emanuel).
- **Reportes en la base** (`reporte_operacion`): una sola definición de eficiencia (completadas ÷ (todas −
  canceladas)), MTTR, antigüedad, backlog, por zona/tipo/prioridad/operario, horas, materiales por obra, emergencias,
  ranking de jefes (la fórmula de la v1, por id). Imprimible. En la v1 los números dependían del orden en que se
  abrían las pantallas (caché compartido con límites distintos).
- **Informes** (ex Informe): estados sin "vencido" guardado (se calcula), firma requerida/obtenida, archivos.
- No copiado: Centro de Seguridad (sesiones, backups y cifrado eran de mentira), `AutomationControl` (no hacía nada),
  `Notification` (nunca se creaba), push sin suscripción, exportes PDF muertos, Planificación de informes
  (`InformePlaneacion`, con columnas atadas a 2025/2026: pendiente de decisión), uso de la app (`AppUsageLog`),
  resumen semanal por mail (necesita proveedor de correo).

Verificado (1/10/2026): pruebas del SQL 383/383 (29 nuevas), `tsc`, `deno check`, `build`, simulacro de migración.
**Pendiente: correr `dh1-v2-fase11-control.sql` en el Supabase real (después de la 10) y recorrer en vivo.**

### Tanda 6: administración y faltantes (construida el 1/10/2026)
`dh1-v2-fase12-administracion.sql` + `/gestion/riesgos` (matriz probabilidad × consecuencia, editable, con las 5
reglas de oro), `/gestion/foro`, `/gestion/sugerencias`, `/gestion/sectores` (solo admin), `/gestion/perfil`
(datos, firma, contraseña), `/gestion/ayuda`, búsqueda global Ctrl+K (`components/gestion/BuscadorGlobal.tsx`,
`buscar_todo`), orden imprimible `/ot/[id]/imprimir`, edición de ubicaciones y de contratos con sus ítems, firma al
aprobar certificados, plantillas de OT, paso `admin` en la migración. Foro, sugerencias, perfil y ayuda los ve también
el operario (con un marco simple; links desde Mis órdenes). Comparación completa de pantallas v1↔v2 hecha.

Decisiones (revisables por Emanuel):
- **No copiado a propósito**: el editor de permisos por rol × módulo (`/permisos`): en v2 los permisos los aplica la
  base por rol (§2) y un editor en pantalla mentiría; los **portales anónimos** (`/ejecutar-ot`, `/portal-operario`,
  `/fichar-ubicacion`, `publicFichar` sin login: el agujero más grave de la v1) — en v2 todo va con usuario; el
  **importador genérico** `/importar` (escribía como service role en cualquier tabla): v2 tiene importadores por
  módulo; el chatbot "Alice" (se puede sumar más adelante con un proveedor de IA); el Centro de Seguridad (falso).
- **Foro** simplificado: temas, anuncios (gerencia), fijar/cerrar (gerencia), respuestas, "nuevo" por persona. Sin
  encuestas, reacciones ni menciones (en la v1 no funcionaban para quien no era admin).
- **Sugerencias** reemplaza al mail a una casilla personal: quedan guardadas y las responde el admin.
- Pendientes de decisión: tablero Kanban de órdenes, `InformePlaneacion`, mapa de cobertura por jefe con importación.

### Revisión de seguridad de las fases 9 a 11 (1/10/2026)
Una revisión independiente del SQL encontró 22 puntos; todos corregidos y con prueba propia (sección 13):
- **Altos**: (1) y (2) un operario podía reescribir un movimiento de stock o un préstamo "limpiando" una referencia
  (la excepción para cascadas aceptaba cualquier cambio) → ahora solo dentro de una cascada real (`pg_trigger_depth`)
  y sin tocar otra columna. (3) los ayudantes `panol_on`/`cert_fn_on` (y sus `restore`) se podían llamar sueltos; con
  **GraphQL** (pg_graphql, activo por defecto en Supabase) un pedido puede encadenar operaciones en una transacción →
  ahora se niegan a correr si no los llama otra función de la base (`pg_context`). La corrección de `cert_fn_*`
  (fase 4, ya en producción) va al principio de la fase 9.
- **Medios y bajos**: carrera en abonos del mes (bloqueo previo); ajuste de stock con bloqueo; la auditoría registra
  el sector anterior (cambio de sector de un usuario); el responsable de un informe no se lo aprueba ni corre la
  fecha; la obra de una OT la cambian solo gerencia/jefes; cascadas que bloqueaban borrar obras; reimportar la
  planilla ya no pisa el estado; borrar archivos del bucket solo gerencia/jefes; ciclos de cobro con transiciones
  protegidas y sin borrar los cerrados; obras con historia de cobro no se borran; números (SOL/REQ/INF) no
  elegibles por el cliente; sellos de solicitud; "ya la vi" ajena; materiales en órdenes cerradas; tope de
  recepción; reset de lo aprobado al volver a borrador; FKs del movimiento al requerimiento/préstamo; ruido de
  auditoría de tablets; umbrales con decimales; abonos en cualquier orden de meses.

Verificado (1/10/2026, al cierre de la noche): pruebas del SQL **425/425**, cola sin señal 35/35, `tsc`, `deno check`,
`build`, simulacro de migración con todos los pasos.
**Fases 9, 10, 11 y 12 corridas en el Supabase real el 2/10/2026** con el OK de Emanuel, en orden y con el hash
comprobado en la página. Verificado después por consulta: 21 tablas nuevas, todas con RLS; funciones, vistas, bucket
`documentos`, 19 triggers de auditoría, umbrales de alertas en los 2 sectores. `pg_graphql` no está instalado en el proyecto.
**Recorrido en vivo hecho el 2/10/2026** con datos "PRUEBA" en el sector escuela: obras, cobros, solicitudes,
presupuestos, proveedores, pañol, préstamos, requerimientos, OT con materiales e impresión, informes, alertas,
reportes, auditoría, calendario, riesgos, foro, sugerencias, sectores, perfil, ayuda, plantillas, búsqueda global,
edición de contrato y abonos del mes. Funcionó todo; lo que apareció:
- Arreglado en la app: tramo "Completo" con 0 % (ahora "Sin avance"), plurales del resultado de importar cobros,
  hora "a. m." en historiales (ahora 24 h), unidades sin plural en `cant()` ("3 unidades"), estado crudo en la
  búsqueda global, aviso verde de "0 certificados emitidos" (ahora informativo).
- `dh1-v2-fase13-ajustes.sql` (pruebas 433/433; **corrida en el Supabase real el 2/10/2026**, hash verificado y
  consulta de control OK): SOL/REQ/INF gastaban dos números
  por alta (default + trigger) → la columna queda sin default y numera el trigger (el servicio, uno previo);
  `cantidad_txt()` para la unidad legible en la alerta de stock, el error de stock y los buscadores.
- `herramientas/limpiar-recorrido-prueba.sql`: borra los datos PRUEBA de escuela (probado en local: 0 huérfanos,
  bapro intacto). **Corrida el 2/10/2026** (la pegó Emanuel en el SQL Editor: el permiso automático frena borrados
  masivos aunque esté el OK): control en 0, queda 1 perfil; el bucket `documentos` quedó vacío (archivos quitados
  antes desde la app). La app muestra escuela vacía.

### Puesta en marcha — orden (LEEME.md)
0. `cd pruebas && npm install && npm test` (local, no toca Supabase).
1. `dh1-v2-fundacion.sql` → 2. `fase3` → 3. `fase4` → 4. `fase5` (SQL Editor, en orden, uno por
   vez), sobre un proyecto **limpio**.
5. Bucket `ot-fotos` público + 2 políticas (bloque en `app/README.md`).
6. `npx supabase link --project-ref <ref>` → `npx supabase functions deploy invitar-usuario`.
7. `.env.local` con `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY` reales.
8. Primer admin: usuario en Auth + fila en `perfiles` (rol `admin`, `sector_id` de `escuela`).
9. `npm run dev` → login → `/gestion`.
10. Migración: `deno run -A migracion/migrar.ts` (dry-run) → revisar reporte → `--apply`.

**Según el briefing original, Emanuel ya había corrido los pasos 1 y 2 con el paquete anterior. Como
el SQL se reescribió, hay que confirmar con él si se arranca en un proyecto nuevo o se vacía el
esquema `public` del existente (borra datos: pedir OK). Preguntale en qué paso está antes de asumir.**

## Certificados idénticos a la v1 (7/10/2026)
Emanuel pidió que Certificados sea **idéntico al 100 % a Base44**. Decidió (pregunta explícita): **igual en pantalla y
flujo, con las reglas de la v2 por debajo** (numera la base, emitido/aprobado no se tocan ni se borran, no se
certifica de más, la firma del gerente es la de quien aprueba). Se replicó desde el código de la v1:
`pages/Certificados.jsx`, `CertificadoEditor`, `CertificadoPreview`, `CertificadosLista`, `HistorialAcumulados`,
`FirmaJefeSitioModal`, `UploadADA`, `AbonoManualForm`, `GeneracionMasiva`, `CertificadosAutomatizados`,
`AbonoMaestroPanel/Card/Form/RubrosGrid`, `CertificacionMensualDialog` y `utils/exportCertificadoPDF.js`.
- SQL `dh1-v2-fase14-certificados-v1.sql` (pruebas 458/458, sección 16). **Corrida en el Supabase real el 7/10/2026** con
  el OK de Emanuel (hash verificado, consulta de control OK). Emisión automática SIN programar (decisión: después de probar).
- App: `app/gestion/certificacion/page.tsx` (la página de la v1), `components/certificados/*`, `lib/certificados.ts`,
  `lib/pdfCertificado.ts` (jsPDF, mismo formato; logo copiado a `public/certificados/mejores-logo.jpg` porque el de la
  v1 está en los servidores de Base44). Las páginas viejas por contrato (`/gestion/certificacion/[contratoId]`) siguen.
- Solicitudes: con un certificado emitido vinculado, aprobar pide la firma del gerente y aprueba los dos.
- Diferencias a sabiendas (reglas v2): N° de certificado lo pone la base al emitir; "Monto contratado" es la suma de los
  ítems; anticipo/fondo de reparo en % van sobre lo certificado del período (la v1 los tomaba del total del contrato
  en cada certificado) o como monto fijo; "Regenerar" solo rehace borradores; los emitidos no se borran.
- Errores de la v1 que no se copiaron: números repetidos, fechas UTC, `parseMonto` que multiplicaba por 100.

## Aspecto y Órdenes de Trabajo de la v1 (7/10/2026)
Emanuel: "hay que pulir las ordenes de trabajo, todo tiene que ser idéntico a dh1 de base44", y eligió copiar **también el
aspecto** de la v1 en toda la app (reemplaza la guía de estilo de la v2). Mismo criterio que Certificados: **pantalla de la
v1, reglas de la v2**. Fuente: el clon actual de la v1 (GitHub ema404x/DH1b44, 6/10/2026); la copia local del 31/7 está vieja.
- Tema: `globals.css` y `tailwind.config.ts` traen el `index.css`/`tailwind.config.js` de la v1 (colores shadcn, paleta
  completa de Tailwind, `tailwindcss-animate`). Los tokens de la v2 (fondo, superficie, primario…) siguen y apuntan a la
  misma paleta. Ojo: en la v1 clases como `border-white/8` NO generan nada (Tailwind 3 no las conoce); se copian literales
  para que quede igual.
- Componentes de interfaz de la v1 (shadcn, JavaScript) en `components/ui/*.jsx` con `.d.ts` laxos al lado
  (`tsconfig` con `allowJs`). `lib/utils.ts` (`cn`), `hooks/use-mobile.jsx`.
- Marco: `components/layout/` (Sidebar "DH1 Software Platform" con los grupos de la v1, barra superior, encabezado y barra
  inferior del teléfono). Sin animación de entrada de página: el `transform` que deja rompe los paneles fijos.
- Órdenes: `app/gestion/ots/page.tsx` = `pages/WorkOrders.jsx` (Kanban/Grilla, tarjetas de totales, Filtros, Campo,
  Historial, Plantillas, QR); `components/ordenes/` (piezas, extras, secciones, DetallePanel = WorkOrderDetailPanel con
  autoguardado); `lib/tablero.ts` (máquina de estados v1 → updates de la v2). Especificación completa: `ESPEC-OT-v1.md`.
- Diferencias a sabiendas (reglas v2 o falta de columna): no existe el estado "Obra"/Futura Obra (columna y tarjeta quedan
  en 0, no hay botón "Obra"); no hay "Completar" desde cualquier estado (solo aprobar desde Validación); el responsable se
  elige de la lista de usuarios (no texto libre); "archivadas" = completadas hace más de 30 días (calculado); "vencida" en
  el tablero usa la regla de la v1 (en progreso con fecha pasada); sin firma en la orden (no hay columna); el QR es el de la ubicación (o el enlace a la orden). Sin tiempo real: recarga cada 30 s.
- Crear OT (`app/gestion/ots/nueva`) = CrearOT de la v1: Activo → Detalle → Materiales, Futura Obra (crea un pendiente tipo obra), dictado por voz, 5 Reglas de Oro, fotos de referencia (se suben al crear). Sin persona elegida queda a cargo el jefe de sitio de la ubicación del activo. A diferencia de la v1, la plantilla también copia el checklist.
- Mis Órdenes (`app/mis-ots`) = PortalOperarioApp de la v1 (secciones En Progreso / Para Empezar / Enviadas al Jefe, filtros,
  Historial, confirmación de inicio, Reporte de Cierre `components/operario/ReporteForm.tsx`) sobre el motor sin señal de la v2.
  El Reporte suma checklist y motivo (la v2 los exige); los faltantes viajan en la cola (`Ejecucion.materiales_faltantes`);
  los materiales usados se cargan en `ot_materiales` con señal y, sin señal, quedan escritos en las notas. Se mantienen
  fichaje, cuadrilla y "Reportar una emergencia". Con sesión, la pantalla va dentro del marco de la v1; el operario ve el menú
  recortado (Mis Órdenes, Emergencias → /emergencia, Foro, Sugerencias, Ayuda) y no ve el buscador.
- PDF de la orden: `lib/pdfOT.ts` = exportWorkOrderPDF de la v1 (botón del panel). Logo de la v1 desde Base44; si no carga, el de `public/certificados`. "En validación" tiene su color (en la v1 caía en PENDIENTE).
- Falta: portales públicos sin login (choca con decisión cerrada: el operario entra con su usuario).

## 4. Lo que falta (fuera de las 5 fases, en orden de valor)
**La lista completa y priorizada contra la v1 está en `INVENTARIO-v1-v2.md` (relevada el 7/10/2026).** Va primero.

En curso (7/10/2026): **carga del ADA / orden de compra desde el PDF con IA** (punto 1 del inventario).
Edge function `leer-contrato-pdf` (Gemini gratis, mismo `GEMINI_API_KEY` que el informe; lee el PDF ya subido al
bucket `documentos` con la sesión del usuario, solo gerencia; no guarda nada) + `FormContrato` (arrastrar el PDF,
control de la suma contra el total del documento con 0,5 % de tolerancia, renglones que parecen subtotal marcados,
"pedir a la IA que corrija") + botón "Ver PDF del ADA" en el contrato (`contratos.ada_pdf_url`). Sin cambios de SQL.
Verificado: `deno check`, 4 pruebas de `control.test.ts`, `tsc`. **Desplegada el 7/10/2026** (`--no-verify-jwt`, como las otras;
responde 401 sin sesión, o sea que el secreto de Gemini está). Deploy desde esta PC: `node_modules/@supabase/cli-windows-x64/bin/supabase.exe` directo
(`npx supabase` falla por la ruta virtualizada); login con `npx.cmd supabase login` (PowerShell bloquea `npx.ps1`). **Falta**:
probarla con un ADA real.

- **Prueba de aceptación del aislamiento contra el Supabase real** (§7) — antes que nada.
- **Alta en Auth de los perfiles migrados**: el script deja `migracion/perfiles_pendientes.json`;
  invitarlos (UI de Usuarios o en lote con la edge function).
- **Prueba de campo del trabajo sin señal** en teléfonos reales (Android e iPhone).
- **Crear una orden desde el campo** (el operario encuentra un problema): hoy solo gerencia y jefe de
  sitio crean órdenes, y con conexión. Decisión de negocio pendiente.
- ~~Firma digital en aprobación de certificado~~: hecho el 1/10/2026 (`components/FirmaCanvas.tsx`; la firma queda en
  el certificado como PNG y, si se elige, en el perfil para la próxima; sale impresa en la hoja).
- **PDF del certificado** para enviar (hoy se imprime la hoja desde el navegador: "Guardar como PDF").
- ~~Pantalla de plantillas de OT~~: hecho el 1/10/2026 (`/gestion/plantillas`).
- ~~Edición de ubicaciones, contratos e ítems~~: hecho el 1/10/2026 (`components/gestion/EditarContrato.tsx`; la base
  sigue frenando cantidad/precio de ítems ya certificados).
- ~~Exports y reportes~~: reportes en la tanda 5; cada listado nuevo exporta CSV.
- Iconos PWA reales (`public/icons/` son placeholders).
- Next 16 (postcss embebido) — más adelante, no ahora.

## 5. Mapa del repo
```
app/
  app/login, app/mis-ots, app/ot/[id], app/q          portal operario + deep-link QR
  app/gestion/{page,ots,ots/nueva,activos,activos/[id],ubicaciones,usuarios}
  app/gestion/certificacion/{page,[contratoId],[contratoId]/[certId]}
  components/            OTCard, DetalleOT, EstadoCola, EstadoBadge, Estados (Esqueleto/Vacio/ErrorVista/
                         AvisoOffline), Boton, Campos, Checklist, FotoUploader, ScannerModal
  components/gestion/    Nav, SectorSwitcher, BuscadorRemoto, QRImprimible, Tabla, FormContrato
  lib/                   sesion.tsx, ot.ts, gestion.ts, certificacion.ts, imagen.ts, qr.ts, errores.ts,
                         useCarga.ts, types.ts, supabase/client.ts
  lib/offline/           motor.ts (lógica de la cola), cola.ts, db.ts (IndexedDB), useCola.ts
  middleware.ts          sesión + redirecciones (@supabase/ssr)
  migracion/             migrar.ts + README.md + ejemplo/
  supabase/functions/invitar-usuario/index.ts
pruebas/                 aceptacion.mjs (SQL sobre PGlite), offline.test.mjs (motor de la cola)
```
Convenciones: páginas son client components; nada de server actions. Los errores de Postgres se
limpian con `limpiarError()` y se muestran con `sonner`. Todo texto visible en español de obra.
Cada carga de datos usa `useCarga` y resuelve los cuatro estados.

## 6. Lecciones de la v1 en Base44 que condicionan la migración
- **1964 proyectos quedaron con `sector_id: null`** cuando se agregó RLS de sector sin backfill →
  invisibles para todos. Regla: **backfill antes de cerrar una RLS; nada sin sector se carga**.
- **`default: "escuela"`** en 22 schemas y `|| 'escuela'` en el frontend estampaban mal a todo. Por
  eso v2 prohíbe defaults de sector.
- **Asset** tenía en su RLS una rama hardcodeada `{sector: "escuela", role: user}` que dejaba ver
  activos de escuela a cualquier usuario. Regla: ninguna rama especial en RLS.
- **`assigned_name` (texto) como vínculo OT↔operario** era frágil; v2 usa `asignado_a` (id). En la
  migración, matchear por email/nombre contra `perfiles`; lo que no matchea queda sin asignar y se
  reporta.
- **Certificados**: el acumulado se calculaba en el cliente y se elegía "el anterior" por fecha de
  creación; sobre-certificación solo se pintaba en rojo. v2 lo hace en la base. Los certificados
  históricos se importan **como historia, sin recalcular**.
- **Fotos sin comprimir** (10 MB) tiraban "memoria insuficiente" en teléfonos.
- **`LocationQR` y `OTTemplate` no tenían `sector_id`** en la v1: en la migración hay que indicar su
  sector de forma explícita (`--sector-de=Entidad:clave`).
- Los agentes de Base44 reportaron varias veces cambios "aplicados" que no lo estaban. De ahí la
  regla de trabajo #1 de abajo.

## 7. Pruebas de aceptación (antes de dar nada por terminado)
1. **Aislamiento**: usuario común de `bapro` entra a `/mis-ots` y **no ve ninguna** ubicación, OT ni
   activo de `escuela`. Un admin en sector activo `escuela` ve solo escuela; cambia a `bapro`, ve
   solo bapro; con "ver todos", ve ambos.
2. **Nadie se cambia de sector a mano**: `update perfiles set sector_id=...` como usuario común →
   error del trigger `proteger_perfil`.
3. **Máquina de estados**: `update ordenes_trabajo set estado='completada'` desde `pendiente` →
   error. Finalizar con checklist incompleto sin `motivos_incompleto` → error.
4. **Certificación**: emitir con presente que supera la cantidad de un ítem → error de
   sobre-certificación. Emitir dos veces en paralelo → números distintos (índice único). Editar un
   emitido → error. Aprobar el propio certificado → error.
5. **Fotos**: 3 fotos seguidas desde un teléfono de gama media, sin error de memoria; archivos
   resultantes ~200–400 KB.
6. **Migración**: dry-run reporta sin-sector = 0 (o se resuelven) antes del `--apply`; conteos
   destino = origen al final.

Los puntos 1 a 4 están automatizados en `pruebas/aceptacion.mjs` contra un Postgres local. Eso no
reemplaza repetirlos una vez contra el Supabase real.

## 8. Cómo trabajar con Emanuel
1. **Verificar antes de afirmar.** Nunca reportar algo como "aplicado" sin releer el archivo /
   consultar la base. Distinguir siempre **verificado / razonado / no verificado**.
2. **Frenar y pedir OK** antes de: correr SQL contra su Supabase, cualquier `--apply` de migración,
   borrar datos, o cambios de versión mayor. Mostrar el diff/plan primero.
3. **Nunca manejar credenciales**: no pedir ni escribir contraseñas ni la `service_role` key en
   frontend. Él se loguea (Supabase, CLI); vos trabajás con la sesión abierta.
4. **Una cosa por vez**, con entregable completo. Prefiere ejecución autónoma a preguntas en cadena —
   pero preguntar cuando una decisión es de negocio (no técnica).
5. **Cambios quirúrgicos**, causa raíz antes que parche, sin refactors no pedidos.
6. **Cerrar cada tarea con informe**: Implementado / Archivos afectados / Decisiones / Verificación /
   Riesgos-pendientes.
7. **Respetar las decisiones cerradas de §2** y la guía de estilo (§2.14). Si algo nuevo las
   contradice, señalarlo antes de hacerlo.
8. Español rioplatense, directo, sin adornos. Los errores propios se admiten de frente.
9. **Si cambia el SQL, correr `pruebas/` antes de darlo por bueno**, y sumar la verificación del caso nuevo.
