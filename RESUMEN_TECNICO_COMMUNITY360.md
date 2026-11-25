# Resumen Técnico Exacto y Verificado — Community 360

---

## 1. Stack tecnológico final

- **Dependencias reales en `package.json` (CommonJS / Node.js):**
  - **Backend / Servidor HTTP:** `express` (`^4.21.1`), `dotenv` (`^16.4.5`) y módulo nativo `http`.
  - **Bases de datos híbridas en la nube:**
    - **Relacional:** `mssql` (`^11.0.1`) conectado a **Azure SQL Database** (`src/config/sql.js`).
    - **NoSQL Documental:** `@azure/cosmos` (`^4.1.1`) conectado a **Azure Cosmos DB for NoSQL (Serverless)** (`src/config/cosmos.js`).
  - **Pipeline ETL / Procesamiento CSV:** `csv-parse` (`^5.5.6`) y `csv-stringify` (`^6.5.1`) en `src/etl/runEtl.js`.
  - **Autenticación y Seguridad:** `bcryptjs` (`^2.4.3`) y `jsonwebtoken` (`^9.0.2`).
  - **Tiempo Real (WebSockets):** `socket.io` (`^4.8.1`).
  - **Frontend (`public/`):** **HTML5, CSS3 y JavaScript Vanilla (puro)** servido estáticamente por Express desde `public/` (`public/index.html`, `public/css/styles.css`, `public/js/app.js`), sin frameworks como React, Vue o Angular.
    - **Librería de gráficas:** **Apache ECharts `5.5.1`** cargada por CDN (`https://cdn.jsdelivr.net/npm/echarts@5.5.1/dist/echarts.min.js`).
    - **Cliente WebSockets:** Cliente oficial servido por el propio servidor en `/socket.io/socket.io.js`.
- **Archivos de configuración de despliegue:**
  - **No existen** archivos de despliegue adicionales (`Dockerfile`, `vercel.json`, `render.yaml`, `azure-pipelines.yml`, `Procfile`, etc.). Únicamente existen `package.json` (con `"start": "node src/server.js"` y `"PORT"` configurable por variable de entorno), `.env`, `.env.example` y `.gitignore`.

---

## 2. Inventario exacto de la API REST

Existen exactamente **14 endpoints REST** divididos entre `src/routes/auth.js` (3 endpoints bajo `/api/auth`) y `src/routes/api.js` (11 endpoints bajo `/api`):

