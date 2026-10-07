# Inventario v1 (Base44) contra v2 (Supabase): qué falta para igualar

Relevado el 7/10/2026 leyendo el código de las dos versiones: las 62 funciones de `base44/functions`, las 44 pantallas
de `src/pages` y sus componentes, contra el SQL y la app de la v2. Cada fila se verificó en el código de la v2,
no por nombre.

Estados: **igual o mejor** · **parcial** · **falta** · **no aplica** (decisión cerrada de `CLAUDE.md` §2, o
código muerto en la v1: ninguna pantalla lo usaba).
Esfuerzo: **S** = horas · **M** = un día · **L** = varios días.

## Resumen

La base de la operación ya está igual o mejor:
- órdenes con su máquina de estados y el trabajo sin señal;
- QR, emergencias, rutinas, calefacción e inspecciones con IA;
- pendientes SAP, información general, mapa y calendario;
- empleados, fichaje y tablets;
- certificación con sus reglas en la base, abonos del mes y solicitudes;
- cobro de obras por ciclo, obras, presupuestos, pañol e informes;
- riesgos, auditoría, alertas, reportes, sectores y usuarios.

Lo que falta se concentra en cuatro frentes:
1. **Carga de contratos y certificados**: la carga desde el PDF del ADA con IA (en curso), el PDF y el Excel del
   certificado, y una lista de todos los certificados.
2. **Órdenes de trabajo después de creadas**: editar, reasignar, borrar, filtrar el listado y que el operario anote
   materiales usados y faltantes.
3. **Avisos fuera de la app**: alertas y resumen semanal por mail.
4. **Detalles de campo**: dictar la descripción, que el jefe complete directo y la "futura obra".

## Orden propuesto (por uso diario)

| # | Qué | Esfuerzo | Necesita |
|---|---|---|---|
| 1 | **Cargar el ADA / orden de compra desde el PDF con IA** (Gemini gratis), con control de la suma y corrección | M | **En curso**: hecho en código; falta desplegar la función (tu OK) y probarla con un ADA real |
| 2 | Editar, reasignar y borrar una OT ya creada (la base ya lo permite; falta la pantalla) | M | — |
| 3 | Filtros del listado de OTs (jefe, operario, prioridad, tipo, fechas, solo vencidas) y exportarlo | M | — |
| 4 | El operario anota materiales usados y faltantes desde Mis órdenes, también sin señal | M | — |
| 5 | PDF y Excel del certificado (hoy solo "imprimir" del navegador) | M | — |
| 6 | Lista de todos los certificados, filtrable por mes y por comuna | S | — |
| 7 | Abonos del mes automáticos el último día hábil (con feriados) | S | SQL nuevo → tu OK |
| 8 | Dictar por voz la descripción de la OT (el código ya existe en inspecciones) | S | — |
| 9 | El jefe completa una OT directo, sin pasar por el operario | S | SQL nuevo → tu OK |
| 10 | Importar la planilla jerárquica de jefes por comuna (las escuelas heredan dirección y jefe) | S | — |
| 11 | Alertas y resumen semanal por mail | M | **Decisión**: proveedor de correo (Resend gratis o SMTP) |
| 12 | Futura obra: crear una OT como pendiente de obra, o convertirla | M | **Decisión**: se sacó el estado `obra`; ver cómo se usaba |
| 13 | Planificación anual de informes con su importador | M | **Decisión**: la planilla de la v1 tenía columnas atadas a 2025-2026 |
| 14 | 2FA con el MFA nativo de Supabase | S | — |
| 15 | Carga en lote: varios PDF de ADA de una vez | M | Después del 1 |

Además, de menor peso (S cada uno):
- **Certificados:**
  - pedir la firma dibujada del jefe de sitio al emitir;
  - vista previa del certificado dentro de la solicitud.
- **Obras:**
  - en la importación, listar las obras de la base que no vienen en la planilla;
  - borrado múltiple.
- **Órdenes de trabajo:**
  - guardar una OT como plantilla;
  - historial por establecimiento con totales;
  - exportar el listado de OTs;
  - fotos y materiales al crear la OT.
- **Sincronización de jefes:** propagar el cambio de jefe a los pendientes y a la calefacción ya cargados.
- **Tablero y reportes:**
  - filtros del tablero;
  - reporte de plantel y de stock contra mínimo;
  - preset "última semana" en reportes.
- **Alertas:** activar o desactivar cada tipo de alerta.
- **Foro:** contador del foro en el menú.
- **Administración:**
  - firmas de jefes cargadas por el admin;
  - chequeo de salud (empleados sin usuario, duplicados);
  - registro de uso de la app.
- **Descargas en PDF:**
  - del informe de inspección;
  - de pendientes.
- **Mapa:** pestaña de obras en el mapa.

