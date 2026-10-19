# Inventario v1 (Base44) contra v2 (Supabase): qué falta para igualar

**Relevado el 19/10/2026.** Reemplaza al del 7/10/2026.
Fuentes: clon de la v1 del 14/10/2026 (`src/App.jsx`, 47 pantallas de `src/pages`, sus componentes y las 104 funciones de
`base44/functions`, contando cuáles invoca de verdad el frontend) contra la v2 (`app/app/**/page.tsx`, `components/`,
`lib/`, `supabase/functions/` y los `dh1-v2-*.sql` hasta la fase 17). Cada fila se miró en el código, no por nombre.

Estados:
- **Igual**: hecho igual (o mejor) que la v1.
- **Distinto a propósito**: decisión de `CLAUDE.md`; se dice por qué. No es faltante.
- **Parcial**: está, falta lo que se indica.
- **Falta**: no está en la v2.
- **No aplica**: código muerto en la v1 (nada lo monta ni lo invoca) o fuera de alcance por decisión cerrada.

Esfuerzo: **S** = horas · **M** = un día · **L** = varios días. "SQL" = necesita archivo de fase nuevo (y tu OK para correrlo).

## Qué cambió desde el 7/10

Cerrado desde el inventario anterior (ya no es faltante):
- Órdenes de trabajo como la v1 (`app/gestion/ots/page.tsx`, `components/ordenes/*`, `lib/tablero.ts`): Kanban/Grilla,
  filtros avanzados, editar/reasignar/borrar desde el panel, guardar como plantilla, historial por establecimiento con
  totales, modo campo, cancelar/rechazar con motivo, QR, PDF (`lib/pdfOT.ts`), firma de conformidad, Futura Obra (fase 15).
- Crear OT como la v1 (`app/gestion/ots/nueva`): dictado por voz, fotos de referencia y materiales al crear, 5 Reglas de Oro.
- Mis Órdenes como `PortalOperarioApp` (`app/mis-ots`, `components/operario/ReporteForm.tsx`): materiales usados y faltantes.
- Certificados como la v1 (fase 14): lista con filtros, editor, vista previa, PDF (`lib/pdfCertificado.ts`), carga del
  ADA con IA (`UploadADA.tsx`, función `leer-contrato-pdf`), tipo "Informe / Certificado", generación masiva desde
  varios PDF, firma del jefe de sitio al emitir (`FirmaJefeSitioModal.tsx`), abonos maestros, automáticos.
- Portal de operarios sin usuario (`/portal`, fase 16) = `PortalOperario.jsx` + `EjecutarOTEnPortal.jsx`.
- Directorio jerárquico por comuna (`leerPorComuna`, fase 17) = `importarEscuelasJerarquico`.
- Tablero de inicio estilo Apple (`app/gestion/page.tsx`).

Sacado de la lista por ser código muerto en la v1 (verificado: ninguna pantalla lo invoca): `exportCertificado`
(certificado en Excel), `exportOTsPDF` (exportar el listado de OTs), `transcribirAudio`, `archivarOTsCompletadas`,
`heredarOTsPorUbicacion`, `reasignarJefeSitio`, `eliminarJefeSitio`, `notificarAnuncioForo`, `generateDigitalSignature`.

Nuevo en la v1 (o no relevado el 7/10): **cadena de firmas intermedias de certificados**, **Revisión BAPRO por enlace**,
**importador de activos con asistente** (Excel/PDF/BAPRO, con historial y deshacer), **exportar QRs por jefe (PDF/ZIP)**.

---

## Tabla por pantalla de la v1