| # | Método | Ruta Exacta | ¿Requiere Auth JWT? | Qué hace | Base de Datos que Consulta / Modifica | ¿Dispara WebSocket? |
| :-: | :---: | :--- | :---: | :--- | :--- | :---: |
| **1** | `POST` | `/api/auth/login` | **No** | Valida credenciales de administrador con `bcryptjs.compare` y firma un token JWT por `12h`. | **Azure SQL** (`SELECT` en `dbo.admins`) | No |
| **2** | `POST` | `/api/auth/logout` | **Sí** (`Bearer`) | Revoca el JWT actual agregándolo al `Set` en memoria `revokedTokens`. | En memoria (`src/middleware/auth.js`) | No |
| **3** | `GET` | `/api/auth/me` | **Sí** (`Bearer`) | Verifica la sesión activa y devuelve `{ id, email, rol }` decodificados del JWT. | Ninguna (valida firma JWT y `revokedTokens`) | No |
| **4** | `GET` | `/api/health` | **No** | Verifica conectividad real y conteo de registros en ambos motores de Azure. | **Híbrido:** **Azure SQL** (`dbo.usuarios`) + **Cosmos DB** (`interacciones`) | No |
| **5** | `GET` | `/api/analytics/realtime` | **Sí** (`Bearer`) | Calcula y devuelve el snapshot actual de KPIs matemáticos, series para las 3 gráficas en vivo y las 8 interacciones más recientes. | **Híbrido:** **Azure SQL** (`dbo.usuarios`) + **Cosmos DB** (`interacciones`) | No |
| **6** | `GET` | `/api/analytics/historical` | **Sí** (`Bearer`) | Devuelve analítica histórica completa: usuarios por plataforma/estatus, top intereses y etiquetas SQL, top temas/etiquetas Cosmos, top 25 usuarios en riesgo con score de abandono, resumen de privacidad y métricas de cuarentena/bitácora ETL. | **Híbrido:** **Azure SQL** (`dbo.usuarios`, `dbo.usuario_intereses`) + **Cosmos DB** (`interacciones`, `cuarentena`, `bitacora_etl`) | No |
| **7** | `GET` | `/api/usuarios` | **Sí** (`Bearer`) | Lista usuarios paginados y filtrables (`limit`, `offset`, `estatus`, `plataforma`, `search`) aplicando anonimización geográfica si `consentimiento_datos = 'no'`. | **Azure SQL** (`dbo.usuarios`) | No |
| **8** | `GET` | `/api/usuarios/:id_usuario/vista-360` | **Sí** (`Bearer`) | Construye la Vista 360° en paralelo (`Promise.all`): perfil relacional + score de riesgo + intereses normalizados + historial documental de interacciones del usuario. | **Híbrido:** **Azure SQL** (`dbo.usuarios`, `dbo.usuario_intereses`) + **Cosmos DB** (`interacciones` por partition key `/id_usuario`) | No |
| **9** | `GET` | `/api/interacciones` | **Sí** (`Bearer`) | Lista interacciones paginadas y filtrables (`id_usuario`, `canal`, `tipo`, `tema`, `limit`, `offset`) ordenadas por `timestamp DESC`. | **Cosmos DB** (`interacciones`) | No |
| **10** | `POST` | `/api/interacciones` | **Sí** (`Bearer`) | Valida payload, verifica **integridad referencial** en Azure SQL (que `id_usuario` exista y su `consentimiento_datos`), verifica que no exista colisión `409`, crea el documento y recalcula métricas en vivo. | **Híbrido:** Consulta **Azure SQL** (`dbo.usuarios`) + Inserta en **Cosmos DB** (`interacciones`) | **Sí** (`dashboard:update` con `operacion: 'POST'`) |
| **11** | `PUT` | `/api/interacciones/:id` | **Sí** (`Bearer`) | Busca la interacción por `id`/`id_interaccion`, valida los campos modificados, ejecuta `upsert` del documento y recalcula métricas en vivo. | **Cosmos DB** (Modifica `interacciones` + lee **Azure SQL** en el recálculo del snapshot) | **Sí** (`dashboard:update` con `operacion: 'PUT'`) |
| **12** | `DELETE` | `/api/interacciones/:id` | **Sí** (`Bearer`) | Busca la interacción por `id`/`id_interaccion`, la elimina usando su `id` y partition key `id_usuario`, y recalcula métricas en vivo. | **Cosmos DB** (Elimina en `interacciones` + lee **Azure SQL** en el recálculo del snapshot) | **Sí** (`dashboard:update` con `operacion: 'DELETE'`) |
| **13** | `GET` | `/api/cuarentena` | **Sí** (`Bearer`) | Consulta paginada y filtrable (`motivo`, `origen`, `limit`, `offset`) de registros rechazados durante el ETL. | **Cosmos DB** (`cuarentena`) | No |
| **14** | `GET` | `/api/bitacora` | **Sí** (`Bearer`) | Lista todas las ejecuciones históricas del pipeline ETL ordenadas por `fecha_proceso DESC`. | **Cosmos DB** (`bitacora_etl`) | No |

---

## 3. Arquitectura de consumo (REST vs WebSockets)

### Eventos de WebSocket (`src/services/realtime.js` y `public/js/app.js`)
- **Handshake autenticado:** El servidor intercepta la conexión con `io.use(...)` exigiendo el mismo JWT (`socket.handshake.auth.token`, header `Authorization` o `query.token`). Si falla, rechaza la conexión con `UNAUTHORIZED_WEBSOCKET_NO_TOKEN` o `UNAUTHORIZED_WEBSOCKET_INVALID_TOKEN`.
- **Eventos emitidos por el servidor:**
  1. `dashboard:update`: Emitido al cliente recién conectado (`operacion: 'CONNECTED'`) y en broadcast global (`io.emit`) tras cada `POST`, `PUT` o `DELETE` exitoso sobre `/api/interacciones`. Envía `{ timestamp, kpis, series, recentInteractions, evento }`.
  2. `dashboard:error`: Emitido al socket individual si ocurre una excepción al construir el snapshot inicial al conectarse.
