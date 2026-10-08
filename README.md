# Nocturna Pizza

Sitio de Nocturna Pizza: landing responsive, catálogo de menú y contacto.

- `index.html`: portada, pizzas destacadas, promociones, galería, opiniones y cómo pedir.
- `menu.html`: catálogo con filtros y pedido por WhatsApp.
- `contacto.html`: datos, horarios, mapa, formulario y preguntas frecuentes.
- `admin/`: panel privado para pedidos, mensajes y socios del Pase Nocturno.

En la navbar de las tres páginas públicas está el botón **🔑 Mi Pase Nocturno**, en el
HTML y no montado por JavaScript: si el JS no carga, el botón sigue visible y hay un
`<noscript>` con un link a WhatsApp para pedir el pase a mano. El módulo `js/pase-ui.js`
solo le pone los puntos al botón y monta el modal.

El módulo marca el botón con `data-pase-ready` recién cuando quedó montado. Si no carga
(import roto) o no puede mostrar el `<dialog>`, `script.js` ve el clic sin esa marca y
abre WhatsApp con el pedido del pase: el botón nunca se queda mudo. Ese clic sin marca
era justamente el síntoma del bug de `formatBirthday` sin `export`.

El frontend es estático y lo publica Netlify. La API y la base viven en Render
y Supabase respectivamente.

## Diseño y motion (rediseño 2026)

Referencia: los SOTD de Awwwards de la categoría *Food & Drink* — tipografía
cinética, scroll storytelling y micro-interacciones, sobre la identidad
original (cobre sobre negro, Cormorant Garamond + DM Sans).

La capa nueva está **al final de `styles.css`** (sección *"Rediseño 2026"*),
así que pisa lo anterior sin tocarlo. Incluye preloader, grano de película,
palabra fantasma del hero, marquee, reveals con cascada, barra de progreso de
lectura y estados hover.

`js/motion.js` agrega lo que necesita JS: intro del hero al cerrar el
preloader, parallax, botones magnéticos y la cortina de transición entre
páginas. Va **después** de GSAP por CDN (jsDelivr) y todo está guardado:

- Si GSAP no carga (sin red, CDN caído), `motion.js` no hace nada y el sitio
  se ve completo: el contenido nunca depende de la animación.
- Si el usuario pidió menos movimiento (`prefers-reduced-motion`), la capa de
  motion se apaga y el CSS anula marquee, grano y preloader.
- El preloader solo existe con JS (`html.has-js`) y tiene un failsafe de
  2,6 s: no puede dejar la página tapada.
- `script.js` es el que revela los `.reveal` (IntersectionObserver) y pone la
  cascada con `nocturnaStagger`; funciona sin GSAP.

Para volver al diseño anterior: basta con quitar los bloques "Rediseño 2026"
de `styles.css`, `js/motion.js` y los `<script>` de GSAP de las tres páginas.

## Ver el sitio localmente

El sitio estático necesita un servidor (los módulos ES no funcionan con
`file://`):

```bash
python -m http.server 4173
```

Después abrí `http://localhost:4173`.

Para que el menú y el formulario hablen con la API, levantá también el backend:

```bash
docker compose up -d          # Postgres local en :5432
cd server
npm install
npm run migrate               # crea el esquema
npm run seed                  # carga categorías y pizzas
npm run dev                   # API en :3000
```

Con eso `menu.html` y `index.html` leen de la base y el pedido se registra antes
de abrir WhatsApp.

## La API

`server/` es un servicio Fastify sobre Node 20+.

```bash
npm run dev            # con recarga
npm start              # producción
npm test               # tests
npm run migrate        # aplica migraciones
npm run migrate:status # qué se aplicó
npm run migrate:down   # revierte la última
npm run seed           # carga el menú de ejemplo
```

### Variables de entorno

Copiá `server/.env.example` a `server/.env`. En desarrollo hay defaults para
todo, así que solo hace falta el archivo si vas a apuntar a Supabase.

En producción no hay defaults: si falta una variable, el proceso falla al
arrancar. Las dos URLs de base de datos:

| Variable | Para qué | Puerto |
|---|---|---|
| `DATABASE_URL` | La app en runtime | 6543 (Supavisor, transaction mode) |
| `DATABASE_MIGRATION_URL` | Solo migraciones | 5432 (conexión directa) |