## Decisiones que te tocan
- **Certificado tipo "Informe" de la v1** (informe de avance con acumulados): ¿se sigue usando? Si sí, hay que definir
  cómo entra a la v2, porque un certificado nuevo arrastra el acumulado de los anteriores del mismo contrato.
- **Kanban de OTs**: estaba pendiente de decisión.
- **Mapa de jefes, importar la cobertura por jefe**: estaba pendiente de decisión.
- **Proveedor de correo** (para el punto 11).

## No aplica (no se iguala, a propósito)
- **Facturación y finanzas, cotizaciones**: decisión cerrada, DH1 certifica y controla; no factura ni cobra.
- **Fichar, ejecutar OT o portal sin login**: decisión cerrada, todo con login.
- **QR propio de cada OT**: un solo formato de QR, para ubicaciones y activos.
- **Presupuesto PCP/PAPORC, preciario del Ministerio, firma digital SHA-256, `transcribirAudio`,
  `importarPendientesSAPMultiple`, varias utilidades de ubicaciones**: código muerto en la v1, ninguna pantalla los usaba.
- **Importador general con IA a cualquier tabla**: escribía como servicio en cualquier tabla. La v2 tiene un
  importador por módulo.
- **Permisos configurables desde una pantalla**: en la v2 los permisos los aplica la base (RLS y triggers). Una
  pantalla que no los cambie de verdad mentiría; hacerlo bien es L.
- **Cifrado, backups, rate limit y CSRF propios**: los resuelve Supabase. En la v1 eran de mentira.
  Conviene confirmar el plan de Supabase por los backups: el gratis no trae recuperación a un punto en el tiempo.

---

## Detalle por área

### Certificación, obras, presupuestos
| Capacidad | v1 | v2 | Esfuerzo | Qué falta |
|---|---|---|---|---|
| Cargar ADA desde PDF con IA | UploadADA, extractADA | **en curso** | M | Ver punto 1 |
| Corregir con IA los ítems mal leídos | correctADAItems | **en curso** | S | Incluido en el punto 1 |
| Generación masiva desde varios PDF | GeneracionMasiva | falta | M | Carga en lote |
| Contrato manual con ítems, anticipo, fondo de reparo | AbonoManualForm, CertificadoEditor | mejor | — | — |
| Medición del período, acumulados, bloqueo de sobre-certificación | CertificadoEditor | mejor | — | — |
| Abonos: maestro y lote del mes | AbonoMaestroPanel, generarLoteAbonos | mejor | — | — |
| Certificados automáticos el último día hábil | generateMonthlyCertificates | parcial | S | Programarlo (hoy es un botón) |
| Certificado en PDF | exportCertificadoPDF | parcial | M | Hoy se imprime desde el navegador |
| Certificado en Excel | exportCertificado | falta | S | — |
| Lista de certificados con filtro por mes y comuna | Certificados | parcial | S | Hoy se ven contrato por contrato |
| Certificado tipo "Informe" | UploadADA (informe) | falta | S | Decisión |
| Firma del jefe de sitio al emitir | FirmaJefeSitioModal | parcial | S | Hoy la firma es solo al aprobar |
| Firma del gerente al aprobar | FirmaGerenteModal | igual | — | — |
| Solicitudes de certificado | AprobacionCertificados | mejor | — | — |
| Cobro de obras por ciclo | CertificacionObras | mejor | — | — |
| Importar la planilla MTOM / obras SAP | ImportarObrasExcel | igual o mejor | — | — |
| Hoja por comuna | ExportarComunaPDF | igual | — | — |
| Obras: lista, ficha, documentos | Projects | mejor | — | — |
| Auditoría de la sincronización con la planilla | auditarObrasSincronizacion | parcial | S | Listar las obras que no vienen en la planilla |
| Borrar obras en lote | eliminarTodasObras | parcial | S | Selección múltiple |
| Proveedores | Clients | igual | — | — |
| Presupuestos (planillas con estado) | Presupuestos | igual o mejor | — | — |
| Pañol / inventario | Inventory | igual o mejor | — | — |