- **Eventos escuchados por el cliente (`public/js/app.js`):**
  - `connect`, `disconnect`, `connect_error` (actualizan la píldora de estado `#wsStatusPill` en la barra superior).
  - `dashboard:update` (invoca `updateRealtimeUI(snapshot)` que actualiza KPIs, el banner del último evento y las 3 gráficas de la Sección A sin recargar la página).

### Qué se alimenta por WebSockets vs. qué se alimenta por REST
- **Sección A — Alimentada en vivo por WebSockets (`dashboard:update`) + carga inicial `GET /api/analytics/realtime`:**
  - Píldora de estado de conexión WebSocket (`Conectado en Vivo` / `Desconectado`).
  - Banner/Log discreto del último evento recibido (`SNAPSHOT`, `CONNECTED`, `POST`, `PUT`, `DELETE`) con `id_interaccion`, `id_usuario`, `canal`, `tipo` y hora.
  - Las **6 tarjetas KPI principales**.
  - Las **3 gráficas dinámicas de Apache ECharts** (Barras por plataforma, Dona por tipo de interacción y Mapa de Calor plataforma vs. tipo).
- **Sección B — Alimentada por API REST (`fetch` con `Authorization: Bearer <token>`):**
  - `GET /api/analytics/historical`: Alimenta la gráfica de Top Intereses Normalizados, la gráfica apilada de Usuarios por Plataforma y Estatus, la Tabla de Usuarios en Riesgo de Abandono, las cajas de Resumen de Calidad ETL y el bloque comparativo de Privacidad (`ANTES` vs `DESPUÉS`).
  - `GET /api/cuarentena?limit=35`: Alimenta la tabla de inspección de registros en cuarentena.
  - `GET /api/usuarios/:id_usuario/vista-360`: Alimenta bajo demanda el módulo buscador de Vista 360° Híbrida (al buscar por input, pulsar los botones rápidos o hacer clic en cualquier fila de la tabla de usuarios en riesgo).

---

## 4. Métricas y visualizaciones del Dashboard

En `public/index.html` y `public/js/app.js` existen los siguientes componentes visuales (sin ningún formulario ni botón para crear, editar o borrar interacciones):

### A. 6 Tarjetas KPI en Tiempo Real (Sección A)
1. **Interacciones Válidas (Cosmos DB):** Total de documentos en `interacciones` + promedio de interacciones por usuario participante y promedio global.
2. **Tasa de Participación Activa:** Porcentaje `(usuariosActivos / totalUsuarios) * 100` + conteo de usuarios `activo` sobre el total del padrón en Azure SQL.
3. **Índice de Riesgo de Abandono:** Porcentaje `((usuariosEnRiesgo + usuariosInactivos) / totalUsuarios) * 100` + desglose de usuarios `en_riesgo` e `inactivo`.
4. **Usuarios con Interacción en Vivo:** Cantidad de `id_usuario` únicos con interacciones en Cosmos DB + porcentaje de cobertura directa sobre el padrón SQL.
5. **Sentimiento Promedio (Cosmos):** Promedio aritmético de `sentimiento` (`[-1, 1]`) de todas las interacciones + suma total de `reacciones_recibidas`.
6. **Padrón Relacional (Azure SQL):** Conteo total de usuarios en `dbo.usuarios` + relación global de interacciones por usuario.