### Órdenes de trabajo y campo
| Pantalla / módulo v1 | v2 | Estado | Detalle |
|---|---|---|---|
| `WorkOrders.jsx` (`/ordenes`) + `components/workorders/*` | `app/gestion/ots/page.tsx`, `components/ordenes/*` | Igual | Kanban, grilla, `AdvancedFilters`, `HistorialEstablecimiento`, `ModosCampo`, plantillas, QR, cancelar. Diferencias a sabiendas (CLAUDE.md "Aspecto y OT"): "Completar" solo desde Obra; responsable de la lista de usuarios; archivadas calculadas; sin tiempo real (recarga 30 s) |
| `WorkOrderDetailPanel.jsx` | `components/ordenes/DetallePanel.tsx` | Igual | Autoguardado, reasignar, ubicación, borrar (gerencia), PDF, plantilla, firma, fotos, materiales, horas |
| `CrearOT.jsx` (`/crear-ot`) | `app/gestion/ots/nueva/page.tsx` | Igual | La plantilla además copia el checklist |
| Estado `obra` / Futura Obra | fase 15, `convertir_ot_en_obra` | Igual | Arrastrar a Obra también crea el pendiente |
| `PortalOperarioApp.jsx` (`/mis-ots`) | `app/mis-ots/page.tsx` | Igual | Sobre la cola sin señal de la v2; suma checklist y motivo obligatorios |
| `PortalOperario.jsx` + `EjecutarOTEnPortal.jsx` (`/portal-operario`) | `app/portal/page.tsx`, `lib/portal.ts`, fase 16 | Parcial | Falta trabajar **sin señal** en el portal (la v1 tenía cola; CLAUDE.md lo anota pendiente). Distinto a propósito: la lista se ve recién con la clave; checklist en el portal |
| `EjecutarOrdenPublica.jsx`, `EjecutarOTSimple.jsx`, `OrdenTrabajoPublica.jsx` (públicas) | `/portal` (fase 16) y `/q` | Distinto a propósito | Resuelto con la fase 16: un solo portal con clave por sector y pase; un solo QR (§2.5) |
| `transicionEstadoOT`, `actualizarOT`, `eliminarOT` | trigger `validar_transicion_ot`, `lib/tablero.ts` | Igual | Reglas en la base |
| Crear OT el operario desde el campo | — | Falta (decisión) | CLAUDE.md §4: decisión de negocio pendiente; hoy crean gerencia y jefe de sitio |
| `Fichar.jsx`, `FicharUbicacion.jsx`, `publicFichar` (sin login) | fichaje en `/mis-ots`, `/cuadrilla` | Distinto a propósito | Tanda 2: fichar con usuario; quien no tiene lo ficha la tablet o el jefe |
| `PortalTablet.jsx` (`/tablet`, código de activación) | usuario tablet + `/cuadrilla` | Distinto a propósito | Tablet = usuario propio atado a un jefe. Falta probarla en vivo |
| `Emergencias.jsx` + `detectarPatronesEmergencias` | `app/gestion/emergencias`, `/emergencia`, alerta "emergencias repetidas" | Igual | Emergencia + OT en una transacción; aviso en tiempo real |
| `Rutinas.jsx` + `GenerarOTsJefes`, `procesarRutinas`, `sincronizarEdificiosRutinas` | `app/gestion/rutinas/page.tsx` | Igual | Pestañas jefes/general/generar/catálogo/asignación/sincronizar; "Generar las N órdenes". Sin "Edificio" a propósito. Punto abierto de CLAUDE.md: marcar a mano la única rutina no cierra la OT |
| `Calendario.jsx` | `app/gestion/calendario` | Igual | Con rutinas, informes y devoluciones |
| `InspeccionColegio.jsx` + `generarInformeInspeccion` | `app/gestion/inspecciones`, función `informe-inspeccion` | Parcial | Informe con IA y plantilla de respaldo OK. PDF solo por "Imprimir o guardar PDF" del navegador; la v1 (`InformeViewer`) lo descarga directo (S) |
| `Calefaccion.jsx` + `importarCalefaccion` | `app/gestion/calefaccion` | Igual | Por período. Falta probar con la planilla real |
| `InformacionGeneral.jsx` (`DirectorioJerarquico`, `DireccionesManager`, `importarDireccionesJefes`) | `app/gestion/informacion`, fase 17 | Igual | Directorio real importado (232 lugares). Faltan cargar los jefes (dato, no código) |
| `SincronizarModulos` → `sincronizarPendientes` | trigger `propagar_direccion` (fase 6) | Parcial | El cambio de jefe de una dirección llega a `ubicaciones`, pero `pendientes` y `calefaccion` guardan su propio `jefe_sitio_id` y no se actualizan (S, SQL) |
| `Assets.jsx` pestaña Pendientes SAP (`PendientesTab`, `importarPendientesSAP`) | `app/gestion/pendientes` | Parcial | Igual salvo `ExportarPendientesPDF`: hoy solo CSV (S) |

