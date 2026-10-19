# Certificados: cambios de la v1 desde el 6/10/2026 → qué pasar a la v2

Relevado el 19/10/2026 sobre el historial completo de `ema404x/DH1b44` (HEAD `8edcac0`, 19/10/2026), clon en
`C:\Users\Andres\AppData\Local\Temp\dh1v1\full`. La v2 copió Certificados del clon del 6/10/2026 (último commit de ese
día: `c1ef01f`, 13:28 UTC). Criterio: **pantalla de la v1, reglas de la v2** (numera la base, emitido/aprobado
inmutables, no se certifica de más, quien emite no aprueba).

Resumen: en el módulo hubo **un solo cambio de pantalla** (un grupo nuevo del checklist de firma) y **tres de
seguridad del lado servidor** que en la v2 ya están cubiertos por la base. Pero el cambio de pantalla cuelga de una
función de la v1 **anterior al 6/10 que la v2 no copió**: la cadena de firmas intermedias con su checklist
(23–24/9/2026). Eso es lo único con trabajo real, y necesita SQL.

---

## 1. Commits revisados

Se listaron todos los commits desde el 6/10 (19 en total) y se filtraron por ruta (`Certificados.jsx`,
`components/certificados`, `exportCertificadoPDF.js`, entidades `Certificado`/`AbonoMaestro`, `base44/functions`,
`base44/shared`) y por mensaje (certific, abono, ADA, firma). Además se hizo `git diff f3f6ff3 HEAD` completo y se
buscó "certific/abono" en todo el diff.

| Hash | Fecha | Título | ¿Toca certificados? |
|---|---|---|---|
| `644623a` | 08/10 | Agregar sección Limpieza de Campanas a tips de certificados | **Sí** (pantalla) |
| `4308b8a` | 14/10 | File changes | **Sí**: `eliminarCertificado` (admin_view) |
| `40aa79e` | 14/10 | File changes | **Sí**: `gestionarObrasCertificacion` (sector de la obra) + `sectorGuard`/`callerIdentity`/`visibilityResolver` |
| `20efe43` | 14/10 | Update OT state transition logic and sector guard | Indirecto: `sectorGuard` (lo usan las funciones de certificados) |
| `0a9b2d6` | 14/10 | Reforzar validaciones de acceso por sector en los controladores centrales | Indirecto: `sectorGuard` |
| `2acbb28` | 14/10 | Refactor Bapro integration and scope management | No (Bapro, fichaje, rutinas) |
| `7593ba4` | 14/10 | Corregir error de validación en cambio de sector… | No |
| `0726dc9` | 14/10 | File changes | No (`cambiarSectorActivo`) |
| `723b4b9` | 14/10 | Corregir sincronización de cuenta al cambiar de sector… | No |
| `c06dd85` | 14/10 | Corregir carga del tablero y visibilidad de OTs escolares | No |
| `6a9f601` | 14/10 | Exigir ubicación obligatoria al fichar entrada y salida | No (salió por "firma") |
| `a885ab1` | 14/10 | Mejorar legibilidad y estilo del área de firma QR | No (firma del fichaje) |
| `88baa81` | 14/10 | Resaltar ubicación en rojo por exceso de distancia… | No |
| `7e33e56` | 14/10 | Agregar descarga masiva de QRs de fichaje en PDF… | No |
| `920353a` | 14/10 | Mejorar formato y detalle del reporte de asistencia en Excel | No |
| `0447064` | 14/10 | Implementar aviso semanal de DH1 los miércoles | No |
| `d6ea0e1` | 14/10 | Incluir descarga masiva de todos los jefes en formato ZIP | No |
| `fd50a6c` | 14/10 | Update base44 packages | No |
| `8edcac0` | 19/10 | Update base44 packages | No |

Sin cambios desde el 6/10 en: `pages/Certificados.jsx`, `CertificadoEditor`, `CertificadoPreview`,
`CertificadosLista`, `exportCertificadoPDF.js`, `AbonoMaestro*`, entidades `Certificado`/`AbonoMaestro`,
`emitirCertificado`, `gestionarCertificados`, `generateMonthlyCertificates`, `firmarCertificadoIntermedio`.

---

## 2. Cambios funcionales a pasar

### 2.0 (Prerrequisito, anterior al 6/10) Cadena de firmas intermedias + checklist de revisión — NO está en la v2