### B. 5 Gráficas en Apache ECharts
1. **Gráfica de Barras Verticales en Vivo (`#chartRealtimeBars` - Sección A):** Total y porcentaje de interacciones por plataforma/canal (`Facebook`, `Instagram`, `TikTok`, `Twitter/X`, `Telegram`, `Discord`).
2. **Gráfica de Dona / Pie en Vivo (`#chartRealtimeDonut` - Sección A):** Distribución porcentual y absoluta por tipo de interacción (`comentario`, `mensaje`, `reaccion`, `respuesta_encuesta`, `rsvp_evento`).
3. **Mapa de Calor / Heatmap en Vivo (`#chartRealtimeHeatmap` - Sección A):** Matriz bidimensional `M[plataforma, tipo]` que cruza las 6 plataformas (eje X) contra los 5 tipos de interacción (eje Y) mostrando la intensidad exacta en cada celda.
4. **Gráfica de Barras Horizontales Histórica (`#chartHistoricalInterests` - Sección B):** Top 10 intereses principales normalizados consultados desde `dbo.usuario_intereses` en Azure SQL.
5. **Gráfica de Barras Apiladas Histórica (`#chartHistoricalPlatformStatus` - Sección B):** Cantidad de usuarios en Azure SQL por `plataforma_principal` segmentados en barras apiladas por `estatus` (`activo`, `en_riesgo`, `inactivo`).

### C. Módulos, Buscadores y Tablas (Sección B)
1. **Buscador de Vista 360° Híbrida (`#vista360Container`):** Input por `id_usuario` y 3 chips rápidos (`U000852`, `U000004`, `U000176`). Muestra dos paneles paralelos:
   - *Panel Izquierdo (Azure SQL):* Alias, plataforma, especie/rango de edad, índice individual de riesgo de abandono, actividad 30d, consentimiento, ubicación geográfica (o etiqueta de protección `NULL` si `consentimiento_datos = no`) y lista de intereses/etiquetas de `dbo.usuario_intereses`.
   - *Panel Derecho (Cosmos DB):* Tabla con el historial documental de interacciones del usuario (`id_interaccion`, `timestamp`, `canal`, `tipo`, `tema`, `sentimiento`, `etiquetas`).
2. **Tabla de Usuarios en Riesgo de Abandono (`#tableRiesgoBody`):** Top 25 usuarios con estatus `en_riesgo` o `inactivo` ordenados por su score matemático ponderado (`indice_riesgo`), mostrando ID, alias, plataforma, interés, estatus, actividad 30d, sentimiento y estado de ubicación/consentimiento. Al hacer clic en cualquier fila, carga su Vista 360°.
3. **Módulo de Resumen de Calidad ETL y Privacidad (`#etlSummaryMetrics` y `#privacyExampleBox`):** 6 cajas de conteo (`Total Recibidos`, `Total Aceptados`, `En Cuarentena`, `Usuarios Anonimizados`, `Intereses Normalizados SQL`, `Interacciones Huérfanas`) + comparativa JSON lado a lado (`ANTES` en el CSV crudo vs. `DESPUÉS` en Azure SQL) del usuario `U000004` con `consentimiento_datos = "no"`.
4. **Tabla e Inspección de Cuarentena (`#tableCuarentenaBody`):** Píldoras con conteo por `motivo_rechazo` y tabla con los registros en cuarentena (`id_registro`, `id_usuario`, `origen`, `motivo_rechazo`, `linea_csv`).

---

## 5. Autenticación y privacidad geográfica

- **Cómo funciona el Login (`src/routes/auth.js`):**
  - El endpoint `POST /api/auth/login` acepta el identificador en cualquiera de las propiedades `req.body.email`, `req.body.username` o `req.body.user` junto con `req.body.password`.
  - Consulta la tabla **`dbo.admins`** en **Azure SQL Database** (`SELECT id, email, password_hash, rol, created_at FROM dbo.admins WHERE email = @email`).
  - Verifica la contraseña con **`bcryptjs.compare(password, admin.password_hash)`**.
  - Si es válida, firma un **JWT** con `jsonwebtoken` usando `process.env.JWT_SECRET` y expiración de `12h`.
- **Protección de ubicación para `consentimiento_datos = 'no'` (Triple capa):**
  1. **En el ETL (`src/etl/runEtl.js`):** Antes de guardar en Azure SQL o exportar los CSV depurados, para todo usuario con `consentimiento_datos === 'no'` (171 usuarios) se asigna `null` a `pais`, `estado`, `ciudad`, `latitud`, `longitud` y `zona_horaria`. Asimismo, en sus interacciones en Cosmos DB (26 interacciones) se fuerza `pais = null`, `estado = null`, `ciudad = null`.
  2. **En la API REST (`src/routes/api.js`):** La función `enforceUserPrivacy(userRow)` vuelve a garantizar que cualquier lectura de usuarios (`/api/usuarios`, `/api/analytics/historical`, `/api/usuarios/:id_usuario/vista-360`) devuelva `null` en todos los campos geográficos si `consentimiento_datos` es `'no'`. Además, al crear una interacción en `POST /api/interacciones`, si el usuario en Azure SQL tiene `consentimiento_datos = 'no'`, ignora cualquier ubicación enviada en el body y guarda `pais: null, estado: null, ciudad: null`.
  3. **En el Dashboard (`public/js/app.js`):** Muestra explícitamente la etiqueta `ANONIMIZADO (consentimiento=no)` / `NULL (Ubicación protegida por consentimiento_datos = no)`.