### Activos
| Pantalla / módulo v1 | v2 | Estado | Detalle |
|---|---|---|---|
| `Assets.jsx` pestaña Catálogo (`ActivosTab`, `AssetFormDialog`, `AssetQRModal`) | `app/gestion/activos/page.tsx` | Parcial | Alta, padre, QR OK. Falta **exportar** el catálogo a Excel/PDF (`exportActivosExcel.js`) |
| `ImportarActivosWizard` + `ImportarActivosModal` (`importarActivosExcel`, `importarActivosPDF`, `importarActivosBapro`, `HistorialImportaciones` + `rollbackImportacion`) | — | Falta | Importar activos desde Excel (con plantilla), PDF de inventario con IA, o formato BAPRO; con historial y deshacer el lote (M–L, SQL para el lote/deshacer) |
| `ActivoFicha.jsx` (`/activos/:id`: `AssetDocumentos`, `AssetJerarquia`, `AssetOTs`, `AssetTimeline`) | `app/gestion/activos/[id]/page.tsx` | Parcial | Ficha, estado, mover, componentes, órdenes e historial OK. Faltan los **documentos** del activo en pantalla (la columna `activos.documentos` ya existe en `dh1-v2-fundacion.sql`; reusar `components/gestion/Documentos.tsx`) (S) |
| Pestaña Revisión (`RevisionBaproPanel`, `generarLinkBapro`) + `RevisionBapro.jsx` (`/revision-bapro/:token`, `obtenerActivosParaRevision`, `registrarVistoBapro`) | — | Falta | Enlace con vencimiento para que el cliente BAPRO revise los activos de una sede o todas, los marque "visto" y vea las OTs del mes. Es acceso sin usuario: mismo criterio que la fase 16 (función con `service_role` y token con hash). M, SQL, **decisión** (reabre "todo con login" para esto) |
| Pestaña Sincronización (`SincronizacionPanel`, `sincronizarUbicaciones`) | — | No aplica | Reconcilia `LocationData` ↔ `Edificio`; en la v2 no existe Edificio y las ubicaciones son una sola tabla |
| `guardarAsset`, `getActivosSector` | RLS + `exigir_rol` | Igual | — |