No es un cambio de octubre, pero el único cambio de pantalla de octubre (2.1) vive adentro de esto, así que sin
esto no hay dónde ponerlo. La lista de "Certificados idénticos a la v1" del `CLAUDE.md` no lo nombra: se escapó
al copiar.

**Qué hace en la v1** (commits `45212c9`, `c997829`, `0d54ba1` del 23/9 y `abeb392`, `1e8dcf4` del 23–24/9):
- `src/components/certificados/CadenaFirmasPanel.jsx` (148 líneas), montado en `CertificadoEditor.jsx:546-550`:
  antes de emitir se arma una lista ordenada (arrastrar para ordenar) de firmantes, elegidos entre los empleados con
  usuario o correo.
- `base44/functions/emitirCertificado/entry.ts:43-67,125`: con cadena, el certificado nace en `pendiente_firmas` (no
  en `emitido`) y **no** crea la solicitud; sin cadena, va directo a `emitido` como siempre.
- `base44/functions/firmarCertificadoIntermedio/entry.ts:43-160`: solo firma el que le toca (`email` del firmante
  pendiente); firma con la guardada del empleado o una dibujada; el último firmante pasa el certificado a `emitido` y
  crea la `SolicitudCertificado` para la bandeja del gerente; **rechazar** pide motivo, marca al firmante como
  `rechazado` y devuelve el certificado a `borrador`.
- `FirmaIntermediaModal.jsx` (abre desde `Certificados.jsx:304` y desde la lista `CertificadosLista.jsx:151,189`
  con el botón "Firmar" cuando te toca): muestra "N° de M · Te toca firmar", firma guardada o lienzo, rechazo con
  motivo y, **solo si hay cadena** (`FirmaIntermediaModal.jsx:25-26,266`), el checklist.
- `TipsFirmaPanel.jsx` + `tipsCertificado.js`: checklist "Checklist de revisión" por tipo de certificado (hoy solo
  `informe`); hay que tildar todos los puntos de la sección del informe; al completar una sección, las demás se
  marcan "No corresponde"; hasta entonces el botón de firmar está deshabilitado. Es solo de pantalla: no se guarda.
- `CertificadosLista.jsx:15,28-36,120`: estado "Pend. Firmas" y progreso "k/M firmas".
- `AuditoriaFirmasModal.jsx` (251 líneas): panel de auditoría de la cadena (quién firmó, cuándo, rechazos).
- `exportCertificadoPDF.js:83-89`: las firmas de la cadena salen en el PDF.
- `aprobacion/SolicitudDetalle.jsx:536-545`: tarjeta de firmantes en el detalle de la solicitud.

Ojo (no verificado): en `base44/entities/Certificado.jsonc:18-25` el `enum` de `estado` sigue siendo
`borrador/emitido/aprobado` y no existe el campo `cadena_firmas`. Conviene preguntarle a Emanuel si la cadena se usa
de verdad en producción antes de construirla (si Base44 valida el enum, `pendiente_firmas` fallaría al guardar).

**En la v2**: no existe. `grep` de `cadena`, `intermedia`, `tips` en `app/` y en los `.sql`: nada. Hoy la v2 tiene
firma del jefe al emitir (`FirmaJefeSitioModal`) y firma del gerente al aprobar.

**Qué habría que hacer en la v2** — **necesita SQL nuevo (fase 18)**:
- *SQL*:
  - Tabla `certificado_firmantes` (`sector_id`, `certificado_id`, `orden`, `perfil_id`, `estado`
    `pendiente/firmado/rechazado`, `firma_url`, `firmado_at`, `motivo`), con `aplicar_rls_sector` y FK compuestas
    `(certificado_id, sector_id)` y `(perfil_id, sector_id)` → los firmantes son siempre del mismo sector.
  - Estado nuevo del certificado `en_firmas` entre `borrador` y `emitido` (agregar al enum y a
    `proteger_certificado`: en `en_firmas` el contenido **no se edita**, igual que emitido; solo lo mueven las
    funciones con la bandera `dh1.cert_fn`).
  - `enviar_a_firmas(p_id)`: desde borrador, con la cadena armada; corre `controlar_sobrecertificacion` (no se manda
    a firmar algo que no se podría emitir); sella quién lo mandó. **No numera.**
  - `firmar_certificado_intermedio(p_id, p_firma_url)`: exige `auth.uid()` = el firmante pendiente de menor orden;
    si es el último, llama por dentro a la misma lógica de `emitir_certificado` (numera ahí, con el índice único,
    vuelve a controlar sobre-certificación, crea la solicitud como hoy con `p_solicitud`).
  - `rechazar_firma_intermedia(p_id, p_motivo)`: motivo obligatorio; devuelve el certificado a `borrador` y deja la
    cadena con el rechazo (historia; al reenviar se reinician las firmas).
  - Pruebas nuevas en `pruebas/aceptacion.mjs`: firma fuera de turno, firmante de otro sector, editar en `en_firmas`,
    sobre-certificación al último firmante, numeración solo al final, rechazo con y sin motivo.
