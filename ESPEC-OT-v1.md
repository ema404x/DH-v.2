<!-- Especificación de Órdenes de Trabajo de la v1 actual (clon del 6/10/2026), armada leyendo el código. Referencia para igualar la v2. -->

# Especificación del módulo Órdenes de Trabajo (OT), DH1 v1

## 0. Rutas y permisos de acceso

| Ruta | Página | Protección |
|---|---|---|
| `/ordenes` | WorkOrders | `ProtectedPage moduleKey="WorkOrder"` |
| `/crear-ot` | CrearOT | `ProtectedPage moduleKey="WorkOrder"` |
| `/mis-ots` | PortalOperarioApp | `ProtectedPage moduleKey="MisOrdenes"` |
| `/orden-trabajo?ot=` | OrdenTrabajoPublica | pública |
| `/ejecutar-ot?ot=` o `?loc=` | EjecutarOrdenPublica | pública |
| `/ejecutar-ot-simple?ot=` | EjecutarOTSimple | pública |
| `/portal-operario?loc=` o `?asset=` | PortalOperario | pública |
| `/tablet` | PortalTablet | pública |

**Navegación**
- Sidebar, grupo "General": "Mis Órdenes de Trabajo" (ícono `HardHat`, módulo `MisOrdenes`).
- Sidebar, grupo "Operaciones": "Órdenes de Trabajo" (ícono `ClipboardList`, módulo `WorkOrder`).
- Barra inferior móvil: "Órdenes" y "Mis Órdenes".
- Títulos del header móvil: `/ordenes` → "Órdenes", `/crear-ot` → "Crear OT", `/mis-ots` → "Mis Órdenes".

**Toasts**
- Sonner global en `App.jsx`: `position="top-center" richColors closeButton`, fuera del AuthProvider. Por eso también funciona en las páginas públicas.

**Acciones de permiso** (pantalla Permisos)
- `read` = Ver, `create` = Crear, `update` = Editar, `delete` = Eliminar, `export` = Exportar, `approve` = Aprobar, `admin_view` = Ver Todo.
- `admin_view` implica `read`.
- `MisOrdenes` tiene `read` por defecto mientras el rol no lo configure explícitamente (migración).
- En el frontend, `usePermission` le da todo a quien tenga `user.role === 'admin'`. El backend, en cambio, decide por la ficha de Empleado (ver §8).

---

## 1. Entidades

### WorkOrder

Campos obligatorios: `title`, `type`, `status`.

| Campo | Tipo | Opciones / default |
|---|---|---|
| title | string | — |
| code | string | Ninguna pantalla lo genera |
| project_id, project_name | string | — |
| asset_id | string | FK a Asset (nuevo) |
| asset_name | string | Denormalizado de Asset.name |
| location | string | — |
| location_qr_id, location_qr_name | string | — |
| type | enum | `mantenimiento_preventivo`, `mantenimiento_correctivo` (default), `instalacion`, `inspeccion`, `reparacion`, `emergencia` |
| status | enum | `pendiente` (default), `asignada`, `en_progreso`, `obra`, `pendiente_validacion`, `completada`, `cancelada` |
| priority | enum | `baja`, `media` (default), `alta`, `urgente` |
| description | string | — |
| assigned_to | string | user_id; históricamente también email o nombre |
| assigned_name | string | — |
| jefe_sitio, jefe_sitio_email | string | — |
| archivada | bool | default false |
| fecha_archivado | date-time | — |
| scheduled_date, completed_date | date | — |
| estimated_hours, actual_hours | number | — |
| checklist[] | array | `{id, task, completed (false), notes, photo_url}` |
| photos[] | array | URLs |
| require_photos | bool | false |
| signature_url, signature_name | string | — |
| operario_sesion | string | Nombre tipeado en el portal público |
| materials_used[] | array | `{material_name, quantity, unit_cost}` |
| materiales_faltantes[] | array | `{material_name, cantidad_faltante, motivo}` |
| motivos_incompleto[] | array | `{id, texto}` |
| gps_latitude, gps_longitude, gps_accuracy | number | — |
| gps_timestamp | date-time | — |
| gps_status | enum | `capturado`, `denegado`, `no_disponible` |
| fecha_inicio_real, fecha_validacion | date-time | — |
| validado_por, rechazo_comentario | string | — |
| sector_id | string | Sin default |
| notes | string | — |

**Permisos a nivel de fila (RLS) de WorkOrder**
- **Crear:** rol de plataforma `admin`, `gerente`, `jefe_sitio` o `user`.
- **Leer y editar:** `sector_id` igual al del usuario **y** alguna de estas condiciones: es admin, es gerente, es el creador, o `jefe_sitio_email` es su email.
- **Borrar:** admin del mismo sector, o gerente si la OT es del sector `bapro`.
- En la práctica casi todo pasa por funciones con privilegios de servidor (service role) que ignoran estas reglas.

### OTTemplate

| Campo | Detalle |
|---|---|
| nombre | obligatorio |
| title | obligatorio |
| type, priority | mismos enums y defaults que WorkOrder |
| description | string |
| estimated_hours | number |
| checklist[] | `{id, task, completed}` |
| require_photos | bool, default false |

RLS: admin y gerente pueden crear, leer y editar; solo admin borra.

### TimeLog

| Campo | Detalle |
|---|---|
| work_order_id, employee_name, date, hours | obligatorios |
| work_order_title | string |
| employee_id | string |
| description | string |
| type | `normal` (default), `extra`, `guardia` |
| sector_id | nuevo |

RLS con sector. **No se usa en ninguna pantalla** (ver §11).

### Automatizaciones (en `base44/workflows/`)

- **"Stamp Sector &amp; Jefe Email on OT Create"** y **"Stamp Sector on WorkOrder Create"**: corren en create y update. Las dos llaman a `stampSectorOnCreate`.
  - Si falta `sector_id`: lo toma de la ficha de Employee del creador, si no del User, y si no estampa `'SIN_SECTOR'`.
  - Si falta `jefe_sitio_email`: lo resuelve por nombre (exacto → contiene, para ≥10 caracteres → partes del nombre), dentro del mismo sector. Si no hay `jefe_sitio` y el creador es jefe, estampa sus propios `jefe_sitio` y email.
  - **Solo al crear y sin `scheduled_date`:** pone la fecha de hoy (America/Buenos_Aires).
- **"Audit - WorkOrder"**: create, update y delete llaman a `autoLogAudit`, que escribe en AuditLog con los `changed_fields`. **Es el único "historial" de una OT.** No hay timeline visible.
- **"Archivado automático de OTs completadas (30 días)"**: cron `0 5 * * *` UTC, llama a `archivarOTsCompletadas`.
  - Marca `archivada=true` y `fecha_archivado=now` en las completadas con `completed_date` ≤ hoy−30 días (Argentina).
  - El status no cambia. Deja una entrada en AuditLog con el resumen por sector.
- **"Herencia OT por reasignación de ubicación (Asset / Direccion)"**: se dispara cuando cambia `jefe_sitio`. Llama a `heredarOTsPorUbicacion`, que pasa las OTs al jefe nuevo.

---

## 2. Máquina de estados (`lib/workorder-transitions.js` y `transicionEstadoOT`)

### Transiciones fijas (backend)

| Acción | Desde | Hacia |
|---|---|---|
| asignar | pendiente | asignada |
| iniciar | pendiente **o** asignada | en_progreso |
| finalizar | en_progreso | pendiente_validacion |
| aprobar | pendiente_validacion | completada |
| rechazar | pendiente_validacion | en_progreso |

### Transiciones flexibles (desde cualquier estado que no sea `completada` ni `cancelada`)

| Acción | Hacia |
|---|---|
| cancelar | cancelada |
| convertir_obra | obra |
| completar | completada |

`obra` **no** es terminal: se puede completar o cancelar.

### Mapeo de arrastre en el frontend (`getTransitionAction(from, to)`)

- Si `from` es `completada` o `cancelada` → `null`.
- Si `to` es `cancelada` → `cancelar`; si es `obra` → `convertir_obra`; si es `completada` → `completar`.
- Si no: `pendiente→asignada` = asignar; `pendiente→en_progreso` = iniciar; `asignada→en_progreso` = iniciar; `en_progreso→pendiente_validacion` = finalizar; `pendiente_validacion→completada` = aprobar; `pendiente_validacion→en_progreso` = rechazar.
- Cualquier otro par → `null`.

### Botones por estado (`getAvailableActions`)

| Estado | Botones |
|---|---|
| pendiente | Asignar (blue) |
| asignada | Iniciar (sky) |
| en_progreso | Finalizar (emerald) |
| pendiente_validacion | Aprobar (emerald), Rechazar (red) |
| obra | Completar (emerald) |
| completada, cancelada | ninguno |

Clases de cada variante (`ACTION_VARIANTS`):
- blue: `bg-blue-600/20 border border-blue-500/30 text-blue-300 hover:bg-blue-600/30`
- sky: `bg-sky-600/20 border-sky-500/30 text-sky-300`
- emerald: `bg-emerald-600 text-white hover:bg-emerald-500`
- amber: `bg-amber-600/20 border-amber-500/30 text-amber-300`
- red: `bg-red-600/20 border-red-500/30 text-red-300`

### Backend `transicionEstadoOT`

**Entrada:** `{ot_id, accion, extra_data={}, auth_mode='session'|'portal', operario_password, operario_sesion}`.

**Autenticación**
- `session`: usa la sesión del usuario (`auth.me()`). Sin sesión → 401 "No autorizado".
- `portal`: valida con `verificarClaveOperario`.
  - Hash SHA-256 de `password + 'b44-operario-salt-v1'` contra `SecurityConfig.operario_password_hash`. Si no existe el hash, compara contra la variable de entorno `OPERARIO_PASSWORD`.
  - Sin ninguna de las dos → 503 "Servicio no configurado". Clave inválida → 401 "Clave de operario requerida".
  - El portal solo puede iniciar o finalizar. Otra acción → 403 "El portal público solo puede iniciar o finalizar OTs".

**Validaciones y errores, en este orden**

