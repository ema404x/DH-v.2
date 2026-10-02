# Migración DH1 v1 (Base44) → v2 (Supabase)

`migrar.ts` corre con Deno. **Por defecto es un simulacro: lee, transforma y reporta, sin escribir nada.**
Solo escribe con `--apply`.

## Variables de entorno

| Variable | Para qué |
|---|---|
| `SUPABASE_URL` | Proyecto de destino |
| `SUPABASE_SERVICE_ROLE_KEY` | Escribir saltando la RLS. Solo en esta terminal, nunca en `.env.local` ni en el repo |
| `BASE44_APP_ID`, `BASE44_API_KEY` | Leer la v1 por API |
| `BASE44_API_URL` | Opcional. Por defecto `https://app.base44.com/api/apps` |

Si la API de Base44 no responde como espera el script, se puede trabajar con archivos: exportar cada
entidad a JSON y usar `--desde=<carpeta>` (un archivo `<Entidad>.json` por entidad: `Sector`, `Employee`,
`LocationData`, `LocationQR`, `Asset`, `OTTemplate`, `WorkOrder`, `Certificado`).

## Probar el script sin tocar nada

```bash
deno run -A migracion/migrar.ts --desde=migracion/ejemplo --sector-de=LocationQR:escuela
```

`migracion/ejemplo/` trae unos pocos registros inventados, incluidos algunos sin sector, para ver el reporte.

## Orden recomendado

1. **Simulacro completo** y leer el reporte (`migracion/salida/reporte.json`):
   ```bash
   deno run -A migracion/migrar.ts
   ```
2. **Resolver los "sin sector".** Nada sin sector se carga, y no hay sector por defecto.
   - Entidades que en la v1 tienen `sector_id`: corregirlo en la v1 (backfill) y volver a simular.
   - `LocationQR` y `OTTemplate` no tenían sector en la v1: indicarlo explícito, por entidad:
     `--sector-de=LocationQR:escuela --sector-de=OTTemplate:escuela`.
3. **Sectores y perfiles primero**, e invitar a la gente:
   ```bash
   deno run -A migracion/migrar.ts --solo=sectores --apply
   deno run -A migracion/migrar.ts --solo=perfiles
   ```
   El paso de perfiles deja `migracion/perfiles_pendientes.json` con los empleados que todavía no tienen
   usuario en v2. Invitarlos desde Gestión → Usuarios (o en lote con la edge function).
   **Hacerlo antes de migrar las órdenes:** una OT solo queda asignada si su operario ya tiene usuario;
   si no, queda sin asignar y se reporta.
4. **El resto**, con el simulacro en 0 sin-sector:
   ```bash
   deno run -A migracion/migrar.ts --apply
   ```
   Al final compara lo que quedó en destino contra lo enviado, tabla por tabla.

Es re-ejecutable: todo va por upsert sobre `id_origen`, correrlo dos veces no duplica.

## Qué hace con cada entidad

| v1 | v2 | Notas |
|---|---|---|
| `Sector` | `sectores` | Por `clave` |
| `Employee` | `perfiles` | No crea cuentas. Engancha por correo a los que ya existen; el resto va a `perfiles_pendientes.json` |
| `LocationData` + `LocationQR` | `ubicaciones` | Cada ubicación recibe un QR nuevo con el formato único de v2: hay que reimprimirlos |
| `Asset` | `activos` | La ubicación se engancha por nombre (sede/location); si no coincide, queda el texto en "área" |
| `OTTemplate` | `plantillas_ot` | |
| `WorkOrder` | `ordenes_trabajo` + `ot_fotos` | `assigned_name` → `asignado_a` por correo o nombre. Estado `obra` → `en_progreso`. Las fotos quedan referenciadas a su URL de Base44 |
| `Certificado` | `contratos` + `contrato_items` + `certificados` + `certificado_items` | Solo emitidos y aprobados, como historia y sin recalcular. Borradores y tipo `informe` no se migran |

| `Direccion` | `direcciones` | Se cargan junto con las ubicaciones. No tenían sector: `--sector-de=Direccion:escuela` |
| `RutinaCatalogo`, `Edificio`, `RutinaEdificio`, `OrdenRutina` | `rutinas_catalogo`, `rutinas_ubicacion`, `ordenes_rutina` | `Edificio` no existe en v2: las rutinas van a la ubicación. El catálogo no tenía sector: `--sector-de=RutinaCatalogo:escuela`. De las órdenes abiertas repetidas queda la más nueva |
| `Pendiente` | `pendientes` | Un número de SAP por sector: los repetidos se reportan y entra uno |
| `Emergencia` | `emergencias` | No tenía sector: `--sector-de=Emergencia:escuela`. Si el establecimiento no coincide con una ubicación migrada, no entra y se reporta |
| `EquipamientoCalefaccion` | `equipamiento_calefaccion` | Los repetidos por escuela, equipo y período se suman |
| `InspeccionColegio` | `inspecciones` | Con sus secciones, fotos e informe |

Jefes de sitio e inspectores: si la persona ya tiene usuario en v2 queda enganchada por id; si no, se conserva
el nombre tal como estaba en la v1. Por eso conviene invitar primero a la gente (paso 3).

Pasos agregados en las tandas 3 a 6 (`--solo=gente|obras|panol|control|admin`): empleados, fichajes, horas y
tablets (`Employee`, `AttendanceLog`, `TimeLog`, `Tablet`); obras y cobro (`Client`, `Project`, `ObraCertificacion`,
`SolicitudCertificado`, `PresupuestoExcel`, `AbonoMaestro`); pañol (`Material`, `MovimientoPanol`,
`RequerimientoCompra`); informes y umbrales de alertas (`Informe`, `AlertaConfig`); riesgos y foro (`RiesgoControl`,
`ForoHilo`, `ForoRespuesta`). La auditoría de la v1 no se migra (la v2 la escribe desde el día uno) y facturación
tampoco (decisión: DH1 no factura).

## Después de migrar

- Revisar en la app un contrato migrado: los certificados nuevos numeran a continuación del último histórico
  y toman como "anterior" lo certificado en la historia.
- Las fotos de OTs viejas siguen alojadas en Base44. Copiarlas al bucket `ot-fotos` antes de dar de baja la v1.
- Reimprimir los QR de ubicaciones y activos.
