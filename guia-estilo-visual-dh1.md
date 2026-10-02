# Guía de estilo visual — DH1 v2

Lo que sigue está aplicado en `app/`. Si una pantalla nueva necesita salirse de esto, primero se cambia la guía.

## 1. Color: solo tokens

Tema oscuro azulado, el mismo de la v1. Los colores viven en `app/app/globals.css` como variables HSL y
`app/tailwind.config.ts` los expone como clases. **En los componentes no hay colores escritos a mano**
(ni hex, ni `rgb()`, ni la paleta por defecto de Tailwind, que está reemplazada).

| Token | Clase | Uso |
|---|---|---|
| `--fondo` | `bg-fondo` | Fondo de la app |
| `--barra` | `bg-barra` | Navegación y barra de acción fija |
| `--superficie` | `bg-superficie` | Tarjetas, tablas |
| `--elevado` | `bg-elevado` | Controles, filas resaltadas |
| `--borde` | `border` | Todos los bordes |
| `--texto` / `--suave` | `text-texto` / `text-suave` | Texto principal / secundario |
| `--primario` | `bg-primario`, `text-primario` | La acción principal y los enlaces |
| `--exito`, `--alerta`, `--peligro`, `--info` | `text-…`, `bg-…/10`, `border-…/40` | Estados |
| `--papel`, `--tinta` | | Hoja impresa y fondo del QR |

Únicas excepciones, porque el navegador no acepta variables ahí: `theme_color` del manifest y del `viewport`.

## 2. Tipografía

- Inter, cargada con `next/font` (queda servida desde la app, sin pedirla a Google en cada visita).
- Base 16 px. **El tamaño más chico que existe es 14 px**: la escala de Tailwind está redefinida
  (`text-xs` = 14 px, `text-sm` = 15 px, `text-base` = 16 px).
- Números en columnas con la clase `num` (cifras del mismo ancho, alineadas a la derecha).

## 3. Controles

- Alto mínimo **44 px** (`min-h-control`). En las pantallas de campo, **48 px** (`min-h-campo`, prop `campo` de `Boton`).
- Casillas de 24 px dentro de una fila de 44 px: se toca la fila entera.
- Foco siempre visible (contorno primario).

## 4. Un solo botón primario por pantalla

El primario es el paso que se espera del usuario: Escanear QR, Iniciar trabajo, Finalizar trabajo, Aprobar,
Crear orden, Emitir certificado. Todo lo demás va en `secundario` o `fantasma`. `peligro` solo para cancelar,
rechazar o borrar. En el portal del operario el primario queda fijo abajo, al alcance del pulgar.

## 5. Estados: icono + texto

Ningún estado se comunica solo con color. `EstadoBadge` muestra siempre icono y palabra
(Pendiente, En curso, A validar, Vencida, Emitido, etc.). Los avisos dentro de una tabla repiten el texto
("Supera la cantidad del contrato"), además del fondo.

## 6. Los cuatro estados de cada vista

Toda pantalla que trae datos resuelve los cuatro, con `useCarga` y los componentes de `Estados.tsx`:

1. **Cargando** → `Esqueleto`.
2. **Vacío** → `Vacio`, que dice qué falta y qué hacer ("Todavía no hay ubicaciones. Cargá los edificios…").
3. **Error** → `ErrorVista`, con el mensaje y "Probar de nuevo".
4. **Datos**.

Sin señal, `AvisoOffline` avisa que se está viendo lo último cargado. Nunca recarga la pantalla por su cuenta.

## 7. Textos

- Español rioplatense, con voseo, en lenguaje de obra: "Iniciar trabajo", "Devolver para corregir",
  "Sin asignar: queda a nombre de quien la inicie".
- Los errores de negocio los redacta la base y se muestran tal cual; dicen qué pasó y qué hacer.
- Un mismo nombre para cada cosa en toda la app: "orden" (no "ticket" ni "tarea"), "ubicación", "activo",
  "certificado", "sector".
- Botones con el verbo de lo que hacen. El aviso de éxito repite ese verbo ("Emitir certificado" → "Certificado emitido").

## 8. Disposición

- Operario: una columna de hasta 36 rem, tarjetas grandes, acción fija abajo.
- Gestión: navegación lateral en escritorio y fila deslizable arriba en el teléfono. Las tablas esconden
  columnas secundarias en pantallas angostas en vez de achicar la letra.
- Impresión: la hoja del certificado (`.hoja`) sale en claro y sin navegación (`.no-imprimir`).