| Caso | Código | Mensaje |
|---|---|---|
| Falta `ot_id` o `accion` | 400 | "Faltan parámetros: ot_id y accion son obligatorios" |
| Acción desconocida | 400 | `Acción "${accion}" no válida. Acciones permitidas: asignar, iniciar, finalizar, aprobar, rechazar, cancelar, convertir_obra, completar` |
| OT inexistente (la lee con service role) | 404 | "Orden de trabajo no encontrada" |
| Portal y la OT sin `sector_id` | 403 | "La OT no tiene sector asignado (legacy). No se puede operar desde el portal." |
| Sesión: sector de la OT distinto del sector del caller (salvo super-admin) | 403 | "Esta OT pertenece a otro sector. Cambiá de sector activo para operarla." |
| Estado inválido para una transición fija | 409 | `No se puede "${accion}" porque la OT está en estado "${status}". Debe estar en "x"` (para iniciar: `"pendiente" o "asignada"`) |
| Flexible desde estado terminal | 409 | `No se puede "${accion}" porque la OT está en estado terminal "${status}".` |
| aprobar/rechazar/completar sin `canApprove` | 403 | "Solo el Jefe de Sitio, Admin o Gerente puede completar o rechazar OTs" |
| asignar sin `assigned_name` (ni en la OT ni en extra_data) | 400 | `Debe asignar un operario antes de cambiar el estado a "Asignada"` |
| Portal, finalizar, `operario_sesion` normalizado distinto | 409 | "La trabaja otro operario" |
| completar/aprobar sin motivos de incompleto y con checklist pendiente | 400 | `No se puede completar: faltan N tarea(s) del checklist. Si la OT queda incompleta, registrá el motivo en "Motivos Incompleto".` |
| completar/aprobar sin motivos, `require_photos` y sin fotos | 400 | "No se puede completar: la OT requiere al menos una foto" |
| Faltante sin motivo | 400 | "Todos los materiales faltantes deben tener un motivo" |
| rechazar sin comentario | 400 | "Debe indicar un motivo de rechazo" |
| Excepción | 500 | `error.message` o "Error interno del servidor" |

Antes de validar el sector, en modo sesión la función alinea `User.sector_id` con el de la ficha de Employee (en la medida de lo posible).

**Qué escribe**
- Siempre `status = nuevo estado`.
- **asignar:** `assigned_name` si viene en extra_data.
- **iniciar:**
  - Con `extra_data.gps`: `gps_latitude`, `gps_longitude`, `gps_accuracy`, `gps_timestamp=now`, `gps_status='capturado'`. Sin GPS: `gps_status = extra.gps_status || 'denegado'`.
  - Siempre `fecha_inicio_real=now`.
  - Portal: `operario_sesion` y `assigned_name = operario_sesion`.
  - Sesión y caller no-admin: `assigned_to = user.id`, y `assigned_name` si viene.
  - Sesión y caller admin: `assigned_to` si viene; `assigned_name` solo si la OT estaba vacía.
- **Cualquier acción:** si vienen en extra_data, **reemplaza** (no concatena) `checklist`, `materials_used`, `materiales_faltantes`, `notes`, `photos`.
- **aprobar y completar:** `completed_date` = hoy (UTC, YYYY-MM-DD), `fecha_validacion=now`, `validado_por` = `user.full_name || email || 'Jefe de Sitio'` (en portal: `operario_sesion || 'Portal'`).
- **rechazar:** `rechazo_comentario` (trim). Nunca se borra después.
- **Si queda completada y tiene `asset_id`:**
  - Crea un `AssetHistory` con `tipo_evento:'mantenimiento'`, `descripcion:"OT completada: {title}"` y costo = Σ cantidad × costo unitario.
  - Si el tipo es preventivo, correctivo o reparación: actualiza en el Asset `last_maintenance` y `next_maintenance` = +`maintenance_frequency_days` (default 90).

**Respuesta:** `{success, ot, mensaje}`.

| Acción | Mensaje |
|---|---|
| asignar | "OT asignada correctamente" |
| iniciar | "OT iniciada correctamente" |
| finalizar | "OT enviada a validación" |
| aprobar | "OT aprobada y completada" |
| rechazar | "OT rechazada y devuelta al operario" |
| cancelar | "OT cancelada" |
| convertir_obra | "OT convertida a Futura Obra" |
| completar | "OT completada correctamente" |

---

## 3. Pantalla /ordenes (WorkOrders.jsx)

Fondo `from-slate-950 via-slate-900 to-slate-950`, con dos manchas difusas (purple y pink) que pulsan. Todo envuelto en PullToRefresh (umbral 70 px, máximo 120 px, solo touch), que invalida `['workorders-board']`.

### Carga

- Query `['workorders-board']` → `getWorkOrdersForUser({scope: isGerente ? undefined : 'own'})`.
  - `staleTime` 30 s; refetch al montar y al recuperar foco.
  - `isGerente = isSuperAdmin || user.role==='gerente'`.
  - `isSuperAdmin` = (rol de plataforma admin y el rol de empleado no es de campo) o plataforma gerente o rol de empleado de nivel admin.
- Se ocultan las OTs con `archivada=true` (de hecho el backend ya las excluye).
- **Orden:** `-updated_date` del backend. No hay otro orden.
- **Tiempo real:** `useWorkOrderRealtime(ctx, isOnline)` se suscribe a `WorkOrder.subscribe`.
  - Aplica create, update y delete al cache, filtrando con `otEsVisiblePara`.
  - Si llegan 3 o más eventos en 2 s, invalida a los 800 ms.
- También carga Direccion y Employee completos (`fetchAllList`, paginado de a 500) para resolver jefes en los filtros.

### Banner offline

Ícono `WifiOff`. Texto: "**Modo offline** — tablero en solo lectura. Las OTs nuevas se guardan localmente y se sincronizan al reconectar."

### Header

- Ícono `ClipboardList` en un recuadro con gradiente purple→pink.
- Título "Órdenes de Trabajo".
- Subtítulo: `{total} activas` + ` · {archived_count} archivadas (Historial)` (solo si hay &gt; 0) + ` • Offline` (si no hay conexión).
- Botones, de izquierda a derecha:
  1. Toggle **Kanban** (`Kanban`) / **Grilla** (`LayoutGrid`). Default: Kanban. En móvil el texto se oculta.
  2. **Campo** / **Escritorio** (`Smartphone`). Activo en emerald.
  3. **Historial** (`History`).
  4. **Filtros** (`SlidersHorizontal`). Solo para gerente.
  5. **Plantillas** (`Layers`).
  6. **Nueva OT** (en móvil "Nueva"; `Plus`). Solo con permiso create. Link a `/crear-ot`.

### Tarjetas de totales

Grilla de 2, 3, 4 u 8 columnas según ancho. Se calculan sobre la lista ya filtrada.

| Tarjeta | Ícono | Gradiente |
|---|---|---|
| Total | ClipboardList | from-slate-400 |
| Pendientes | Clock | from-yellow-500 |
| Asignadas | UserCheck | from-blue-500 |
| En Progreso | Loader | from-purple-500 |
| Validación | AlertCircle | from-amber-400 |
| Obra | HardHat | from-pink-400 |
| Completadas | CheckCircle2 | from-emerald-500 |
| Canceladas | XCircle | from-red-500 |

### Filtros avanzados (gerente)

Título "Filtros Avanzados" (`Filter`). Badge "N activo(s)". Botón "Limpiar" (`RotateCcw`). Grilla de 1, 2 o 3 columnas.

**Prioridad:** Todas / Baja / Media / Alta / Urgente.

**Tipo de Trabajo:**

| Valor | Label |
|---|---|
| '' | Todos |
| mantenimiento_preventivo | Preventivo |
| mantenimiento_correctivo | Correctivo |
| instalacion | Instalación |
| inspeccion | Inspección |
| reparacion | Reparación |
| emergencia | Emergencia |

**Operario:** "Todos" + nombres únicos que salen de `assigned_name` de las OTs y de empleados cuyo rol no contiene "jefe". Excluye nombres de jefes. Orden alfabético (`localeCompare 'es'`).

**Jefe de Sitio:** "Todos" + empleados con rol que contiene "jefe" + `Direccion.jefe_sitio` + `OT.jefe_sitio`, deduplicados sin distinguir mayúsculas ni acentos.

**Fecha creación desde / hasta:** inputs de fecha. Se comparan contra `created_date` convertido a fecha local del navegador.

**"Solo vencidas":** checkbox (ver la regla de vencida más abajo).

Cómo matchean operario y jefe:
- **Jefe:** se arma un conjunto de alias. Incluye el nombre elegido, los `jefe_sitio` y `resolveJefe` de OTs vinculadas a ese empleado por `jefe_sitio_email` o `created_by_id`, y los `Direccion.jefe_sitio` que coinciden por nombre. Una OT matchea por alias, email, `created_by_id` o `resolveJefe`.
- **`resolveJefe`:** usa `o.jefe_sitio`. Si no hay, cruza `location` normalizada (mayúsculas, sin ", CABA" final) contra `Direccion.direccion`. Primero match exacto; si no, `location.startsWith(dirección + ',')` con dirección de 10 o más caracteres, prefiriendo la más larga.
- **Operario:** mismo esquema de alias, con `assigned_name` / `assigned_to` / `created_by_id`.

### Búsqueda

Placeholder "Buscar por establecimiento, ubicación, título...".

Busca sin distinguir mayúsculas ni acentos en: `title`, `location`, `location_qr_name`, `project_name`, `asset_name`, `assigned_name`, `code`, `jefe_sitio`, `resolveJefe` y el nombre del creador.

En modo Grilla se ven además las pestañas de estado, en este orden: Todas, Pendiente, Asignada, En Progreso, Obra, Validación, Completada, Cancelada.

### Kanban (KanbanBoard)

Columnas de 240 px, con borde superior de color, punto de color y contador en una píldora. Orden:

| Columna | Color |
|---|---|
| Pendiente | yellow-500 |
| Asignada | blue-500 |
| En Progreso | purple-500 |
| Validación | amber-400 |
| Completada | emerald-500 |
| Obra | pink-400 |
| Cancelada | red-500 |

- Columna vacía: "Sin órdenes" en un recuadro punteado.
- Se muestran hasta 40 tarjetas por columna; el resto con el botón "+ N más...".
- La altura máxima de la columna es 70vh, con scroll.

**Tarjeta**
- Píldora de prioridad con el texto en minúsculas capitalizado:

  | Prioridad | Clases |
  |---|---|
  | baja | bg-slate-700 text-slate-300 |
  | media | bg-blue-900/60 text-blue-300 |
  | alta | bg-orange-900/60 text-orange-300 |
  | urgente | bg-red-900/60 text-red-300, negrita |

- Botón QR que aparece al pasar el mouse.
- Título (hasta 2 líneas).
- `MapPin` + `location_qr_name || location`.
- `User` + `assigned_name`.
- `Wrench` + "{Creada por|Jefe de sitio|Responsable} {nombre}" (`resolveOTOwner`).
- Badge "VENCIDA" en rojo cuando corresponde.

**Regla de vencida** (`esOtVencida`): status `en_progreso` **y** tiene `scheduled_date` **y** la fecha de hoy en Argentina (UTC−3) es mayor que `scheduled_date`. Ningún otro estado vence nunca.