- *lib* (`lib/certificados.ts`): `EstadoCert` suma `en_firmas`; `enviarAFirmas`, `firmarIntermedio`,
  `rechazarFirmaIntermedia`, `firmantesDe(certId)`. `v_certificados` podría traer `firmas_total` / `firmas_hechas` /
  `firmante_actual` para la lista.
- *Pantalla*: `components/certificados/CadenaFirmas.tsx` (elegir perfiles del sector con el buscador remoto, ordenar),
  en `CertificadoEditor.tsx`; `FirmaIntermediaModal.tsx` (reusar `FirmaCanvas` y la firma del perfil);
  `TipsFirmaPanel.tsx` + `tipsCertificado.ts` copiados tal cual (es solo pantalla); estado "Pend. Firmas" y botón
  "Firmar" en `CertificadosLista.tsx`; auditoría de firmas (puede leer de `certificado_firmantes` + la auditoría de
  la fase 11); firmas de la cadena en `lib/pdfCertificado.ts`.
- *Choques con reglas de la v2 y cómo resolverlos*:
  - **Numera la base**: en la v1 el número se pone al crear; en la v2 se pone recién cuando firma el último (que es
    cuando pasa a emitido). Mismo flujo en pantalla, número más tarde.
  - **Emitido inmutable**: en la v1 el certificado `pendiente_firmas` se puede seguir tocando por API. En la v2
    `en_firmas` queda congelado; para corregir hay que rechazar (vuelve a borrador).
  - **Quien emite no aprueba**: el "emisor" es quien lo mandó a firmar (`emitido_por` = ese usuario, no el último
    firmante). Decisión de negocio a preguntar: ¿un firmante intermedio puede después aprobar como gerente? La v1 no
    lo impide; la propuesta conservadora es que no.

### 2.1 Checklist: grupo "Limpieza de Campanas" (`644623a`, 8/10)

**Qué hace en la v1**: `src/components/certificados/tipsCertificado.js:74-80` suma al tipo `informe` la categoría
"Limpieza de Campanas" con dos puntos: "¿Tiene remito?" y "¿Tiene oblea QR?". Por la lógica del panel, el que firma
un informe de limpieza de campanas tilda esos dos y las otras 9 secciones quedan "No corresponde".

**En la v2**: no está (no existe el checklist; ver 2.0).

**Qué hacer**: al copiar `tipsCertificado` en 2.0, copiar la versión de HEAD (10 categorías, con esta incluida).
Solo pantalla, **sin SQL**, sin choque con reglas. Si 2.0 se posterga, se puede mostrar el checklist igual en el
modal de firma del jefe (`FirmaJefeSitioModal`) para los certificados tipo informe; pero eso **se aparta de la v1**
(allá solo aparece con cadena) y es decisión de Emanuel.

### 2.2 Borrar certificado: sin ficha de empleado ya no es "admin" (`4308b8a` + `40aa79e`, 14/10)

**Qué hace en la v1**: `base44/functions/eliminarCertificado/entry.ts:83` pasa `user` a `resolveAdminView`, y
`base44/shared/visibilityResolver.ts:73-74` deja de dar visibilidad total a quien no tiene ficha de empleado
(ahora solo si `user.role === 'admin'`). Antes cualquier usuario sin ficha podía borrar certificados ajenos.

**En la v2**: ya cubierto. Sin perfil no hay sector (`sector_efectivo()` nulo → la RLS no deja ver ni borrar nada), y
`proteger_certificado` (`dh1-v2-fase14-certificados-v1.sql:61-69`) solo deja borrar **borradores** y solo a gerencia o
jefe de sitio. Emitidos y aprobados no se borran nunca.

**Qué hacer**: nada. Nota aparte, no de octubre: en la v1 un jefe solo borra los certificados que creó o que le
tocan (`certVisibleToUser`); en la v2 cualquier jefe del sector borra cualquier borrador del sector. Si Emanuel lo
quiere igual: en `proteger_certificado`, en DELETE, exigir gerencia **o** `created_by = auth.uid()` → **SQL** chico.