### Operación y campo
| Capacidad | v1 | v2 | Esfuerzo | Qué falta |
|---|---|---|---|---|
| Máquina de estados de OT | transicionEstadoOT | igual o mejor | — | — |
| El jefe completa directo | transicionEstadoOT | falta | S | SQL |
| Futura obra | CrearOT, WorkOrderDetailPanel | falta | M | Decisión |
| Crear OT (plantilla, checklist, fotos requeridas) | CrearOT | igual o mejor | — | — |
| Dictar la descripción | CrearOT | falta | S | — |
| Fotos y materiales al crear | CrearOT | parcial | S | Hoy se cargan después |
| Editar, reasignar, borrar OT | WorkOrderDetailPanel | falta | M | Pantalla |
| Guardar OT como plantilla | WorkOrderDetailPanel | falta | S | — |
| Firma de conformidad dibujada en la OT | WorkOrderSignature | parcial | M | Hoy hay renglones para firmar en papel |
| Filtros del listado de OTs | AdvancedFilters | parcial | M | Hoy solo estado, texto y lugar |
| Kanban | KanbanBoard | falta | M | Decisión |
| Exportar OTs | exportOTsPDF | parcial | S | Hoy se imprime de a una |
| Historial por establecimiento | HistorialEstablecimiento | parcial | S | Totales |
| Portal del operario, sin señal | PortalOperarioApp | mejor | — | — |
| Materiales usados y faltantes desde el portal | ReporteForm | parcial | M | Pantalla en Mis órdenes |
| QR de lugar o activo | 8 formatos | mejor | — | Un solo formato |
| Tablet de cuadrilla | PortalTablet | igual o mejor | — | Falta probarla en vivo |
| Fichaje con GPS y sin señal | Fichar | igual o mejor | — | — |
| Empleados y vínculo con usuario | Employees, vincularEmpleado | mejor | — | — |
| Emergencias y patrones | Emergencias | mejor | — | — |
| Rutinas | Rutinas | igual o mejor | — | — |
| Calefacción | Calefaccion | igual o mejor | — | Probar con la planilla real |
| Inspecciones con informe IA | InspeccionColegio | igual o mejor | — | — |
| Informe de inspección en PDF | InformeViewer | parcial | S | Descarga directa |
| Pendientes SAP | PendientesTab | igual o mejor | — | — |
| Pendientes en PDF | ExportarPendientesPDF | parcial | S | Hoy solo CSV |
| Propagar un cambio de jefe a pendientes y calefacción | sincronizarPendientes | parcial | S | — |
| Información general e importación del directorio | InformacionGeneral | igual o mejor | — | — |
| Importación jerárquica por comuna | importarEscuelasJerarquico | parcial | S | Arrastrar dirección y jefe hacia abajo |
| Mapa, mapa de jefes, fichajes y OTs en el mapa | Mapa, MapaJefes | igual o mejor | — | — |
| Obras en el mapa | MapaProyectosOTs | falta | M | — |
| Importar la cobertura de jefes | ImportarMapaJefes | falta | S | Decisión |
| Calendario | Calendario | mejor | — | — |
| Activos y expediente | Assets | mejor | — | — |

### Control y administración
| Capacidad | v1 | v2 | Esfuerzo | Qué falta |
|---|---|---|---|---|
| Auditoría automática e inmutable | logAudit | mejor | — | — |
| Pantalla de auditoría | Auditoria | igual o mejor | — | — |
| Chequeo de salud del sistema | auditarSistema | falta | S | — |
| Alertas en vivo y contador en el menú | checkAlertas | mejor | — | — |
| Umbrales de alertas | ConfigAlertas | parcial | S | Activar o desactivar por tipo |
| Alertas por mail | checkAlertas | falta | M | Proveedor de correo |
| Historial de alertas | AlertaLog | falta | S | — |
| Resumen semanal en pantalla | resumenSemanal | parcial | S | Preset en reportes |
| Resumen semanal por mail | resumenSemanal | falta | M | Proveedor de correo |
| Reportes operativos | Reportes | mejor | — | — |
| Reporte de plantel y de stock | Reportes | parcial | S | — |
| Tablero | Dashboard | igual o mejor | — | Filtros (S) |
| Informes y calendario de informes | Informes, CalendarioInformes | mejor | — | — |
| Planificación anual de informes | importarInformesPlaneacion | falta | M | Decisión |
| Control de riesgos | ControlRiesgo | igual o mejor | — | — |
| Foro | Foro | parcial | M | Sin encuestas, reacciones ni menciones (a propósito) |
| Aviso del foro en el menú | ForoNotificacionesBell | parcial | S | — |
| Notificaciones push | checkAlertas | falta | M | En la v1 no llegaban |
| Firmas de jefes cargadas por el admin | GestorFirmasJefes | parcial | S | — |
| Asistente y chatbot con IA | Alice, ChatbotSoporte | falta | M | Dejado afuera; se podría con Gemini |
| Permisos aplicados de verdad | checkPermission | mejor (en la base) | — | — |
| Usuarios con rol y sector | Permisos | igual o mejor | — | — |
| Sectores, observar un sector | Sectores, observarSector | igual o mejor | — | — |
| 2FA | twoFactorAuth | falta | S | MFA de Supabase |
| Sesiones y logins sospechosos | SessionAudit | parcial | M | Leer el registro de Supabase Auth |
| Registro de uso de la app | AppUsageLog | falta | S | — |
| Ayuda y tutorial | Tutorial | parcial | S | Sin progreso ni guía paso a paso |
| Buscador global (Ctrl+K) | — | nuevo en la v2 | — | — |