**Arrastrar y soltar**
- Deshabilitado sin conexión.
- Al soltar: sin conexión → toast info "Sin conexión — modo offline. No se puede mover la OT hasta reconectar."
- Si no hay acción válida → toast "Esa transición de estado no está permitida".
- Si la acción es `cancelar` → abre CancelarOTModal.
- Si no, llama a `transicionEstadoOT` sin extra_data.
- Éxito: toast con el mensaje del backend. Error: toast con el error. En ambos casos invalida.
- Desde Kanban no se envían GPS, assigned_name ni comentario de rechazo. Arrastrar a "en_progreso" desde Validación (rechazar) **falla**: falta el motivo.

### Grilla (WorkOrderCard)

Grilla de 1, 2 o 3 columnas. Muestra 60 tarjetas y luego el botón "+ N órdenes más...".

**Tarjeta**
- Ícono `Wrench` en gradiente purple→blue.
- Título.
- `Zap` asset, `MapPin` location, `User` assigned.
- "{label} {nombre}" del creador.
- Fila inferior: badge de estado (slate-700), badge de prioridad (secondary, texto crudo) y "VENCIDA".

**Botón de acción** (solo si gerente o jefe de sitio y hay conexión):
- pendiente o asignada → **Iniciar** (`Zap`, blue): acción `iniciar`.
- en_progreso → **Finalizar**: acción `finalizar`.
- pendiente_validacion → **Aprobar**: acción `aprobar`.
- obra → **Completar**: acción `completar`.
- Los tres últimos son botones emerald con ícono `CheckCircle2`.
- Toasts: mensaje del backend. Sin conexión: "Sin conexión — modo offline. No se puede iniciar la OT hasta reconectar." o "...No se puede cambiar el estado hasta reconectar."

**Estado vacío:** `EmptyState` con ícono ClipboardList, título "No hay órdenes", texto "Creá una nueva orden de trabajo" y botón "Nueva OT" que navega a `/crear-ot`.

### Plantilla desde el header

Al elegir una plantilla se crea la OT directamente: `{title, type, priority, description, estimated_hours, checklist con completed=false, status:'pendiente'}`.
- Sin conexión va a la cola IndexedDB y muestra el toast "OT guardada sin conexión. Se sincronizará al reconectar."
- Con conexión no muestra toast.

### QR de lista o Kanban

Usa QRCodeModal:
- `title` = título de la OT.
- `subtitle` = `location || "OT {code}"`.
- Valor: `{origin}/portal-operario?loc={location_qr_id}` si la OT tiene QR de ubicación; si no, `{origin}/ejecutar-ot-simple?ot={id}`.

### CancelarOTModal

- Ícono `AlertTriangle` rojo. Título "Cancelar orden de trabajo". Subtítulo "Esta acción no se puede deshacer".
- Texto: "¿Estás seguro de que querés cancelar esta OT?" y debajo «{título}».
- Botones "No, volver" y "Sí, cancelar OT" (rojo).

### Borrar

- Se hace desde el panel de detalle. Llama a `eliminarOT`.
- Toasts: "OT eliminada correctamente" o el error ("No tenés permiso para eliminar esta OT", "Esta OT pertenece a otro sector…", "Orden de trabajo no encontrada").

---

## 4. Panel de detalle (WorkOrderDetailPanel)

Modal: en móvil es una hoja inferior, en escritorio queda centrado con `max-w-lg`. Altura 93dvh. Fondo `#0d1117`. Click fuera lo cierra (salvo mientras guarda).

Al abrir refresca la OT (`WorkOrder.filter({id})`). Mientras carga, muestra `RefreshCw` girando.

### Header

Gradiente `#1e1b4b → #312e81 → #1e3a5f`.

- Arriba, en mono: `code` o "OT-" + últimos 6 caracteres del id en mayúsculas.
- Título (hasta 2 líneas).
- Píldoras:
  - **Prioridad**, con punto de color:

    | Prioridad | Punto | Píldora |
    |---|---|---|
    | Baja | slate-400 | slate-700/60 |
    | Media | blue-400 | blue-900/50 |
    | Alta | orange-400 | orange-900/50 |
    | Urgente | red-500 parpadeando | red-900/50 |

  - **Tipo:** Preventivo, Correctivo, Instalación, Inspección, Reparación o Emergencia.
  - **Estado:**

    | Estado | Texto | Fondo |
    |---|---|---|
    | Pendiente | yellow-300 | yellow-900/30 |
    | Asignada | blue-300 | blue-900/30 |
    | En Progreso | violet-300 | violet-900/30 |
    | Obra | pink-300 | pink-900/30 |
    | Validación | amber-300 | amber-900/30 |
    | Completada | emerald-300 | emerald-900/30 |
    | Cancelada | red-300 | red-900/30 |

- Fila de datos: `MapPin` location, `User` assigned_name, `Calendar` scheduled_date (texto crudo) y "{Creada por …}".
- Botón cerrar (`X`, círculo).

### Controles rápidos (3 columnas)

**Estado (Select con los 7 estados)**
- Al cambiar, calcula `getTransitionAction`. Si es `null` → toast "Transición no válida: {De} → {A}".
- Si no, ejecuta la acción. Rechazar y cancelar abren su modal.
- Si el checklist está incompleto, debajo muestra "{done}/{total} hechas" en naranja.

**Responsable (input libre, placeholder "Nombre del responsable…")**
- Al escribir: guarda `assigned_name`. Si el nombre coincide con un operario del sector (`getOperariosSector`), también `assigned_to = user_id`, y si ese operario es jefe, `jefe_sitio_email`. Si no coincide, `assigned_to = ''`.
- Al salir del campo:
  - Sin coincidencia: toast warning `No se encontró a "{n}" en el equipo. El operario no verá esta OT hasta tener usuario vinculado.`
  - Coincide pero sin usuario: `{nombre} no tiene usuario vinculado. No verá esta OT en Mis Órdenes hasta tenerlo.`
- Un usuario que no es super-admin no puede resolver a otros jefes.

**Fecha:** input de fecha, guarda `scheduled_date`.

### Barra de acciones

Botones de `getAvailableActions` a ancho completo. **No se muestra en pendiente_validacion.**

| Acción | Qué hace |
|---|---|
| Asignar | Envía `extra_data.assigned_name` |
| Iniciar | Sin GPS |
| Finalizar | — |
| Completar (obra) | — |

Antes de cualquier transición, guarda los campos pendientes.

Después de una transición: invalida `['workorders']` y el detalle. En aprobar, cancelar, convertir_obra y completar, cierra el panel.

### Cuerpo, en orden

1. **ReporteOperarioResumen** (solo en pendiente_validacion). Borde amber.
   - Título "Reporte del Operario — esperando tu validación".
   - `User` assigned_name o "Sin asignar"; `Clock` "Inicio real: dd/mm hh:mm" (locale es-AR).
   - Recuadro Checklist "{done}/{total}" y "{pct}% completado".
   - "Materiales usados (n)": nombre, cantidad · $costo.
   - Recuadro rojo "Materiales faltantes (n)": "nombre — faltaron X" y "Motivo: …".
   - "Fotos del trabajo (n)": grilla de 4; cada foto abre en una pestaña nueva.
   - GPS con coordenadas a 5 decimales, "Precisión: ±Nm" y botón "Ver mapa" (`https://www.google.com/maps?q=lat,lng`).
   - "Notas del operario".
   - "Motivos de trabajo incompleto" (con viñetas •).
   - "Rechazo anterior".
   - Alerta naranja si falta checklist o fotos: "Faltan N tarea(s) del checklist. La OT requiere al menos una foto. Si hay motivos de incompleto registrados el sistema permite aprobar; si no, rechazá y devolvé al operario."
   - Botones "**Rechazar y devolver**" (`XCircle`, rojo) y "**Aprobar y completar**" (`CheckCircle2`, emerald, más ancho).

2. **"Asignar ubicación"** (solo si `location` está vacío). Contiene el LocationEditor:
   - Input con placeholder "Buscar por dirección o establecimiento…". Desde 2 caracteres sugiere hasta 10 entradas de `obtenerUbicaciones` (LocationData + Direccion + QR), buscando por nombre, dirección o jefe.
   - Sin resultados: `Sin resultados para "{q}"`.
   - Al elegir, vista previa con `MapPin` + ubicación y "Jefe de sitio: X". Botón "Confirmar ubicación".
   - Al confirmar guarda `{location, location_qr_id (solo si tiene QR), location_qr_name, assigned_name: jefe || actual}`. Toast "Ubicación asignada correctamente".

3. **Secciones colapsables** (encabezado en mayúsculas, chevron):
   - **Instrucciones** (`FileText`, abierta; solo si hay descripción).
   - **Checklist** (`CheckSquare`, abierta, badge "d/t"). Anillo de progreso con "¡Todo completado!" o "N tarea(s) pendiente(s)" y "X% del trabajo listo". Ver §9.
   - **Ubicación GPS** (`Navigation`, cerrada; solo si hay `gps_status`). Coordenadas, "Precisión", "Ver mapa"; o "Permiso denegado" / "No disponible".
   - **Materiales** (`Package`, cerrada, badge con la cantidad). Ver §9.
   - **Fotos &amp; Firma** (`Camera`, cerrada, badge con la cantidad). Fotos y, debajo, "Firma de conformidad".
   - **Notas** (`Zap`, cerrada). Textarea con placeholder "Agregar observaciones...".
   - **Motivos Incompleto** (`ClipboardX`, cerrada, en naranja).

### Footer

**Herramientas**
- Descargar PDF (`Download`).
- Guardar plantilla (`Layers`): pide `prompt('Nombre de la plantilla:', título)`. Crea un OTTemplate con title, type, priority, description, estimated_hours, checklist (completed=false) y `require_photos = (fotos &gt; 0)`. Toast "Plantilla guardada".
- QR (`QrCode`): `{origin}/orden-trabajo?ot={id}`. Subtítulo: location, asset_name o "OT {code}".
- **Obra** (`Wrench`, amber):
  - Pide `window.confirm('¿Convertir esta OT a Futura Obra? Se creará un pendiente de tipo obra y la OT quedará en estado "Obra".')`.
  - Crea un Pendiente: `{descripcion: title, tipo:'obra', estado:'pendiente', prioridad, establecimiento: location_qr_name, sitio: location, jefe_sitio: assigned_name, jefe_sitio_email, sector_id, materiales_necesarios: nombres de materiales unidos con ", ", observaciones: description, fecha_limite: scheduled_date}`.
  - Después ejecuta `convertir_obra`. Si falla, borra el Pendiente.
  - Toasts: "OT convertida a Futura Obra correctamente" / "No se pudo crear el pendiente de obra. La OT no fue modificada." / el error.
