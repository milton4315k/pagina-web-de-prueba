# Nocturna Pizza

Sitio de Nocturna Pizza con backend propio, login con Google y un asistente virtual.

- **Frontend:** estático, en `public/` (HTML + módulos ES, sin bundler).
- **Backend:** un solo archivo, `server.js`, sobre `node:http`. Sirve el frontend y la API.
- **Base de datos:** Supabase Postgres (cliente `pg`).
- **Login:** Supabase Auth con Google, para clientes y para el panel.
- **Asistente:** OpenAI (Chat Completions), con la key solo en el servidor.
- **Deploy:** un único servicio en Render, que sirve todo.

```
.
├── server.js            # backend completo (config, API, estáticos, migraciones, seed)
├── package.json         # pg + dotenv + zod
├── .env.example         # plantilla de variables (esta SÍ se sube)
├── public/              # frontend servido por server.js
│   ├── index.html  menu.html  contacto.html
│   ├── styles.css  script.js  favicon.svg
│   ├── js/              # api.js, pase.js, pase-ui.js, asistente, etc.
│   └── admin/           # panel privado (index, mensajes, socios, login)
└── server/              # backend viejo (Fastify). Queda solo como referencia.
```

> El plan free de Render duerme el servicio tras unos minutos de inactividad, así
> que el primer request puede tardar unos segundos.

---

## 1. Correr en local

Requisitos: **Node 20+**.

```bash
npm install
cp .env.example .env      # en Windows: copy .env.example .env
```

Completá `.env` (ver la sección 3). Después:

```bash
npm run migrate           # crea/actualiza el esquema en Supabase (idempotente)
npm run seed              # carga categorías, pizzas y un socio demo
npm start                 # http://localhost:3000
```

Abrí **http://localhost:3000**. El mismo servidor entrega el sitio y la API, así
que no hay CORS ni URLs de API hardcodeadas.

Comandos:

| Comando | Qué hace |
|---|---|
| `npm start` | Arranca el servidor |
| `npm run dev` | Arranca con recarga al guardar (`node --watch`) |
| `npm run migrate` | Aplica el esquema (seguro de correr varias veces) |
| `npm run seed` | Carga el menú y el socio demo |

Si faltan las credenciales de Supabase o de OpenAI, el servidor arranca igual y
lo avisa por consola: el sitio y el menú funcionan, el login y el asistente no.

---

## 2. Variables de entorno

Todas viven en `.env` en la raíz. En Render se cargan a mano en **Environment**
(el `.env` no se sube al repo).

| Variable | Para qué |
|---|---|
| `PORT` | Puerto del servidor (Render lo inyecta). |
| `PUBLIC_SITE_URL` | URL pública del sitio (se usa en mensajes). |
| `ADMIN_WHATSAPP` | WhatsApp del local, solo dígitos. |
| `ADMIN_EMAILS` | Emails con acceso al panel, separados por coma. |
| `DATABASE_URL` | Postgres para la app (pooler *transaction*, puerto 6543). |
| `DATABASE_MIGRATION_URL` | Postgres para migrar (pooler *session*, puerto 5432). |
| `SUPABASE_URL` | URL del proyecto Supabase. |
| `SUPABASE_ANON_KEY` | Key pública (viaja al navegador vía `/api/config`). |
| `SUPABASE_SERVICE_ROLE_KEY` | Key secreta (no se usa en el navegador). |
| `OPENAI_API_KEY` | Key del asistente. |
| `OPENAI_MODEL` | Modelo (default `gpt-4o-mini`). |

---

## 3. API

Públicas:

```
GET  /api/health
GET  /api/config                      → config pública (Supabase URL/anon key)
GET  /api/categories
GET  /api/pizzas?category=&featured=&available=
GET  /api/pizzas/:slug
POST /api/orders                      → guarda el pedido y devuelve el link de WhatsApp
GET  /api/orders/:code                → solo estado; no expone datos del cliente
POST /api/messages
POST /api/assistant                   → asistente virtual
```

Con sesión (header `Authorization: Bearer <access_token>`):

```
GET   /api/members/me                 → el pase del usuario logueado
PATCH /api/members/me                 → nombre, WhatsApp, cumpleaños
POST  /api/members/redeem             → pide un beneficio
POST  /api/members/request-code       → manda el código al local por WhatsApp
```

Panel (sesión + email en `ADMIN_EMAILS`):

```
GET    /api/admin/session
GET    /api/admin/orders?status=&from=&to=&page=
GET    /api/admin/orders/:id
PATCH  /api/admin/orders/:id/status   { status }
GET    /api/admin/messages?unread=
PATCH  /api/admin/messages/:id/read
GET    /api/admin/members?search=&minPoints=&sort=
GET    /api/admin/members/birthdays
GET    /api/admin/members/:id
PATCH  /api/admin/members/:id/points  { points, note }
POST   /api/admin/members/:id/redeem  { benefit }
```