### Certificación, obras, presupuestos
| Pantalla / módulo v1 | v2 | Estado | Detalle |
|---|---|---|---|
| `Certificados.jsx` (lista, editor, vista previa, PDF, ADA con IA, masiva, abonos) | `app/gestion/certificacion/page.tsx`, `components/certificados/*` | Igual | Fase 14. Diferencias a sabiendas (CLAUDE.md): N° lo pone la base; monto = suma de ítems; anticipo/fondo sobre el período; emitidos no se borran (`eliminarCertificado` solo borradores) |
| `CadenaFirmasPanel` (en `CertificadoEditor`), `FirmaIntermediaModal` + `TipsFirmaPanel`, `AuditoriaFirmasModal`; funciones `emitirCertificado` (estado `pendiente_firmas`) y `firmarCertificadoIntermedio` | — | Falta | Antes de emitir se arma una cadena de firmantes; el certificado queda "pendiente de firmas" y cada uno firma (o rechaza con motivo) en orden; el último lo deja emitido. Más un modal de auditoría de firmas. Nada de esto en `dh1-v2-fase14-certificados-v1.sql` (M–L, SQL: estado nuevo, tabla de firmantes, función de firma con las reglas de §2.8) |
| `CertificadosAutomatizados` + `generateMonthlyCertificates` | `CertificadosAutomatizados.tsx`, `certificados_automaticos()` (fase 14) | Parcial | Lógica hecha (último día hábil con feriados). **No está programado**: falta correr una vez `programar_certificados_automaticos()` (pg_cron) — decisión de CLAUDE.md: "después de probar" (S, SQL de una línea con tu OK) |
| `AprobacionCertificados.jsx` (`gestionarSolicitudesCert`, `SolicitudDetalle`) | `app/gestion/solicitudes` | Igual | Aprobar con certificado vinculado pide la firma del gerente |
| `CertificacionObras.jsx` (`gestionarObrasCertificacion`, `ExportarComunaPDF`) | `app/gestion/cobros` | Igual | Cobro por ciclo, hoja por comuna |
| `Projects.jsx` (`/proyectos`) + `importarObrasExcel` | `app/gestion/obras` | Parcial | Falta `AuditoriaSincronizacion` (`auditarObrasSincronizacion`: obras de la base que no vienen en la planilla) y el borrado de todas/varias (`eliminarTodasObras`); hoy se borra de a una (S) |
| `Clients.jsx` | `app/gestion/proveedores` | Igual | — |
| `Presupuestos.jsx` (`/presupuestos-obra`) | `app/gestion/presupuestos` | Igual | Repositorio con estado. Motor PCP/PAPORC, plan de trabajos, preciario: no copiados a propósito (código muerto, tanda 3) |
| `Quotes.jsx`, `Invoices.jsx`, `Finanzas.jsx` | — | No aplica | Decisión cerrada: DH1 no factura ni cobra; cotizaciones sacadas como código muerto (tanda 3) |
| `Inventory.jsx` (`/inventario`) | `app/gestion/panol`, `prestamos`, `requerimientos` | Igual | Préstamos es nuevo en la v2 |

### Gente y mapa
| Pantalla / módulo v1 | v2 | Estado | Detalle |
|---|---|---|---|
| `Employees.jsx` (`vincularEmpleado`, `revincularEmpleado`, `cambiarEmailEmpleado`, `sincronizarEmpleados`) | `app/gestion/empleados` | Igual | Enganche por correo automático; datos reservados aparte |
| `Mapa.jsx` pestañas lugares / fichajes / asignaciones | `app/gestion/mapa` (Lugares, Fichajes, Órdenes) | Parcial | Falta `MapaProyectosOTs` (obras en el mapa), `MapaOTsCompletadas` y `AsistenciasPanel` → exportar asistencias a Excel (M) |
| `ExportarQRsDialog` (en Mapa: QRs de ubicaciones por jefe en PDF, o todos en ZIP; modo fichaje) | `components/gestion/QRImprimible.tsx` (de a uno) | Parcial | Falta la impresión masiva de QRs por jefe y la descarga ZIP (S–M, sin SQL) |
| `MapaJefes.jsx` + `ImportarMapaJefes` | colorear por jefe/zona en `app/gestion/mapa` | Parcial (decisión) | Importar la cobertura por jefe: pendiente de decisión (CLAUDE.md tanda 6) |
| `geocodificarColegios` | `lib/geocodificar.ts` (Nominatim desde el navegador) | Distinto a propósito | Tanda 2 |