- **Eliminar** (solo con permiso delete). AlertDialog:
  - Título "¿Eliminar orden de trabajo?".
  - Texto "Se eliminará permanentemente: **{title}** (Asignada a X)". Recuadro rojo "Esta acción no se puede deshacer."
  - Botones Cancelar / Eliminar.

**Botones finales:** "Cerrar" y "Guardar" (`Save`; mientras guarda dice "Guardando").
- Guardar con checklist incompleto → toast warning "Faltan N tarea(s)" y no hace nada.
- Guardar con foto obligatoria faltante → "Falta foto obligatoria".
- Si no, compara contra lo que hay en el servidor, envía los cambios y cierra. Sin cambios, cierra directo.

### Autoguardado

- Cada cambio de campo marca ese campo como "sucio" y programa un guardado a los 400 ms.
- Se envía **solo lo que cambió** a `actualizarOT {ot_id, patch}`. Toast "Guardado" en cada guardado exitoso.
- Error: toast con el mensaje ("No tenés permiso para editar esta OT", etc.).
- Al cerrar o desmontar el panel, se envía lo pendiente.

**Backend `actualizarOT`**
- Permite editar si el caller puede editar cualquier OT (`canUpdateAny`), o es el creador, o `jefe_sitio_email` es el suyo, o `assigned_to` es su id, o `jefe_sitio`/`assigned_name` coinciden con su nombre de empleado.
- Ignora `id`, `created_date`, `updated_date`, `created_by_id` y `sector_id`.

### RechazoOTModal

- Ícono `MessageSquareWarning`. Título "Rechazar OT y devolver al operario". Subtítulo "El operario verá este motivo al reabrir la OT".
- Textarea con placeholder "Explicá qué falta o qué hay que corregir…".
- Botones "Cancelar" y "Rechazar y devolver" (deshabilitado si el texto está vacío).

---

## 5. Crear OT (/crear-ot)

### Header fijo

- Botón volver (`ArrowLeft`) a /ordenes.
- Ícono en gradiente.
- Título "Crear Orden de Trabajo". Subtítulo "Paso {i} de {n}".
- Botón "Plantilla" (`Layers`).
- Barra de progreso con las etiquetas **Activo / Detalle / Materiales**.
- En el sector **bapro** se salta el paso 1 (son 2 pasos y arranca en Detalle).

### Paso 1: Activo

- Título "¿Qué activo intervenir?". Subtítulo "Seleccioná el equipo/activo del módulo Activos sobre el que se trabajará".
- Carga los activos: en escuela con `getActivosSector`, en otros sectores con `Asset.list('-name',500)`. Excluye `status==='baja'`.
- Si el que crea es jefe de sitio en escuela, solo ve los activos cuyo nombre o ubicación coincide con sus Direcciones.
- Mientras carga: "Cargando activos...".
- Input con placeholder "Escribí para buscar activo (nombre, sede, código)...". Busca por name, sede, area, code y jefe_sitio. Muestra hasta 10.
- Cada sugerencia: ícono `Wrench`, nombre, "sede · área" o "Sin sede asignada", y el código en mono.
- Sin resultados: `Sin resultados para "{q}"`.
- Al elegir: toast info "Jefe de sitio asignado: X". La tarjeta muestra `CheckCircle2` + nombre, `MapPin` + sede·área, "Proyecto: …", "Jefe de sitio: X" en verde, o "El activo no tiene jefe de sitio asignado".
- Sin selección: "El activo es opcional — podés continuar sin seleccionarlo".

### Paso 2: Detalle

- Título "Detalle de la orden". Subtítulo "Completá los datos principales de la tarea".
- **Título \*** (autofocus). Placeholder "Ej: Revisar filtraciones en techo del aula 3".
- **Tipo de trabajo**: 6 botones en grilla de 3 columnas:

  | Label | Ícono |
  |---|---|
  | Correctivo | Wrench |
  | Preventivo | Clock |
  | Instalación | Zap |
  | Inspección | ClipboardList |
  | Reparación | AlertTriangle |
  | Emergencia | AlertTriangle |

  Default: Correctivo.
- **Prioridad**: 4 botones (Baja, Media, Alta, "🚨 Urgente"). Default: Media. Colores slate / blue / orange / red al 20%.
- **Selector de modo**: "Orden de Trabajo" (gradiente purple→pink) o "Futura Obra" (gradiente amber→orange). En Futura Obra aparece el aviso "Se registrará como pendiente en el módulo de Obras, sin generar una OT."
- **Banner "5 Reglas de Oro"**: aparece si el título más la descripción contienen alguna de estas palabras: electr, tension, tensión, tablero, cable, circuito, voltaje, corriente, fusible, disyuntor, interruptor, instalación eléctrica, tomacorriente, llave térmica. También si el tipo es instalacion. Se puede cerrar.
  - Encabezado: "⚠️ 5 Reglas de Oro — Seguridad Eléctrica" / "Obligatorias antes de iniciar cualquier trabajo eléctrico".
  - Las 5 reglas: ⚡ Corte visible o efectivo; 🔒 Bloqueo y etiquetado; 🔍 Verificación de ausencia de tensión; 🌍 Puesta a tierra y en cortocircuito; 🚧 Señalización y delimitación de la zona. Cada una con su descripción.
  - Pie: "El incumplimiento de estas reglas puede causar accidentes graves o fatales."
- **Instrucciones para el operario**: textarea de 4 filas. Placeholder "Describí detalladamente el trabajo a realizar, o usá el micrófono para dictarlo...".
- **Dictado por voz**:
  - Botón "Dictar instrucciones" (`Mic`). Mientras graba: "Detener" (`MicOff`, rojo, con punto que parpadea) y el texto "Escuchando — hablá con normalidad".
  - Usa el Web Speech API del navegador: idioma `es-AR`, `continuous=false`, solo resultados finales. Cada resultado se agrega con un espacio. Ante `no-speech` o `audio-capture` reintenta a los 300 ms; al terminar cada sesión la relanza a los 200 ms.
  - Si el navegador no lo soporta: "Usá Chrome para grabación de voz".
- **Fotos de referencia**: grilla de 4 con botón X para quitar. Botón "Agregar foto(s) de referencia" (`Camera`), que abre la cámara y permite varias. Se comprimen antes de subir (lado mayor 1600 px, JPEG 0.8). Error: toast "Error subiendo {nombre}".
- Para avanzar de paso exige título. Si falta: toast "Completá el título para continuar".

### Paso 3: Materiales

- Título "Materiales y confirmación". Subtítulo "Agregá los insumos necesarios y revisá el resumen antes de crear la OT".
- **Fecha programada**.
- **Persona a cargo**: placeholder "Nombre de la persona responsable...", con botón X para limpiar. Si hay jefe automático y no se escribió nadie: "Si no asignás una persona, se usará el jefe de sitio: X".
- **Materiales necesarios**: link "+ Agregar material". Vacío: recuadro "Agregar materiales / insumos". Con datos: encabezados "Material | Cant."; inputs "Material / insumo..." y "Cant."; botón de tacho al pasar el mouse.
- **Checkbox** "Requiere fotos para completar" / "El operario deberá adjuntar fotos antes de marcar la OT como completada".
- **Resumen** (filas que se ocultan si están vacías): Guardar como ("🔨 Futura Obra" o "📋 Orden de Trabajo"), Título, Tipo, Prioridad (capitalizada), Activo, Persona a cargo, Jefe de sitio (auto), Fecha programada, Materiales "N ítem(s)", Fotos adjuntas "N foto(s)", Requiere fotos "Sí".
- **Navegación**: "Atrás" (`ChevronLeft`), "Continuar" (`ChevronRight`) y el botón final:
  - "Crear Orden de Trabajo" (gradiente emerald→teal), o
  - "Registrar como Futura Obra" (amber).
  - Mientras guarda: "Guardando...".

### Qué escribe

**Modo OT** → `WorkOrder.create`:
- `title` (trim), `type`, `priority`, `description`.
- `status`: `'asignada'` si hay responsable (escrito o jefe del activo); si no, `'pendiente'`.
- `scheduled_date`.
- `materials_used`: solo los que tienen nombre.
- `require_photos`, `photos`.
- `asset_id`, `asset_name`.
- `location` = "sede · área" o el nombre del activo.
- `project_name`.
- `assigned_name` = responsable.
- `assigned_to` = user_id resuelto con `getOperariosSector`.
- `jefe_sitio` = jefe del activo.
- `jefe_sitio_email`: el del responsable si es jefe; si no, el del jefe del activo.
- No envía `checklist` ni `estimated_hours`, aunque se haya usado una plantilla.

**Sin conexión:** va a la cola IndexedDB (`dh1-offline-queue`).

**Modo Futura Obra** → `Pendiente.create`:
`{descripcion: title, tipo:'obra', estado:'pendiente', prioridad, establecimiento: sede || nombre, activo_nombre, sitio, jefe_sitio, materiales_necesarios: "a, b", observaciones: description, fecha_limite}`.

**Toasts**
- "¡Orden de trabajo creada exitosamente!"
- "OT guardada sin conexión. Se sincronizará al reconectar."
- "¡Futura obra registrada correctamente!"
- "Error al crear la OT. Intente nuevamente." / "Error al registrar la futura obra."

### Plantilla en CrearOT

Aplica solo title, type, priority, description y require_photos. Toast `Plantilla "{nombre}" aplicada`.

### Pantalla de éxito

- `CheckCircle2` grande.
- Título "¡OT Creada!", "¡OT Guardada (offline)!" o "¡Futura Obra Registrada!". Debajo, título o descripción y `MapPin` + activo.
- Botones:
  - "Ver QR de la OT" → `/ejecutar-ot?ot={id}`. Sin conexión, en su lugar aparece "Pendiente de sincronización — el QR estará disponible al reconectar."
  - En Futura Obra: "Ver Pendientes / Obras" → /activos.
  - "Crear otra OT" o "Registrar otra".
  - "Ir a Órdenes de Trabajo".

### OTTemplateSelector

- Diálogo con título "Plantillas de OT" (`Layers`).
- Vacío: "No hay plantillas aún. Guardá una OT como plantilla desde el panel de detalle."
- Cada fila: nombre, título, badges de tipo, prioridad cruda, "N tareas" y "📷 Fotos req.".
- Al pasar el mouse: tacho (borra **sin confirmar**) y "Usar ›".
- Orden: `-created_date`.

---

## 6. Mis Órdenes (/mis-ots, PortalOperarioApp), flujo autenticado en el teléfono

### Carga

- `getWorkOrdersForUser()` **sin `scope`**: un admin o gerente ve todo su sector.
- Cache en `localStorage` con la clave `mis-ots-cache-{userId}`, usado como dato inicial. `staleTime` 5 min, sin reintentos.
- **Activas** = todo lo que no es completada ni cancelada. **Historial** = completadas y canceladas.

### Pantalla