`DATABASE_URL` contra Supavisor necesita `statement_mode=direct`, porque el pooler
no soporta prepared statements.

### Endpoints públicos

```
GET  /api/health
GET  /api/categories
GET  /api/pizzas?category=&featured=&available=
GET  /api/pizzas/:slug
POST /api/orders          → guarda el pedido y devuelve el link de WhatsApp
GET  /api/orders/:code    → solo estado; no expone datos del cliente
POST /api/messages
```

`POST /api/orders` ignora los precios que mande el cliente: los precios salen de
la tabla `pizzas`. Guarda un snapshot del nombre y el precio en `order_items`,
así que cambiar el precio mañana no altera los pedidos viejos.

## El panel

`admin/` es un panel estático servido por Netlify que consume `/api/admin/*`.

El login es por WhatsApp y funciona al revés de lo habitual: pedís entrar,
la API genera un token de un solo uso con 15 minutos de vida y te devuelve un
link `wa.me` **a tu propio número**. Abrís el link desde el chat, la API canjea
el token por una sesión en cookie `httpOnly` y quedás adentro.

El enlace es un secreto de portapapeles: no hay verificación de dispositivo.
Compensa con uso único, vencimiento corto y límite de 5 emisiones por hora.
Si alguna vez hace falta más de una persona, hay que migrar a la Cloud API de
Meta con plantillas aprobadas.

```
POST   /api/admin/login/request
POST   /api/admin/login/verify     { token }
POST   /api/admin/logout
GET    /api/admin/session
GET    /api/admin/orders?status=&from=&to=&page=
GET    /api/admin/orders/:id
PATCH  /api/admin/orders/:id/status   { status }
GET    /api/admin/messages?unread=
PATCH  /api/admin/messages/:id/read
```

Estados de un pedido: `new` → `confirmed` → `preparing` → `out_for_delivery` →
`delivered`, con `cancelled` desde cualquier punto antes de `delivered`.

## Pase Nocturno

Fidelización para el cliente. El botón 🔑 está en la navbar de las tres páginas
públicas, y el panel tiene una pestaña **Socios**.

```
POST   /api/members                 → registro (idempotente por teléfono)
GET    /api/members/me              → el pase de este dispositivo
POST   /api/members/request-code    → reenvía el código por WhatsApp
POST   /api/members/redeem          → pide un beneficio

GET    /api/admin/members?search=&minPoints=&sort=
GET    /api/admin/members/birthdays
GET    /api/admin/members/:id
PATCH  /api/admin/members/:id/points   { points, note }
POST   /api/admin/members/:id/redeem   { benefit }
```

### Dónde viven los puntos

`localStorage` guarda **solo un token de dispositivo**, nunca el saldo. Los
puntos se leen siempre de la base, así que:

- Editar el navegador no cambia tu saldo.
- Si borrás los datos del navegador y te registrás de nuevo con el mismo
  WhatsApp, la API te reconoce por número, te devuelve **tu código original y
  tus puntos reales**, y no te regala los 20 de bienvenida otra vez.
- Si el token de un celular perdido molesta, el cliente pide uno nuevo.

El token solo permite **leer** el pase y pedir canjes. Mover saldos es cosa del
panel: por eso un token filtrado no sirve para robar puntos.

### Puntos y beneficios

| Puntos | Beneficio |
|---|---|
| 20 (bienvenida) | 10% OFF en el primer pedido |
| 50 | Fainá o bebida a elección |
| 100 | Nocturna Margherita gratis |
| Cumpleaños | Postre sin cargo, 3 días antes a 3 días después |

Un punto por cada **$1.000** gastados, redondeando hacia abajo. Se acreditan
automáticamente cuando marcás un pedido como **entregado**; si después lo
sacá de entregado, los puntos se descuentan.

El 10% de bienvenida y los 20 puntos son **dos cosas distintas**: el descuento
se canjea una sola vez y no consume puntos.

El cumpleaños se evalúa por mes y día, así que se repite cada año solo. Tenés
que cargarlo: es un campo opcional del registro.

Todos los umbrales viven en `server/src/lib/loyalty.js` y están duplicados en
`js/pase.js` para que la UI no requiera un request extra. Hay un test que
falla si los dos archivos se desincronizan.

### Administrarlo