### Control, reportes y administración
| Pantalla / módulo v1 | v2 | Estado | Detalle |
|---|---|---|---|
| `Dashboard.jsx` (`getDashboardMetrics`, `DashboardFilters`) | `app/gestion/page.tsx` (estilo Apple) | Distinto a propósito | Única pantalla que no copia la v1, a pedido de Emanuel (8/10). Falta la vista del jefe con un usuario jefe real |
| `Reportes.jsx` (`getReportesGerenciales`, `resumenSemanal`): Operaciones, Personal, Financiero, Inventario, Pendientes, Semanal | `app/gestion/reportes` (`reporte_operacion`) | Parcial | Operaciones, horas, materiales, emergencias, ranking OK. Falta **a verificar** el detalle de las pestañas Personal (plantel), Inventario (stock contra mínimo) y Semanal; "Financiero" no aplica (no factura) (M, posible SQL) |
| `ConfigAlertas.jsx` (`/alertas`) + `checkAlertas` | `app/gestion/alertas` (`v_alertas`, umbrales por sector) | Parcial | Falta apagar/prender cada tipo (`activo` por tipo en la v1) (S, sin SQL: va en `sectores.config`). Mails: falta (proveedor de correo, decisión) |
| `Automatizaciones.jsx` (historial y estadísticas de `AlertaLog`, `AutomationControl`) | alertas calculadas al momento | Distinto a propósito | Tanda 5: `AlertaLog` y `AutomationControl` reemplazados (no hacían nada / re-alertaban) |
| `Auditoria.jsx` + `logAudit` | `app/gestion/auditoria`, `auditar()` | Igual | — |
| `AuditSystemCheck` (`auditarSistema`) | — | Falta | Chequeo de salud: empleados sin usuario, duplicados, registros huérfanos (S) |
| `Informes.jsx`, `CalendarioInformes.jsx` | `app/gestion/informes`, calendario | Igual | — |
| `PlanificacionTab` (`importarInformesPlaneacion`, `InformePlaneacion`) | — | Falta (decisión) | Columnas atadas a 2025/2026; pendiente de decisión (CLAUDE.md tanda 5) |
| `ControlRiesgo.jsx` | `app/gestion/riesgos` | Igual | — |
| `Foro.jsx` + `ForoNotificacionesBell` | `app/gestion/foro` | Parcial | Sin encuestas/reacciones/menciones a propósito. Falta el contador de "nuevos" en el menú (`Sidebar.tsx` no lo muestra) (S) |
| `Sectores.jsx` (`observarSector`, `cambiarSectorActivo`) | `app/gestion/sectores`, `cambiar_sector_activo` | Igual | — |
| `Permisos.jsx` (editor rol × módulo, `forzarSincronizacion`, `saveAccessConfig`) | `app/gestion/usuarios` | Distinto a propósito | Permisos en la base; un editor en pantalla mentiría (tanda 6) |
| `Seguridad.jsx` (sesiones, backups cifrados, `TwoFactorSetup`) | — | Distinto a propósito / Parcial | Centro de Seguridad falso: no se copia. Lo único real era el TOTP de `twoFactorAuth`; con Supabase sería MFA nativo (S). **A verificar** si la v1 lo exigía al entrar |
| `ImportarDatos.jsx` (importador genérico, `smartImport*`, `AliceImportAssistant`) | importadores por módulo | Distinto a propósito | Escribía como servicio en cualquier tabla (tanda 6) |
| `GestorFirmasJefes` (dentro de ImportarDatos) | firma propia en `app/gestion/perfil` | Parcial | Cada uno carga su firma; falta que el admin cargue la de los jefes (S, a verificar si la RLS de `perfiles` lo deja) |
| `AsignadorJefesEscuelas` (dentro de ImportarDatos) | jefe por dirección en `app/gestion/informacion` | Igual | — |
| `Tutorial.jsx` (`TutorialProgress`) | `app/gestion/ayuda` | Parcial | Sin progreso ni guía paso a paso (S) |
| `ChatbotSoporte`, Alice, `base44/agents/soporte_app` | — | Distinto a propósito | Dejado afuera (tanda 6); se podría con Gemini |
| `useAppUsageTracker` (`AppUsageLog`) | — | Distinto a propósito | No copiado (tanda 5) |
| `OAuthConsent.jsx` | — | No aplica | Plomería de la plataforma Base44 (servidor MCP); no tiene ruta en `App.jsx` |
| Buscador global (Ctrl+K) | `BuscadorGlobal.tsx` | Nuevo en v2 | — |
| Sugerencias | `app/gestion/sugerencias` | Nuevo en v2 | Reemplaza el mail a una casilla personal |

