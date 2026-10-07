# Portales sin login (punto 3) — propuesta para decidir

Escrito el 7/10/2026 a la noche. **No está programado.** Reabre una decisión cerrada (CLAUDE.md §2.1: "Todo con login").
Para hacerlo hace falta tu decisión explícita.

## Qué hace la v1 hoy

| Pantalla | Qué permite sin usuario | Cómo se controla |
|---|---|---|
| `/portal-operario?loc=` o `?asset=` | Ver las órdenes abiertas del lugar o equipo, iniciarlas y finalizarlas con fotos | Una **clave única compartida** por todos los operarios + el nombre que cada uno tipea |
| `/ejecutar-ot?ot=` | Marcar checklist, subir fotos, firmar y mandar la orden al jefe | La misma clave compartida |
| `/ejecutar-ot-simple?ot=` | "Marcar como completada" | Hoy **no funciona**: la base de la v1 lo rechaza en silencio |
| `/orden-trabajo?ot=` | Ver una orden cerrada | Nada (es pública) |
| `/tablet` | Vincular una tablet con un código y ver las órdenes del jefe | Código de activación |

Problemas que tiene la v1 (salen de la especificación `ESPEC-OT-v1.md` §7 y §12):
- **La clave es una sola para todos.** Si un operario se va de la empresa o la clave circula, no hay forma de saber quién hizo qué. Tampoco se puede cortar el acceso a una sola persona.
- **El nombre lo tipea cada uno.** Cualquiera puede escribir el nombre de otro. La orden queda "a nombre de" lo que se escribió.
- **Las funciones públicas usan permisos de administrador del lado del servidor** (`publicFichar` con service role). Un error en una de ellas expone datos de todo el sector.
- **Varias pantallas tienen fallas**: `/ejecutar-ot-simple` no funciona; la firma no se guarda al finalizar; se pisan las fotos de referencia; la pantalla dice "enviada al jefe" aunque no lo esté.

## Qué ya tiene la v2 que resuelve lo mismo

- **QR por lugar y por equipo** (`/q?t=...`). Con la sesión abierta en el teléfono, escanear lleva directo a las órdenes de ese lugar. Funciona **sin señal**.
- **Tablet de cuadrilla.** Es un usuario propio de la tablet, que ve las órdenes de los lugares de su jefe de sitio. Además ficha a la gente. Es el reemplazo de `/tablet` de la v1, con login una sola vez.
- **La sesión dura.** El operario entra una vez y el teléfono queda logueado. No tiene que poner usuario cada vez.

## Opciones

### A. Dejarlo como está (recomendado)
Todo con usuario. La tablet de cuadrilla cubre el caso "un teléfono para varios".

- **Costo:** 0.
- **Riesgo:** ninguno nuevo.
- **Contra:** cada operario necesita un usuario, o hay que usar la tablet.

### B. Ingreso rápido con PIN (intermedio)
El operario elige su nombre de una lista del lugar y pone un **PIN personal de 4 a 6 dígitos**, sin email ni contraseña. Por debajo es un usuario real de Supabase, así que todo queda a su nombre y se le puede cortar el acceso a él solo.

- **Costo:** unas 4 a 6 horas. Lleva SQL nuevo y una edge function de ingreso con límite de intentos.
- **Riesgo:** bajo. Un PIN corto se puede adivinar, así que la cuenta se bloquea después de 5 intentos fallidos.

### C. Portal público como la v1, con clave compartida
Pantalla sin usuario, abierta desde el QR del lugar. Pide la clave compartida y el nombre.

Para hacerlo menos riesgoso que en la v1:
- una edge function que **solo** permite iniciar y finalizar órdenes **de ese lugar**;
- límite de intentos por teléfono;
- registro de cada acción con la IP y el nombre tipeado;
- la clave guardada con hash en la configuración del sector, cambiable por el admin.

- **Costo:** 6 a 10 horas.
- **Riesgo:** medio. Mantiene el problema de fondo: no se sabe quién fue de verdad, y una clave filtrada abre todos los lugares del sector.

## Recomendación

**A**, y si a los operarios les cuesta entrar, **B**. La C solo tiene sentido si hay operarios que no van a tener nunca un usuario y no se puede usar la tablet.

Decime A, B o C y lo hago. Si es B o C, el SQL lo pruebo en local y te lo muestro antes de correrlo.