- Primera carga sin datos: esqueleto con brillo animado.
- **Banner** amber (`WifiOff`, o spinner si sincroniza):
  - "Sincronizando N acción(es) pendiente(s)..."
  - "Sin conexión — trabajando con cache. N acción(es) esperando sincronizar." / "…Tus OTs se guardan y se envían al volver online."
  - "N acción(es) pendiente(s) de sincronizar."
- **Header:** ícono en gradiente azul, "Mis Órdenes de Trabajo", "{displayName} · {N} activa(s)" (contador animado) y botón **Escanear QR** (`ScanLine`, `#2563eb`).
- **Stepper:** ● Asignada (#3b82f6) → ● En Progreso (#0ea5e9) → ● Validación (#f59e0b) → ● Completada (#10b981).
- **MisOrdenesFiltros:**
  - Toggle "Activas (n)" / "Historial (n)".
  - Búsqueda con placeholder "Buscar por título, ubicación o código…" (busca en title, location, code, asset_name, project_name).
  - Select de tipo: Todos los tipos, Mant. Preventivo, Mant. Correctivo, Instalación, Inspección, Reparación, Emergencia.
  - Select de prioridad: Toda prioridad, Urgente, Alta, Media, Baja.
  - Botón "Limpiar panel" (`X`), que también vuelve a Activas.
- **Secciones** (barra de color, ícono, título, contador y "· subtítulo"):
  1. "En Progreso" · "Terminá estas antes de empezar nuevas" (`Clock`, sky): botón **Finalizar y Reportar** (`Flag`, `#059669`).
  2. "Para Empezar" · "Tocá Iniciar cuando llegues al sitio" (`Play`, blue): botón **Iniciar** (`#2563eb`). Acá caen todos los demás estados, incluido `obra`.
  3. "Enviadas al Jefe" · "Esperando validación del Jefe de Sitio" (`Lock`, amber): bloque "Esperando validación".

### Tarjeta (OTCard)

- Fondo `#1a2333` con una franja de color a la izquierda según estado:

  | Estado | Color franja |
  |---|---|
  | pendiente, asignada | #3b82f6 |
  | en_progreso | #0ea5e9 |
  | pendiente_validacion | #f59e0b |
  | completada | #10b981 |
  | cancelada | #ef4444 |

- Badge de estado: Pendiente o Asignada en azul, En Progreso en sky, En Validación en amber, Completada, Cancelada.
- Chip "Pendiente sync" si tiene acciones en cola.
- Chip de prioridad en mayúsculas:

  | Prioridad | Clases |
  |---|---|
  | Urgente | bg-orange-500 |
  | Alta | bg-red-500/80 |
  | Media | bg-slate-600 |
  | Baja | bg-slate-700 |

- Título, "Mant. Preventivo · {code}", `MapPin` + location.
- Recuadro rojo "RECHAZADA POR EL JEFE:" + el comentario.

**Historial:** tarjetas con badge, fecha `completed_date` (es-AR) y "Validado por X".

**Vacíos**
- "No tenés órdenes asignadas" / "Ninguna orden coincide con los filtros" + "Limpiar filtros".
- En historial: "Todavía no completaste ninguna orden".

### Iniciar

1. Diálogo de confirmación:
   - Título "¿Iniciar orden de trabajo?".
   - Texto "Se registrará tu ubicación GPS y la hora de inicio. No podrás deshacer esta acción." y "{título}".
   - Sin conexión: "Sin conexión: la acción se guardará y se sincronizará al volver online."
   - Botones Cancelar / "Sí, Iniciar".
2. Captura GPS: alta precisión, timeout 8 s, `maximumAge` 0.
3. Llama a `transicionEstadoOT('iniciar', {assigned_name: displayName, assigned_to: user.id, gps | gps_status})`.
4. Actualiza la OT en el cache y en `localStorage` sin esperar al servidor. Toast con el mensaje del backend.
5. **Sin conexión:** cola `operario-pending-transitions` en `localStorage`. Toast "OT iniciada (sin conexión). Se sincronizará al volver online."

### Finalizar: ReporteForm

Hoja inferior renderizada sobre el body.

- Título "Reporte de Cierre". Subtítulo "Al guardar, la OT se envía al Jefe de Sitio". Debajo, el título de la OT.
- **Fotos de Evidencia:** miniaturas de 16×16 con X. Botón "Agregar foto" (una a la vez, cámara trasera). Arranca con las fotos actuales de la OT.
  - Error: "Error al subir foto". Sin conexión: "Sin conexión — no se pudo subir la foto. Podés guardar el reporte sin fotos y se sincronizará después."
- **Materiales Usados:** arranca con los de la OT. Input "Nombre del material", cantidad (default 1) y botón "+". Se agrega `{material_name, quantity, unit_cost: 0}`. Se muestran como "nombre  Nu".
- **Materiales Faltantes:** aviso "El motivo es obligatorio para cada faltante". Input "Material faltante", cantidad, select "Seleccionar motivo \*" con estas opciones:
  - Sin stock en pañol
  - Material dañado
  - Cantidad insuficiente
  - No corresponde al trabajo
  - Otro

  Botón "+ Agregar faltante". Errores: "Indicá el nombre del material faltante" / "Debes seleccionar un motivo para el material faltante".
- **Observaciones:** placeholder "Notas del trabajo...".
- **Botón** "Enviar al Jefe de Sitio": llama a `finalizar` con `{materials_used, materiales_faltantes, notes, photos}`. El backend reemplaza estos campos. Toast "OT enviada a validación".
- **Sin conexión:** queda en cola con estado optimista `pendiente_validacion`. Toast "Reporte guardado (sin conexión). Se enviará al jefe al volver online."
- **No hay checklist, firma ni motivos de incompleto en este flujo.**

### Escáner QR (QRScannerModal)

Usa `html5-qrcode`: 12 fps, recuadro del 70% del lado menor. Prueba la cámara trasera, después la frontal, después una trasera por id.

**Cómo interpreta el código:** URL con `loc`/`ubicacion` → ubicación; `asset` → activo; `ot` → OT. Una URL con otros parámetros → desconocido. Cualquier otra cosa → id crudo.

**Textos**
- Título "Escanear QR" o "Ingresar código".
- Pie: "Apuntá la cámara al código QR" / "¡Código detectado!" (flash verde de 350 ms). Links "Manual" y "Usar cámara".
- Error de cámara: "No se pudo acceder a la cámara. Verificá los permisos del navegador o ingresá el código manualmente." con botones "Reintentar cámara" e "Ingresar código manualmente".
- Código no reconocido: "Este código QR no corresponde a una OT ni a una ubicación" / "Apuntá a otro código o usá el ingreso manual", con botones Reintentar / Manual / Cerrar.
- Ingreso manual: "Escribí el código tal como aparece en el QR (URL completa o ID). Se reconoce igual que al escanear." Placeholder "https://.../orden-trabajo?ot=...  o  ID". Error: "Ese código no corresponde a una OT, ubicación ni activo." Botones "Buscar" / "Volver a escanear".

**Qué pasa después**
- **Ubicación:** `publicFichar.getWorkOrderForLocation`. Sin conexión, usa el cache filtrado por `location_qr_id`.
- **Activo:** `getWorkOrdersForAsset`.
- **OT o id crudo:**
  - Toast de carga "Buscando orden de trabajo…".
  - Llama a `getWorkOrder`. Si no la encuentra, prueba como ubicación.
  - Si tampoco: "No se encontró ninguna OT ni ubicación con ese código QR". Error de red: "Error al buscar la OT".
- Con la OT encontrada aplica `canActOn`:
  - pendiente o asignada: cualquiera puede.
  - en_progreso: solo el dueño (mismo `assigned_to`, mismo `assigned_name` normalizado, mismo `operario_sesion`, o la OT sin dueño).
  - Si no puede actuar: "Esta OT ya está enviada al jefe para validación" / "Esta OT la está trabajando otro operario" / `La OT "{t}" está {status}`.
  - Si puede: en_progreso abre el ReporteForm; si no, el diálogo de Iniciar.

### LocationOTListModal

- Header con `MapPin`, nombre, "N OT activa(s)" (y " · sin conexión" si aplica), botón para escanear otra y X.
- Estados de carga, error ("No pudimos cargar las OTs de esta ubicación" + "Reintentar") y vacío ("No hay OTs activas en esta ubicación" / "Acercá un código cuando haya tareas asignadas"; sin conexión: "Sin conexión y sin OTs guardadas de esta ubicación" / "Conectate una vez para descargarlas.").
- Sección "Activas (n)": filas con badge (En Validación en purple), título, tipo y ubicación. Las bloqueadas muestran `Lock` + motivo. Ícono a la derecha: Play / Flag / Lock.
- Sección "Completadas (n)": tachadas.

### Sincronización offline (`lib/offlineSync`)

- Reproduce la cola en orden.
- Error 4xx o respuesta con `{error}` → conflicto: descarta ese ítem y los siguientes de la misma OT, y muestra el toast `"{título}": {mensaje}`.
- Error 5xx o de red → se detiene y conserva la cola.
- Al terminar: toast "N acción(es) sincronizada(s)".

---

## 7. Portales públicos

### /portal-operario?loc= o ?asset= (PortalOperario)

**Carga**
- `getWorkOrderForLocation` o `getWorkOrdersForAsset`. Guarda en cache `localStorage` con la clave `portal-loc-{id}` o `portal-asset-{id}`.
- Sin conexión, usa ese cache. Sin `loc` (ni `asset`): pantalla de error "QR no válido" / "No se encontró este establecimiento.".

**Pantalla de clave**
- Ícono `Lock` en gradiente. Título "Portal Operarios" y `MapPin` + nombre.
- **Tu nombre:** placeholder "Ej: Juan Pérez"; ayuda "Se registra en cada OT que toqués para trazabilidad."
- **Clave de acceso:** `••••••••`, teclado numérico.
- Botón "Ingresar" (`ShieldCheck`).
- Errores: "Ingresá tu nombre para registrar tu trabajo." / "Clave incorrecta. Consultá con tu supervisor."
- Clave y nombre quedan en `sessionStorage` (`operario_clave`, `operario_nombre`). Al recargar la página vuelve a pedir la clave.

**Lista**
- Header con gradiente primary→indigo, `Building2`, nombre y dirección.
- Barra de progreso del día: (completadas + en validación) / total.
- Vacío: "¡Todo al día!" / "No hay órdenes pendientes para este establecimiento."
- "N orden(es) pendiente(s)": tarjetas con franja de color por prioridad, `Wrench`, título, tipo (con "🚨 Emergencia") y chip de prioridad. Si está bloqueada: `Lock` + motivo.
- "En validación (n)" (amber) y "Completadas (n)" (tachadas).
- Banner superior offline: "Sin conexión — tus OTs se guardan y se envían al volver online." / "Sincronizando…" / "N acción(es) pendiente(s) de sincronizar."

### EjecutarOTEnPortal (lo usan PortalOperario y PortalTablet)

**Header**
- Rojo si es urgente; si no, gradiente primary→indigo.
- "← Volver a la lista".
- Chip de prioridad: Baja, Media, Alta o "🚨 URGENTE".
- Título y `MapPin` + nombre del lugar.
- Píldora "● En progreso" cuando ya se inició.

**Cuerpo**
- "Instrucciones" (colapsable, abierta).
- "Fotos de referencia" (grilla de 2).
- "Tareas del checklist": **solo lectura**, no se puede marcar.
- "Fotos del trabajo realizado \*" (o "(opcional)"). Botón "Sacar foto" / "Agregar otra foto".
  - Sin conexión, las fotos quedan en base64 con la etiqueta "Pendiente" y se suben al sincronizar.

**Cuántos pasos** (`decideSteps`)
- Si hay ítems de checklist pendientes o se requieren fotos: **2 pasos**. Primero "Iniciar Orden" (`Play`, azul), después "Finalizar y Enviar".
- Si no: **1 paso**. Botón "Finalizar y Enviar al Jefe", que hace iniciar y finalizar seguidos.
- El botón se deshabilita si se requiere foto y no hay ninguna ("⚠ Esta OT requiere al menos una foto").

**Mensajes de GPS:** "Obteniendo ubicación GPS..." / "Sin GPS — se guardará sin ubicación" / "Ubicación capturada". Mientras guarda: "Localizando..." / "Guardando..." / "Iniciando...".

**Llamadas**
- Usa `transicionEstadoOT` con `auth_mode:'portal'`, la clave y el nombre de `sessionStorage`.
- Si no hay clave en sesión, abre OperarioClavePrompt: "Clave de operario" / "Ingresá la clave para registrar el trabajo." con Cancelar / Confirmar.
- En finalizar: `photos = [...fotos de la OT, ...nuevas]` y `pending_photos`.
- Después de iniciar o finalizar, vuelve a la lista con la OT actualizada.

### /tablet (PortalTablet)

- **Activar Tablet**, ícono `Tablet`, texto "Ingresá el código que te dio tu jefe de sitio".
- Campo "Código de activación", placeholder "Ej: NOLBERTO-T1". Botón "Vincular tablet" (`Link2`).
- Errores: "Código inválido. Verificá con tu supervisor." / "Error de conexión. Verificá tu red e intentá nuevamente."
- La sesión `{tablet_id, nombre, jefe_sitio}` queda en `localStorage` con la clave `tablet_session_v1`.
- **Lista:** header con nombre de la tablet y `User` + jefe. Botones refrescar (`RefreshCw`) y desvincular (`LogOut`, **sin confirmación**). Barra de progreso completadas / total.
  - Vacío: "¡Todo al día!" / "No hay órdenes pendientes para tu cuadrilla."
  - Las tarjetas suman `User` + asignado y `MapPin` + ubicación.
  - Sección "Completadas (n)".
- **Backend `getOTsForTablet`:** devuelve las OTs con `jefe_sitio` igual al de la tablet, en todos los estados. Error si la tablet está desactivada: "Tablet no válida o desactivada".

### /ejecutar-ot?ot= o ?loc= (EjecutarOrdenPublica)

- **Carga:** "Cargando orden de trabajo...". QR inválido: "QR no válido" / "El código QR escaneado no es válido o expiró."
- Con `loc` y varias OTs: pantalla de selección con el logo, nombre, "Seleccioná una orden", "Hay N órdenes activas en este establecimiento". Tarjetas con franja por prioridad, prioridad en mayúsculas, tipo, asignado y descripción.
- Sin OTs: "Sin órdenes activas" / "No hay órdenes de trabajo asignadas a este establecimiento por el momento." / "Consultá con tu jefe de sitio."
- OT completada, cancelada o **pendiente_validacion**: va directo a la pantalla final.
- **Pantalla de trabajo** (fondo rojo si es urgente o emergencia):
  - Chip de tipo con estos labels: Mantenimiento Preventivo, Mantenimiento Correctivo, Instalación, Inspección, Reparación, EMERGENCIA.
  - "Para: {asignado}".
  - "Progreso del checklist d/t — %".
  - Pestañas **Tareas / Fotos / Firma**:
    - **Tareas:** se pueden tildar. Vacío: "Sin lista de tareas" / "El jefe de sitio no agregó un checklist para esta orden." Completo: "¡Todas las tareas completadas!".
    - **Fotos:** "Fotos ANTES" y "Fotos DESPUÉS", con botón "Sacar / Subir Foto".
    - **Firma:** "Tu nombre completo" (placeholder "Ej: Juan García", mínimo 3 caracteres). Lienzo de 600×200 con "✍️ Dibujá tu firma aquí", "Borrar", "Confirmar Firma". Ya firmado: "Firma registrada correctamente" + "Volver a firmar".
  - Estado: "Checklist completo/(d/t)" · "Firmado" / "Sin firmar".
  - Botón "Guardar y Finalizar" (`Sparkles`). Exige firma ("Necesitás firmar para poder guardar"). Captura GPS con un tope de 10 s y pide la clave si hace falta.
  - Envía `updateWorkOrder` con `status: allDone ? 'pendiente_validacion' : 'en_progreso'` y GPS.
- **Pantalla final:** "¡Orden enviada al Jefe de Sitio!" / "La orden quedó pendiente de validación por el Jefe de Sitio." / "Firmado por: X" / "Podés cerrar esta ventana."

### /orden-trabajo?ot= (OrdenTrabajoPublica)

- Si la OT está activa, **redirige** a `/ejecutar-ot?ot=`.
- Si está completada o cancelada, muestra una ficha de solo lectura: tipo, código, estado con punto parpadeante, prioridad, Establecimiento, Equipo / Activo, Asignado a, Fecha programada ("EEEE d 'de' MMMM yyyy"), "Descripción de la tarea", "Lista de tareas" (colapsable con %), "Materiales" (× cantidad), Notas, "Esta orden ya fue completada" y el pie "DH1 Software · Sistema de Gestión".

### /ejecutar-ot-simple?ot= (EjecutarOTSimple)

- Header, instrucciones, fotos de referencia, "Fotos del trabajo realizado" y el botón "Marcar como Completada".
- Envía `updateWorkOrder` con `status:'completada'`. **Hoy el backend lo rechaza** (ver §12).
- Pantalla final: "¡Listo!" / "La orden fue marcada como completada." / "Podés cerrar esta pantalla."

### Acciones de `publicFichar` relacionadas con OT

| Acción | Qué hace |
|---|---|
| `getWorkOrder` | Devuelve la OT por id |
| `getWorkOrderForLocation` | Busca por `location_qr_id`, después por `location_qr_name`, después match aproximado de `location`. Mismo sector (o sin sector). Solo activas. Ordena urgente → alta → media → baja |
| `getWorkOrdersForAsset` | Igual, por `asset_id` y luego por `asset_name` |
| `uploadFile` | Imágenes jpeg, png, webp o gif hasta unos 10 MB. Errores: "Tipo de archivo no permitido" / "Archivo demasiado grande (máx 10MB)" |
| `verifyOperarioPassword` | Valida la clave de operario |
| `updateWorkOrder` | Exige clave. Pasar a `pendiente_validacion` desde en_progreso → finalizar; a `en_progreso` desde pendiente o asignada → iniciar; cualquier otro cambio de estado → 400 "Cambio de estado no soportado vía este endpoint. Usá transicionEstadoOT.". Sin cambio de estado aplica solo checklist, photos, signature_url/name, campos GPS, fecha_inicio_real, notes, materiales y motivos. Si la OT está completada o cancelada → 403 "No se puede modificar una OT completada o cancelada" |
| `activateTablet` | Valida el código de la tablet |
| `getOTsForTablet` | OTs del jefe de la tablet |

---

## 8. Visibilidad y permisos (backend)

### `getWorkOrdersForUser({scope?, includeArchived?})`

Usa `getVisibleWorkOrders` (`shared/workOrderVisibility.ts`).

1. El sector del caller sale de la ficha de Employee. Sin sector → 403 "Sin sector asignado".
2. Trae todas las OTs del sector, ordenadas por `-updated_date`. **Las OTs sin `sector_id` quedan excluidas.**
3. Una OT es visible si:
   - **a.** El caller tiene `admin_view` (permiso "Ver Todo" del rol de empleado, o es super-admin sin ficha) **y** no pidió `scope:'own'` → ve todo el sector.
   - **b.** Es "propia": es el creador, o `jefe_sitio_email` es su email, o `assigned_to` es su id, o `assigned_name` coincide con su nombre, o `jefe_sitio` coincide con su nombre.
   - **c.** Si tiene rol de campo y no pidió `'own'`: OTs de su jefe. El jefe se busca por la Tablet cuyo nombre es el nombre del operario y, si no hay, por `Employee.assigned_jefe_sitio`. Matchea por creador, email del jefe o `jefe_sitio`.
4. Sin `includeArchived` se excluyen las archivadas.

**Respuesta:** `{orders, total, archived_count, role, ctx}`.

### Permisos de escritura (`resolveOtPermissions`)

- Si el caller no tiene ficha de empleado, es super-admin: puede todo.
- Si tiene ficha, se usa `RolePermission[role].WorkOrder`. Cuando una acción no está definida, aplica el comportamiento anterior:
  - `update` y `admin_view` → si el rol es de nivel admin.
  - `approve` → si el rol es admin o jefe de sitio.
  - `delete` → rol admin, o gerente en bapro.

**Listas de roles (`lib/roles.js`)**
- Nivel admin: `admin`, `gerente`, `gerencia`, `administrativo`, `gerente_general`.
- Campo: `jefe_sitio`, `jefe de sitio`, `inspector`, `tecnico`, `supervisor`, `operario`, `operario_portal`.
- Jefe: `jefe_sitio`, `jefe de sitio`.
- Pueden cambiar de sector: `gerente_general`.

---

## 9. Subcomponentes del detalle

### WorkOrderChecklist

- Barra "d de t completadas" con %. Se pone verde al 100%.
- Cada tarea:
  - Círculo grande para tildar (`CheckCircle2` emerald / `Circle`).
  - Texto, tachado cuando está hecha.
  - Miniatura de foto si tiene.
  - Chevron para expandir. Expandida muestra: input "Nota de esta tarea (opcional)...", botón "Cámara/Foto" (sube con UploadFile; error "No se pudo subir la foto. Intentalo de nuevo."), X para quitar la foto y tacho para borrar la tarea.
- Agregar: input "Nueva tarea..." (Enter agrega) y botón `+`. La tarea nueva es `{id: Date.now(), task, completed:false, notes:'', photo_url:null}`.

### WorkOrderMaterials

- **"Materiales a usar"** con contador y botón "+ Agregar".
  - Cada material: `CheckCircle2` + nombre, "N u. · $X/u · $total" en moneda ARS sin decimales, y tacho.
  - "Total estimado" si es mayor a 0. Vacío: "Sin materiales registrados".
  - Formulario "Nuevo material": select "Del inventario..." (`Material.list`, opciones "nombre — stock en stock — $costo"; trae el costo), o input "O escribir nombre...". Campos "Cantidad" (1) y "Costo unit. (opc.)" (0). Botones Agregar / Cancelar.
- **"Faltantes"** con botón "+ Reportar" y el texto "Registrá materiales que te faltaron durante la tarea."
  - Cada fila: "Faltó: N u. · motivo". Vacío: "Sin faltantes reportados ✓".
  - Formulario "¿Qué te faltó?": "Nombre del material...", "Cantidad", "Motivo (opc.)" con placeholder "¿Por qué?". En este formulario el motivo es **opcional**, pero el backend lo exige en cualquier transición.

### WorkOrderPhotos

- Grilla de 2 o 3 columnas, fotos cuadradas.
- Al pasar el mouse: zoom (abre en pantalla completa) y X. En móvil la X está siempre visible.
- Botones "Cámara" (cámara trasera) y "Galería" (varias).
- "Subiendo fotos..." y "N foto(s)". Sin compresión.

### WorkOrderSignature

- "Firma Digital" (`PenTool`).
- Sin firma: input "Nombre del firmante", lienzo de 400×120 (fondo `#f8fafc`, trazo `#1e293b` de 2 px), "Dibujá la firma en el área de arriba", botones "Limpiar" y "Guardar Firma" (sube `firma.png`).
- Con firma: imagen, "Firmado por: X" y "Borrar firma".

### WorkOrderIncompleteReason

- "¿Por qué no se terminó?" con badge "N motivo(s)" y botón "+ Agregar motivo".
- Ayuda: "Si la OT quedó incompleta, contanos por qué. Esto ayuda al supervisor a tomar acción."
- Panel "Seleccioná o escribí el motivo" con estos motivos rápidos (se ocultan los ya cargados):
  - Faltó material
  - No había acceso al lugar
  - Faltó herramienta o equipo
  - Clima no permitió trabajar
  - Problema con el equipo/instalación más grave de lo esperado
  - Faltó personal
  - El establecimiento estaba cerrado
  - Se necesita otro tipo de trabajo primero
- Input "O escribí tu propio motivo..." + "Agregar" y "Cancelar". No permite duplicados.
- Vacío: "Sin motivos de incompleto — ¡bien! ✓".
- Cargar al menos un motivo **habilita aprobar o completar aunque falte checklist o fotos**.

### QRCodeModal

- Título "Código QR". Tarjeta blanca con título, subtítulo y QR de 220 px (colores `#0a1628` sobre blanco, corrección de errores M).
- Botones "Bajar" (`QR_{título}.png`), "Imprimir" (ventana con tarjeta y pie "DH1 Software") y "Copiar" / "Listo".

### Modo Campo (ModosCampo)

- **Banner:** "Modo Campo Activo" / "Mostrando mis OTs asignadas · {full_name}".
- **Contadores:** Activas / Urgentes (en rojo si hay &gt; 0) / Vencidas (amber; calculadas con fecha pasada en cualquier estado activo, **no** con la regla de vencida).
- **Fuente:** `WorkOrder.list('-created_date',200)` sujeto a RLS. Filtra `assigned_name` o `assigned_to` igual al `full_name` de la plataforma (sin acentos de por medio, comparación exacta en minúsculas).
- **"Mis órdenes activas":** ordenadas urgente → alta → media → baja. Tarjeta coloreada por prioridad, "dd/MM" y "⚠ Vencida".
  - "Iniciar" solo en pendiente.
  - "Completar" en en_progreso, que en realidad hace `finalizar`. Antes chequea checklist ("Faltan N tarea(s) del checklist") y fotos ("Esta OT requiere al menos una foto"); si falta algo, abre el detalle.
- **"Últimas completadas":** las primeras 5. Vacío: "¡Todo al día! Sin OTs pendientes.".

---

## 10. Dashboard (parte de OT)

**Fuente:** `getDashboardMetrics({scope: isGerente ? undefined : 'own'})`. Se excluyen las archivadas.

**Filtros (DashboardFilters)**
- "Filtrar" + contador.
- Rango: 7 días / 30 días / 3 meses / Todo. Se aplica sobre `updated_date || created_date`.
- Select "Todos los jefes": alias por `jefe_sitio`, igual que en /ordenes.
- Prioridad: Urgente / Alta / Media / Baja (toggle).
- "Limpiar".

**Hero**
- Saludo: "Buenos días" (antes de las 12), "Buenas tardes" (antes de las 19), "Buenas noches", más el nombre.
- "{p} OTs pendientes · {e} en progreso · ⚠ {v} vencidas".
- Botones "Crear OT" (`Zap`) y "Ver OTs".

**Alertas:** "{n} OT(s) vencida(s)" → /ordenes.

**Accesos rápidos:** "Crear OT · Orden rápida", "OTs · Gestionar".

**Tarjetas de indicadores**

| Tarjeta | Valor | Subtítulo / extra |
|---|---|---|
| OTs Pendientes | pendiente + asignada | "{n} completadas este mes"; alerta con el número de vencidas |
| En Progreso | en_progreso | "{eficiencia}% de eficiencia total" (completadas / no canceladas) |
| Urgentes | urgente o alta en estados activos (incluye obra y validación) | "Alta prioridad activas" |

**Sección "Operación"**
- **OTsPendientesPanel:** "Órdenes de Trabajo" + "N activas" + "Ver todas".
  - Torta "Por Estado" (sin completada ni cancelada): Pendiente #F59E0B, Asignada #3B82F6, En Progreso #6366F1, En Espera #94A3B8. **No incluye obra ni pendiente_validacion.**
  - Barras "Por Prioridad (activas)": Urgente #EF4444, Alta #F97316, Media #3B82F6, Baja #94A3B8.
  - Vacíos: "Sin datos" / "Sin OTs activas".
- **"Actividad reciente":** las 6 últimas por `updated_date`. Prioridad en píldora, `location_qr_name`, estado y tiempo relativo ("hace …").

**"KPIs por Jefe de Sitio"** (KpisJefeSitio)
- Agrupa por `assigned_name` igual a un empleado con rol "jefe". Muestra los 10 primeros.
- Score = eficiencia de pendientes × 0.5 + eficiencia de OTs × 0.3 + (20 sin vencidos; si hay, 20 − 4 × vencidos, mínimo 0).
- Colores del score: ≥80 emerald, ≥60 amber, menos red.

**"Métricas de Operación"** (MetricasOperacion)
- Píldoras: Eficiencia, Urgentes, Vencidas (con fecha pasada, no con la regla de vencida), Proyectos, Técnicos.
- Radar "Salud Operativa" en escritorio; barras en móvil.
- Barras "OTs Creadas vs Completadas" de los últimos 6 meses.

---

## 11. Exportaciones

### PDF de una OT (`exportWorkOrderPDF(order, [])`, botón del detalle)

A4 vertical, márgenes de 14 mm. Archivo: `OT_{code|id}_MEJORES.pdf`.

1. **Cabecera** oscura con el logo de MEJORES (texto "MEJORES" si no carga), "info@mejores.com.ar · +54 (11) 4000-0000" y "ORDEN DE TRABAJO".
   - Badge de estado:

     | Estado | Texto | Color RGB |
     |---|---|---|
     | pendiente | PENDIENTE | 150,150,150 |
     | asignada | ASIGNADA | 80,80,80 |
     | en_progreso | EN PROGRESO | 41,128,185 |
     | en_espera | EN ESPERA | 180,120,0 |
     | completada | COMPLETADA | 39,174,96 |
     | cancelada | CANCELADA | 150,50,50 |

     **No hay color para obra ni pendiente_validacion**: caen en el de PENDIENTE.
   - "Prioridad: X" (baja gris, media azul, alta naranja, urgente rojo).
   - "Codigo: … | Tipo: …" (sin tildes en todo el PDF).
2. **Tarjeta de datos:** Titulo de la tarea; Lugar / Ubicacion; Equipo o activo; Asignado a; Fecha programada; Fecha completada; Impreso el (dd/MM/yyyy).
3. "Descripcion del trabajo".
4. **"LISTA DE TAREAS":** barra de progreso (verde al 100%, azul &gt; 50%, si no roja) y "d de t tareas completadas (p%)". Cada tarea con "OK", "Nota: …" y la foto con el texto "foto referencia".
5. **"MATERIALES A UTILIZAR"** (siempre): columnas Material / Descripcion | Cantidad | Unidad ("-") | Observaciones (costo unitario). Agrega filas punteadas en blanco: max(5 − n, 4). Al final "TOTAL MATERIALES" si es mayor a 0.
6. **"MATERIALES QUE FALTARON"** "(para que el operario complete en campo)": columnas Material que faltó | Cantidad | Unidad | Motivo / Comentario, con las mismas filas en blanco.
7. **"POR QUE NO SE TERMINO"** / "Motivos informados por el operario" (si hay motivos).
8. **"FOTOS DE LA OBRA"**: 3 por fila, con "Foto N".
9. "HORAS TRABAJADAS": nunca sale, porque siempre se le pasan `[]`.
10. "NOTAS Y OBSERVACIONES".
11. **Firmas:** "FIRMA DEL OPERARIO" (nombre asignado o "Nombre y apellido"; firma digital y "Firmado: X" si existe) y "FIRMA DEL JEFE DE SITIO" con "Fecha: _____ / _____ / _________".
12. **Pie en cada página:** "MEJORES - Mantenimiento, Obras y Servicios | info@mejores.com.ar" y "{code|OT} | Pagina i de n".

No hay exportación a Excel ni CSV de OTs en este módulo.

---

## 12. Detalles fáciles de pasar por alto

1. **`/ejecutar-ot-simple` no funciona.** Envía `status:'completada'` a `updateWorkOrder`, el backend responde 400 y la pantalla lo traga en silencio (solo cambia el mensaje de GPS). Además, ese es el QR que genera la lista o el Kanban cuando la OT no tiene `location_qr_id`.
2. **EjecutarOrdenPublica:**
   - Si la OT está en pendiente o asignada y se completa todo el checklist, el pedido a `pendiente_validacion` da 400 (solo se acepta desde en_progreso). Se ve "Error al guardar: …".
   - Al finalizar, la **firma no se guarda**: `signature_*` no se pasa al motor de estados.
   - Siempre **reemplaza** `photos` por antes + después, borrando las de referencia.
   - La pantalla final dice "enviada al Jefe" aunque haya quedado en en_progreso.
3. **EjecutarOTEnPortal** no muestra toast cuando el backend responde `{error}`: el botón vuelve sin feedback. PortalTablet lo usa sin `isOnline` ni cola offline, y sin nombre (`operario_sesion` vacío), así que no hay control de propiedad. Al iniciar, vuelve a la lista.
4. **Claves de cache distintas.** El panel de detalle, ModoCampo y CrearOT invalidan `['workorders']`, pero el tablero usa `['workorders-board']`. El tablero se actualiza solo por la suscripción en tiempo real, por el `staleTime` de 30 s o por pull-to-refresh.
5. **Validación en Kanban o Grilla.** "Aprobar" desde la grilla y arrastrar Validación → Completada ejecutan `aprobar`. Arrastrar Validación → En Progreso ejecuta `rechazar` **sin motivo** y falla con "Debe indicar un motivo de rechazo".
6. **`completar` es flexible**: se puede cerrar desde pendiente, asignada o en_progreso. Cargar un solo "Motivo incompleto" alcanza para saltear el checklist y las fotos obligatorias.
7. **El portal no puede completar.** El operario nunca cierra una OT: solo la lleva a `pendiente_validacion`.
8. **Guardar en el detalle** bloquea si falta checklist o fotos, pero el autoguardado ya persistió todo lo editado. El toast "Guardado" sale en cada autoguardado (cada 400 ms de inactividad).
9. **El campo Responsable** borra `assigned_to` cuando el nombre no coincide con nadie. Un error de tipeo le quita la visibilidad al operario.
10. **`rechazo_comentario` nunca se limpia.** Queda visible en /mis-ots y en el resumen ("Rechazo anterior") aunque la OT se re-finalice o se apruebe.
11. **"Vencida" tiene dos reglas.** Kanban, tarjetas, filtro avanzado y Dashboard usan la regla nueva (solo en_progreso con fecha pasada, en hora Argentina). ModoCampo y MetricasOperacion usan "fecha pasada" en cualquier estado activo.
12. **`scheduled_date` se estampa con la fecha de hoy** en toda OT creada sin fecha, por la automatización.
13. **`sector_id`** se estampa después de crear la OT. Sin sector resuelto queda `'SIN_SECTOR'` y desaparece de todas las vistas, porque el filtro excluye OTs sin sector y el valor no coincide con ningún sector real. Las OTs viejas sin `sector_id` no se ven.
14. **Plantillas:**
    - Desde el header se crea la OT de inmediato, sin toast al tener conexión y sin ubicación.
    - Desde CrearOT **no** se copian checklist ni `estimated_hours`.
    - Las plantillas solo las leen admin y gerente (RLS). Para un jefe la lista sale vacía.
    - Borrar plantilla no pide confirmación y el botón solo aparece al pasar el mouse.
15. **Al convertir a Obra** desde el desplegable de Estado o arrastrando a la columna Obra **no se crea** el Pendiente. Solo el botón "Obra" del footer lo crea.
16. **Permiso de borrar.** El frontend muestra "Eliminar" a todo admin de plataforma, pero `eliminarOT` decide por la ficha de empleado (admin, o gerente solo en bapro). Puede aparecer el botón y responder 403.
17. **/mis-ots llama a `getWorkOrdersForUser` sin `scope`.** Un gerente o admin ve todo el sector como si fuera "suyo". Las OTs en `obra` caen en "Para Empezar" con botón Iniciar, que el backend rechaza con 409.
18. **Prioridades en /mis-ots:** Urgente es naranja y Alta es roja, al revés que en el resto de la app.
19. **Cola de creación offline** (`useOfflineQueue`): la usan AppLayout, WorkOrders y CrearOT a la vez. Las tres escuchan el evento `online` y pueden sincronizar en paralelo: hay riesgo de OTs duplicadas. Además, `sw.js` ya no maneja `sync-work-orders`, así que el registro de sincronización en segundo plano no hace nada.
20. **Clave de operario:** una sola, compartida. Vive como hash en `SecurityConfig` o, si no, en la variable de entorno `OPERARIO_PASSWORD`. Clave y nombre se guardan en `sessionStorage` y se piden de nuevo al cerrar la pestaña.
21. **Tarjeta del Dashboard** "Pendientes SAP" ahora depende del módulo `Pendientes`. La torta por estado no muestra obra ni validación.
22. **Historial** (diálogo "Historial"):
    - Pestañas "Por Establecimiento" y "Archivadas (badge)".
    - Contadores Total / Completadas / Pendientes. En Archivadas: Pendientes siempre 0 y Completadas = Total.
    - Filtro por jefe (solo gerente, desde `getOperariosSector`, jefes reales).
    - Placeholder de búsqueda: "Buscar..." o "Buscar archivadas (jefe, creador, establecimiento...)".
    - Vacío en Archivadas: "Sin OTs archivadas para este filtro. Las OTs completadas se archivan automáticamente a los 30 días."
    - Cada fila: badge de estado en minúsculas, "Archivada", "Urgente", 📍 ubicación, 👤 asignado, 🧑‍💼 jefe, ✍️ creador, 📅 creación, ✅ completada, 🗄️ archivado. Tocar una fila abre el panel de detalle **sin cerrar el diálogo**.
    - Pie: "N órdenes".
    - Colores de estado: solo 5 definidos; obra y validación caen en gris.
23. **`code`:** ningún flujo lo genera. El detalle muestra "OT-XXXXXX" a partir del id.

---

## 13. Partes que parecen sin uso (código muerto)

Lo comprobé con grep sobre `src/` de dh1v1 buscando el nombre como palabra completa y excluyendo el propio archivo. También revisé `App.jsx`, Sidebar y MobileBottomNav: no hay ningún import ni ruta que los use.

| Pieza | Evidencia |
|---|---|
| `components/operario/OTEjecucionModal.jsx` | 0 imports |
| `components/operario/ValidacionJefePanel.jsx` (pantalla "Validación de OTs" con aprobar y rechazar) | 0 imports. La validación real está en ReporteOperarioResumen, dentro del panel |
| `components/operario/OTOperarioCard.jsx` | 0 imports |
| `components/workorders/WorkOrderTimeLogs.jsx` ("Registro de Horas") | 0 imports. La entidad TimeLog no se usa en la UI |
| `components/workorders/WorkOrderCostSummary.jsx` ("Resumen de Costos") | 0 imports |
| `hooks/useWorkOrderEditProtection.js` | 0 imports |
| `components/dashboard/RecentWorkOrders.jsx` | 0 imports |
| `exportOTsPDF` (reporte apaisado "REPORTE DE ÓRDENES DE TRABAJO") | Se importa en WorkOrders.jsx pero nunca se llama (`grep "exportOTsPDF("` solo encuentra la definición) |
| `useOfflineQueue.queueUpdate` | No hay llamadas |
| Función `corregirLocationOTs` | No se invoca desde `src` ni desde ningún workflow. Solo sirve como herramienta manual para admin |
| Dentro de WorkOrderDetailPanel | `activeEmployees` solo como respaldo, `canComplete`, `refetch`; íconos `Circle`, `CheckCircle2`, `Pencil` importados sin uso |
| Dentro de WorkOrders.jsx | `pendingCount`, `isSuperAdmin`, `format`, `es`, `isPast`, `parseISO`, `WorkOrderQRButton`, `Badge` importados o declarados sin uso |
| Dentro de CrearOT | `ChecklistItem` (componente definido y no usado), `assignMode` |
| Estado `en_espera` | Aparece en configs de las páginas públicas, PDF y OTsPendientesPanel, pero no existe en el enum de la entidad |
| `EjecutarOTSimple` | Tiene ruta y se genera su QR, pero en la práctica no anda (punto 1 de §12) |

---

## 14. Qué cambió respecto de la copia vieja (31/7)

- **Máquina de estados**
  - `obra` dejó de ser terminal (tiene botón "Completar").
  - Se agregaron los arrastres pendiente→en_progreso.
  - Hay control de checklist y fotos en completar y aprobar (salvo que haya motivos de incompleto).
  - Hay modo portal con clave y `operario_sesion`.
  - Se registra en AssetHistory al completar.
  - Los campos de reporte ahora se **reemplazan** (antes fotos y faltantes se concatenaban).
  - La lectura y la escritura usan service role, con control de sector.
- **Visibilidad**
  - `getWorkOrdersForUser` delega en el módulo compartido, con `admin_view` por rol de empleado, vínculo con el jefe vía Tablet, `scope='own'` y archivadas.
  - Las OTs sin sector se excluyen (antes se asumía 'escuela').
  - La RLS ahora exige sector en lectura y edición.
- **Funciones nuevas:** `actualizarOT` (todo el autoguardado pasa por acá), `eliminarOT`, `getOperariosSector`, `archivarOTsCompletadas` (con su workflow diario), `getDashboardMetrics` y la herencia de OTs al reasignar jefe.
- **Campos nuevos en WorkOrder:** `asset_id`, `archivada`, `fecha_archivado`, `operario_sesion`. Se quitó el default de `sector_id`.
- **/ordenes**
  - El total dice "activas · archivadas (Historial)".
  - Hay actualización en tiempo real, modo offline de solo lectura y creación offline.
  - Confirmación propia para cancelar.
  - Las tarjetas dicen Finalizar, Aprobar o Completar según el estado (antes "Completar" hacía `completar` directo).
  - Límite de 60 tarjetas en grilla.
  - El filtro de fechas pasó a usar fecha de **creación**, y los filtros de jefe y operario usan alias.
  - En Kanban, Obra pasó después de Completada.
- **Panel de detalle:** resumen del reporte del operario en validación, modal de rechazo (antes un `prompt`), resolución del responsable a `user_id`, errores visibles en el autoguardado, rollback del Pendiente en "Obra", y Guardar cierra el panel.
- **CrearOT:** el paso 1 pasó de Ubicación a **Activo** (se saltea en bapro), resuelve `assigned_to` y `jefe_sitio_email`, comprime fotos y funciona offline.
- **/mis-ots** se rehízo: escáner QR, filtros, pestaña Historial, cola offline, `canActOn` y quedó protegida con el módulo `MisOrdenes`.
- **Portales públicos:** se pide nombre además de clave, `?asset=`, decisión de 1 o 2 pasos, envío al jefe en lugar de completar, cache y cola offline.
- **Otros:** el Historial pasó a ser global con pestaña Archivadas; el Dashboard usa `getDashboardMetrics` y se rediseñó; hay un Toaster de sonner global (antes los toasts de sonner no tenían Toaster montado). `OTEjecucionModal` cambió pero sigue sin usarse.