---

## Lo que falta, en orden de valor

| # | Qué | v1 | Esfuerzo | SQL |
|---|---|---|---|---|
| 1 | **Cadena de firmas intermedias del certificado** (firmantes en orden, "pendiente de firmas", rechazo con motivo, auditoría de firmas) | `CadenaFirmasPanel`, `FirmaIntermediaModal`, `AuditoriaFirmasModal`, `firmarCertificadoIntermedio` | L | Sí |
| 2 | **Portal de operarios sin señal** (cola en el teléfono como `/mis-ots`) | `PortalOperario.jsx` | M | No (a verificar: las `portal_*` ya son repetibles) |
| 3 | **Programar los certificados automáticos** (ya está la función) | `generateMonthlyCertificates` | S | Sí: una llamada a `programar_certificados_automaticos()` |
| 4 | **Importar activos** desde Excel (plantilla), PDF con IA y formato BAPRO, con historial y deshacer; exportar el catálogo | `ImportarActivosWizard`, `importarActivos*`, `rollbackImportacion`, `exportActivosExcel.js` | L | Sí (lote para deshacer) |
| 5 | **Revisión BAPRO por enlace** (el cliente marca activos vistos y ve las OTs del mes) | `RevisionBapro.jsx`, `RevisionBaproPanel`, `generarLinkBapro`, `registrarVistoBapro` | M | Sí + **decisión** (acceso sin usuario, como fase 16) |
| 6 | **QRs masivos**: PDF de QRs por jefe y ZIP de todos | `ExportarQRsDialog`, `exportQrGroups.js` | S | No |
| 7 | **Propagar el cambio de jefe** a pendientes y calefacción | `sincronizarPendientes` | S | Sí |
| 8 | **Documentos del activo** en la ficha | `AssetDocumentos` | S | No (columna ya existe) |
| 9 | **Obras**: listar las que no vienen en la planilla y borrar varias | `AuditoriaSincronizacion`, `eliminarTodasObras` | S | No |
| 10 | **Reportes**: plantel, stock contra mínimo, semanal (a verificar alcance) | `Reportes.jsx` | M | Posible |
| 11 | **Mapa**: obras en el mapa, OTs completadas, exportar asistencias a Excel | `MapaProyectosOTs`, `MapaOTsCompletadas`, `AsistenciasPanel` | M | No |
| 12 | **Alertas**: prender/apagar cada tipo | `ConfigAlertas.jsx` | S | No |
| 13 | **PDF descargable** del informe de inspección y de pendientes | `InformeViewer`, `ExportarPendientesPDF` | S | No |
| 14 | **Detalles de administración**: contador del foro en el menú, firmas de jefes cargadas por el admin, chequeo de salud | `ForoNotificacionesBell`, `GestorFirmasJefes`, `auditarSistema` | S c/u | A verificar (firmas) |
| 15 | **2FA** con el MFA de Supabase | `twoFactorAuth` | S | No |

## Decisiones que te tocan
- **Revisión BAPRO** (punto 5): reabre el acceso sin usuario, como la fase 16. ¿Se usa?
- **Alertas y resumen semanal por mail**: falta elegir proveedor de correo (Resend gratis o SMTP).
- **Planificación anual de informes** (`InformePlaneacion`): columnas atadas a 2025/2026.
- **Importar la cobertura por jefe** del mapa de jefes.
- **Crear OT desde el campo** (el operario): hoy solo gerencia y jefe de sitio.
- **Rutina marcada a mano**: ¿cierra o cancela su OT `[Rutinas]`?
- **Chatbot de soporte**: dejado afuera; se podría con Gemini.