- **Verificación de usuario para el docente (`lizandro.reyes` / `lizandro.reyes@utmetropolitana.edu.mx`):**
  - **No existe todavía** ningún script ni usuario creado para `lizandro.reyes` o `lizandro.reyes@utmetropolitana.edu.mx`. Actualmente en `src/scripts/initDb.js` y `.env` solo está configurado el administrador inicial `ADMIN_USER=admin@community360.com` (`ADMIN_PASSWORD=Admin360!2026`).

---

## 6. Ejemplos para 3 pruebas en vivo con Postman

> **Requisito previo en Postman:** Ejecutar `POST {{baseUrl}}/api/auth/login` para obtener el token JWT y enviarlo en las 3 peticiones con los headers:
> - `Authorization`: `Bearer {{token}}`
> - `Content-Type`: `application/json`

### Prueba 1 — Crear una nueva interacción (`POST`)
Inserta una interacción real en Cosmos DB para el usuario `U000001` (verificando primero su existencia en Azure SQL) y dispara el evento WebSocket `dashboard:update` con `operacion: "POST"`, incrementando en vivo el KPI de interacciones, la barra de `Discord`, la dona en `comentario` y la celda `[Discord, comentario]` del mapa de calor:
- **Método y Ruta:** `POST http://localhost:3000/api/interacciones`
- **Headers:**
  - `Authorization: Bearer {{token}}`
  - `Content-Type: application/json`
- **JSON Body:**
```json
{
  "id_interaccion": "I9900001",
  "id_usuario": "U000001",
  "canal": "Discord",
  "tipo": "comentario",
  "tema": "arte_comisiones",
  "texto": "Demostración en tiempo real desde Postman hacia Cosmos DB y WebSockets.",
  "sentimiento": 0.91,
  "dispositivo": "Escritorio",
  "reacciones_recibidas": 8,
  "etiquetas": ["arte", "evento", "comisiones"]
}
```

### Prueba 2 — Modificar la interacción existente (`PUT`)
Actualiza en Cosmos DB la interacción `I9900001` cambiándola del canal `Discord` a `Telegram`, del tipo `comentario` a `mensaje` y subiendo `reacciones_recibidas` a `25`. Dispara el evento WebSocket `dashboard:update` con `operacion: "PUT"`, recalculando al instante las barras, la dona, el mapa de calor y el KPI de reacciones sin recargar el navegador:
- **Método y Ruta:** `PUT http://localhost:3000/api/interacciones/I9900001`
- **Headers:**
  - `Authorization: Bearer {{token}}`
  - `Content-Type: application/json`
- **JSON Body:**
```json
{
  "canal": "Telegram",
  "tipo": "mensaje",
  "tema": "eventos_convenciones",
  "texto": "Interacción actualizada desde Postman con recálculo en vivo de Apache ECharts.",
  "sentimiento": 0.95,
  "reacciones_recibidas": 25,
  "etiquetas": ["evento", "aviso"]
}
```

### Prueba 3 — Eliminar la interacción (`DELETE`)
Elimina el documento `I9900001` de Cosmos DB usando su partition key `/id_usuario` y dispara el evento WebSocket `dashboard:update` con `operacion: "DELETE"`, regresando inmediatamente los KPIs y las 3 gráficas en vivo a su conteo original (`207` interacciones):
- **Método y Ruta:** `DELETE http://localhost:3000/api/interacciones/I9900001`
- **Headers:**
  - `Authorization: Bearer {{token}}`
- **Body:** *(Ninguno)*