`POST /api/orders` ignora los precios que mande el cliente: salen de la tabla
`pizzas`. Guarda un snapshot del nombre y el precio en `order_items`, así que
cambiar el precio mañana no altera los pedidos viejos.

Estados de un pedido: `new` → `confirmed` → `preparing` → `out_for_delivery` →
`delivered`, con `cancelled` desde cualquier punto antes de `delivered`.

---

## 4. Login con Google

Lo maneja **Supabase Auth**. El flujo es:

1. El navegador pide `/api/config` y crea el cliente de Supabase con la URL y la
   anon key.
2. "Entrar con Google" abre el consentimiento de Google. Supabase recibe el
   callback y devuelve la sesión al sitio.
3. Cada llamada a la API manda el **access token** de Supabase en
   `Authorization: Bearer …`.
4. El servidor valida el token contra `GET {SUPABASE_URL}/auth/v1/user` (no
   necesita el JWT secret) y saca `id`, `email` y avatar.
5. La primera vez, el servidor crea el socio (`members`) con los 20 puntos de
   bienvenida y lo vincula por `auth_user_id`.

El **panel** usa el mismo login. La diferencia es el email: solo entran las
cuentas de `ADMIN_EMAILS`. Una cuenta de Google que no esté en la lista recibe
`403` y el login le avisa que no tiene acceso.

Los umbrales de puntos viven solo en `server.js` (sección "Reglas del Pase"). El
frontend los recibe por `/api/config`, así que no hay dos copias que se puedan
desincronizar.

---

## 5. Pase Nocturno

Fidelización del cliente. El botón **🔑 Mi Pase Nocturno** está en la navbar de
las tres páginas públicas. Si el JS del pase no carga, `script.js` abre WhatsApp
con el pedido del pase a mano: el botón nunca queda mudo.

| Puntos | Beneficio |
|---|---|
| 20 (bienvenida) | 10% OFF en el primer pedido |
| 50 | Fainá o bebida a elección |
| 100 | Margherita gratis |
| Cumpleaños | Postre sin cargo, 3 días antes a 3 días después |

Un punto por cada **$1.000** gastados, redondeando hacia abajo. Se acreditan
cuando el panel marca el pedido como **entregado**; si se lo saca de entregado,
se descuentan. El 10% de bienvenida y los 20 puntos son cosas distintas: el
descuento se canjea una sola vez y no consume puntos.

Los puntos viven **siempre en la base**: el navegador no es fuente de verdad.
Ajustar puntos desde el panel pide el saldo final y un motivo, y queda asentado
en el historial. El canje no es automático a propósito: el cliente lo pide, el
panel lo confirma, y recién ahí se descuentan los puntos.

El `seed` crea un socio de ejemplo, `#SOCIO-DEMO1` con 65 puntos.

---

## 6. Asistente virtual

`POST /api/assistant` recibe la conversación y responde con OpenAI. El servidor
inyecta el menú real en el prompt del sistema y, si el mensaje trae un código
`NP-XXXXX`, consulta el estado real del pedido. El widget del frontend
(`public/js/assistant.js`) solo aparece si el asistente está configurado.

---

## 7. Deploy en Render

Un **Web Service** conectado al repo de GitHub:

| Campo | Valor |
|---|---|
| Root Directory | *(vacío: la raíz)* |
| Build Command | `npm install` |
| Start Command | `npm start` |
| Health Check Path | `/api/health` |

Variables en el panel de Render: cargá todas las de la sección 2 con
`NODE_ENV=production` y `PUBLIC_SITE_URL` apuntando a la URL del servicio.

Las migraciones se corren una vez desde tu máquina (`npm run migrate`) apuntando
a la base de Supabase, o como *Pre-deploy Command* (`npm run migrate`).

### Supabase

1. Crear el proyecto.
2. **Settings → Database → Connect**: copiar la connection string. `DATABASE_URL`
   con el pooler *Transaction* (6543) y `DATABASE_MIGRATION_URL` con el *Session*
   (5432).
3. **Authentication → Providers → Google**: activar y pegar Client ID/Secret.
4. **Authentication → URL Configuration**: Site URL y Redirect URLs con la URL
   del sitio (y `http://localhost:3000` para desarrollo).

---

## 8. `server/` (viejo)

`server/` guarda la versión anterior (Fastify, migraciones sueltas, 5 suites de
tests, login por WhatsApp). Se conserva como referencia hasta validar la v2.
Cuando ya no haga falta, se puede borrar: la app no lo usa.