El flujo del cliente es: toca el botón → carga nombre, WhatsApp y cumpleaños
(opcional) → ve su código en grande con un botón que abre WhatsApp para
mandárselo al local → después ve la tarjeta con sus puntos y beneficios. El
WhatsApp va **al local**, que es quien tiene que ver el código.

En `admin/socios.html`:

- Los cumpleaños de los próximos 30 días salen arriba, con un aviso para
  escribirles.
- **Ajustar puntos** pide el saldo final y un motivo; queda asentado en el
  historial, así que el saldo siempre se puede reconstruir sumando los
  movimientos.
- **Historial** muestra cada movimiento: bienvenida, compra, canje, ajuste.

El canje no es automático a propósito. El cliente lo pide, se abre WhatsApp
con el pedido armado, y **vos lo confirmás desde el panel**. Recién ahí se
descontan los puntos. Si fuese automático, cualquiera podría ejecutarlo con
`curl` sin tener la pizza.

El seed crea un socio de ejemplo, `#SOCIO-DEMO1` con 65 puntos, para probar
el panel sin registrarse.

## Deploy

### Supabase

1. Crear el proyecto y copiar la contraseña de `Settings → Database`.
2. Construir las dos URLs:

   ```
   DATABASE_URL=postgresql://postgres.REF:PASS@aws-0-REGION.pooler.supabase.com:6543/postgres?statement_mode=direct
   DATABASE_MIGRATION_URL=postgresql://postgres:PASS@db.REF.supabase.co:5432/postgres
   ```

3. Correr migraciones y seed desde la máquina con esas URLs.
4. En el SQL Editor, activar RLS **sin crear políticas para `anon`**. Así
   PostgREST no expone nada aunque alguien consiga la `anon key`.

### Render (API)

Web Service conectado al repo:

| Campo | Valor |
|---|---|
| Root Directory | `server` |
| Build Command | `npm ci` |
| Start Command | `npm start` |
| Pre-deploy Command | `npm run migrate` |
| Health Check Path | `/api/health` |

Variables de entorno: `NODE_ENV=production`, `PORT=3000`, las dos URLs,
`CORS_ORIGINS=<url de Netlify>`, `ADMIN_WHATSAPP`, `PUBLIC_SITE_URL`,
`SESSION_SECRET` (32+ caracteres aleatorios).

El plan free duerme el servicio tras unos minutos de inactividad, así que el
primer request puede tardar. Para un sitio chico va bien; si molesta, el plan
Hobby lo resuelve.

### Netlify (frontend)

`netlify.toml` publica la raíz y proxya `/api/*` al servicio de Render. El
frontend llama siempre a rutas relativas, por lo que no hay CORS ni una URL de
API hardcodeada en el HTML.

Recordá actualizar `CORS_ORIGINS` en Render con la URL final de Netlify.

## Tests

```bash
cd server && npm test
```

Son dos suites y no levantan la base:

- **`tests/api.test.js`** prueba la capa HTTP sin base: validación con zod, armando de
  mensajes de WhatsApp, generación de códigos, y que las rutas protegidas devuelvan
  401. El pool se sustituye por un stub.
- **`tests/db.test.js`** crea el esquema real de las migraciones en un Postgres en
  memoria ([pg-mem](https://github.com/oguimbal/pg-mem)) y corre las queries de los
  repositorios contra él. Cubre nombres de columnas, CHECK/FK, el cálculo del total, el
  rollback de transacciones, el flujo de login y el Pase Nocturno.
- **`tests/loyalty.test.js`** prueba las reglas del pase sin base: umbrales, redondeo de
  puntos, ventana de cumpleaños, formato de teléfono y aleatoriedad del código.
- **`tests/pase-ui.test.js`** verifica que `js/pase.js` tenga los mismos umbrales y el
  mismo formato de precios que el server, y que el mensaje de WhatsApp del cliente
  incluya su código.

El panel se puede usar en celular: bajo 640px las tablas pasan a tarjetas
apiladas y el encabezado se oculta visualmente pero sigue disponible para
lectores de pantalla.

Limitaciones de pg-mem que quedan sin cubrir y conviene probar contra Postgres real
(`docker compose up -d && npm run migrate`): no aplica constraints `UNIQUE` (o sea, la
colisión de `orders.order_code` y de `members.member_code`, y el reintento del INSERT),
no ejecuta triggers, y no soporta extensiones ni funciones plpgsql.