### 2.3 Obras de certificación: no se cambian de sector (`40aa79e`, 14/10)

**Qué hace en la v1**: `base44/functions/gestionarObrasCertificacion/entry.ts:119-122` rechaza un update de
`ObraCertificacion` que traiga otro `sector_id` y estampa siempre el sector activo.

**En la v2**: ya cubierto. `obras` (y `contratos`, `certificados`) pasan por `aplicar_rls_sector`, cuyo trigger
`estampar_sector` (`dh1-v2-fundacion.sql:125-126`) tira "El sector de un registro no se puede cambiar." en cualquier
update. `proteger_certificado` además repone `sector_id` y `contrato_id`.

**Qué hacer**: nada.

### 2.4 Guardia de sector endurecida (`40aa79e`, `20efe43`, `0a9b2d6`, 14/10)

**Qué hace en la v1** (afecta a todas las funciones de certificados que usan `createScopedClient`):
- `base44/shared/sectorGuard.ts:57-65` `stamp`: rechaza datos que no son objeto y cualquier intento de mover un
  registro a otro sector.
- `sectorGuard.ts:67-72` `assertScopedRecord`: un registro **sin sector** o de otro sector ya no se puede leer,
  editar ni borrar (antes `!x.sector_id` pasaba).
- `sectorGuard.ts:74-92,149-162`: `updateMany`/`bulkUpdate` verifican todo el lote antes de tocar nada.
- `sectorGuard.ts:178-179`: sin sector operativo válido (`SIN_SECTOR`, `sistema`, vacío) no se arma el cliente.
- `base44/shared/callerIdentity.ts:34-48`: el empleado se busca por vínculo; si el usuario tiene fichas en dos
  sectores, error "Vínculo de empleado ambiguo"; sin ficha, solo el admin cae al sector de la plataforma.

**En la v2**: ya cubierto de raíz (§2.1 y §2.4 del `CLAUDE.md`): nada sin sector puede existir, el sector no se
cambia, un usuario tiene un solo sector en su perfil, la RLS se aplica a cada fila y las funciones de certificados
son atómicas.

**Qué hacer**: nada. Una diferencia que queda, a sabiendas: en la v1 ahora **ni el admin escribe fuera del sector
activo**; en la v2 un admin con "ver todos" encendido puede escribir en otro sector (la política es `for all`). Es la
decisión cerrada §2.3 y abarca toda la app, no solo certificados; si Emanuel quiere el comportamiento nuevo de la v1,
sería **SQL** (separar la política en `select` con `ve_todos_sectores()` y escritura solo con `sector_efectivo()`),
probándolo en todas las tablas.

---

## 3. Ignorado (no aplica o la v2 no tiene el problema)

- `4308b8a`/`40aa79e` resto de funciones (`getAlertasForUser`, `getDashboardMetrics`, inspecciones, OT): mismo
  cambio de `resolveAdminView`, fuera de certificados.
- `callerIdentity` sin el fallback que bajaba 2000 empleados: bug de rendimiento de la v1; la v2 lee el perfil propio.
- `sectorGuard.list` que filtraba en memoria después de traer todo: bug de la v1; la v2 filtra en la base.
- `sectorGuard.count/aggregate` con sector: la v2 ya lo hace por RLS.
- `Permisos.jsx` (separa "Activos", "Pendientes SAP", "Revisión"): la v2 no tiene editor de permisos (decisión tanda 6).
- Firma de fichaje (`a885ab1`, `SignaturePad`): es del fichaje QR, no de certificados.
- Fichaje, Bapro, mapa/QR, aviso semanal, reporte de asistencia, tablero de OT: fuera de este módulo.
- `Update base44 packages` (`fd50a6c`, `8edcac0`): dependencias de Base44.

---

## 4. Orden sugerido

1. Preguntarle a Emanuel si la cadena de firmas se usa en la v1 (el enum de la entidad no la tiene) y si un firmante
   intermedio puede aprobar después.
2. Si va: fase 18 SQL (2.0) + pruebas → pantalla (cadena en el editor, modal de firma con checklist de HEAD, lista,
   auditoría, PDF). El checklist con "Limpieza de Campanas" (2.1) entra acá.
3. Opcional, a decidir: borrar solo los borradores propios (2.2, SQL chico) y escritura del admin limitada al sector
   activo (2.4, SQL transversal).
