const express = require('express');
const { sql, getSqlPool } = require('../config/sql');
const { getContainers, databaseId, containerNames } = require('../config/cosmos');
const { requireAuth } = require('../middleware/auth');
const { buildRealtimeSnapshot, emitDashboardUpdate } = require('../services/realtime');
const { calculateUserChurnScore, TIPOS_ORDEN } = require('../utils/metrics');

const router = express.Router();

const CANONICAL_PLATFORMS = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  'twitter/x': 'Twitter/X',
  twitter: 'Twitter/X',
  x: 'Twitter/X',
  telegram: 'Telegram',
  discord: 'Discord'
};

function normalizePlatform(value) {
  if (!value || typeof value !== 'string') return null;
  const clean = value.trim();
  return CANONICAL_PLATFORMS[clean.toLowerCase()] || clean;
}

function normalizeEtiquetas(input) {
  if (!input) return [];
  if (Array.isArray(input)) {
    return [...new Set(input.map((t) => String(t).trim().toLowerCase()).filter(Boolean))];
  }
  if (typeof input === 'string') {
    return [...new Set(input.split(/[|,;]/).map((t) => t.trim().toLowerCase()).filter(Boolean))];
  }
  return [];
}

function enforceUserPrivacy(userRow) {
  if (!userRow) return null;
  const noConsent = String(userRow.consentimiento_datos || '').trim().toLowerCase() === 'no';
  return {
    ...userRow,
    pais: noConsent ? null : userRow.pais,
    estado: noConsent ? null : userRow.estado,
    ciudad: noConsent ? null : userRow.ciudad,
    latitud: noConsent ? null : userRow.latitud,
    longitud: noConsent ? null : userRow.longitud,
    zona_horaria: noConsent ? null : userRow.zona_horaria
  };
}

// =========================================================
// HEALTHCHECK PÚBLICO (AZURE SQL + COSMOS DB)
// =========================================================
router.get('/health', async (_req, res) => {
  try {
    const pool = await getSqlPool();
    const containers = getContainers();

    const [sqlCheck, cosmosInterCheck] = await Promise.all([
      pool.request().query('SELECT COUNT(*) AS totalUsuarios FROM dbo.usuarios'),
      containers.interacciones.items.query('SELECT VALUE COUNT(1) FROM c').fetchAll()
    ]);

    return res.status(200).json({
      ok: true,
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {
        azureSql: {
          connected: true,
          database: process.env.SQL_DATABASE,
          usuariosCount: sqlCheck.recordset[0]?.totalUsuarios ?? 0
        },
        azureCosmosDb: {
          connected: true,
          database: databaseId,
          containers: containerNames,
          interaccionesCount: cosmosInterCheck.resources[0] ?? 0
        }
      }
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      status: 'unhealthy',
      error: err.message
    });
  }
});

// Todos los endpoints siguientes requieren Bearer JWT válido
router.use(requireAuth);

// =========================================================
// ANALÍTICA EN TIEMPO REAL (SNAPSHOT)
// =========================================================
router.get('/analytics/realtime', async (_req, res) => {
  try {
    const snapshot = await buildRealtimeSnapshot();
    return res.status(200).json({
      ok: true,
      ...snapshot
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: 'Error al calcular indicadores en tiempo real.',
      detail: err.message
    });
  }
});

// =========================================================
// ANALÍTICA HISTÓRICA HÍBRIDA (AZURE SQL + COSMOS DB)
// =========================================================
router.get('/analytics/historical', async (_req, res) => {
  try {
    const pool = await getSqlPool();
    const containers = getContainers();

    const [
      platEstatusRes,
      topInteresesRes,
      topEtiquetasSqlRes,
      riesgoUsersRes,
      privacidadRes,
      cosmosInterRes,
      cosmosCuarentenaRes,
      cosmosBitacoraRes
    ] = await Promise.all([
      pool.request().query(`
        SELECT
          plataforma_principal AS plataforma,
          estatus,
          COUNT(*) AS total
        FROM dbo.usuarios
        GROUP BY plataforma_principal, estatus
        ORDER BY plataforma_principal, estatus
      `),
      pool.request().query(`
        SELECT
          ui.interes,
          COUNT(DISTINCT ui.id_usuario) AS totalUsuarios,
          ROUND(AVG(u.sentimiento_promedio), 3) AS sentimientoPromedio,
          SUM(CASE WHEN u.estatus = 'activo' THEN 1 ELSE 0 END) AS activos,
          SUM(CASE WHEN u.estatus = 'en_riesgo' THEN 1 ELSE 0 END) AS enRiesgo
        FROM dbo.usuario_intereses ui
        INNER JOIN dbo.usuarios u ON u.id_usuario = ui.id_usuario
        WHERE ui.tipo_interes = 'principal'
        GROUP BY ui.interes
        ORDER BY totalUsuarios DESC
      `),
      pool.request().query(`
        SELECT
          ui.interes AS etiqueta,
          COUNT(DISTINCT ui.id_usuario) AS usuariosUnicos
        FROM dbo.usuario_intereses ui
        WHERE ui.tipo_interes = 'etiqueta_interaccion'
        GROUP BY ui.interes
        ORDER BY usuariosUnicos DESC
      `),
      pool.request().query(`
        SELECT TOP 40
          id_usuario, alias, plataforma_principal, interes_principal,
          mensajes_30d, reacciones_30d, eventos_asistidos,
          sentimiento_promedio, ultima_actividad, estatus, consentimiento_datos,
          pais, ciudad
        FROM dbo.usuarios
        WHERE estatus IN ('en_riesgo', 'inactivo')
        ORDER BY
          CASE WHEN estatus = 'en_riesgo' THEN 0 ELSE 1 END,
          mensajes_30d ASC,
          sentimiento_promedio ASC
      `),
      pool.request().query(`
        SELECT
          consentimiento_datos AS consentimiento,
          COUNT(*) AS total,
          SUM(CASE WHEN ciudad IS NULL AND latitud IS NULL AND longitud IS NULL THEN 1 ELSE 0 END) AS sinDatosUbicacion
        FROM dbo.usuarios
        GROUP BY consentimiento_datos
      `),
      containers.interacciones.items
        .query('SELECT c.tema, c.sentimiento, c.etiquetas, c.dispositivo FROM c')
        .fetchAll(),
      containers.cuarentena.items
        .query('SELECT c.origen, c.motivo_rechazo FROM c')
        .fetchAll(),
      containers.bitacora.items
        .query('SELECT TOP 5 * FROM c ORDER BY c.fecha_proceso DESC')
        .fetchAll()
    ]);

    const refTime = new Date('2026-11-19T00:00:00Z').getTime();
    const usuariosEnRiesgo = riesgoUsersRes.recordset
      .map((u) => {
        const cleanUser = enforceUserPrivacy(u);
        return {
          ...cleanUser,
          indice_riesgo: calculateUserChurnScore(cleanUser, refTime)
        };
      })
      .sort((a, b) => b.indice_riesgo - a.indice_riesgo)
      .slice(0, 25);

    const temasMap = {};
    const etiquetasCosmosMap = {};
    for (const doc of cosmosInterRes.resources || []) {
      const t = doc.tema || 'general';
      if (!temasMap[t]) {
        temasMap[t] = { tema: t, total: 0, sumaSentimiento: 0 };
      }
      temasMap[t].total += 1;
      temasMap[t].sumaSentimiento += Number(doc.sentimiento || 0);

      if (Array.isArray(doc.etiquetas)) {
        for (const tag of doc.etiquetas) {
          etiquetasCosmosMap[tag] = (etiquetasCosmosMap[tag] || 0) + 1;
        }
      }
    }

    const topTemasCosmos = Object.values(temasMap)
      .map((item) => ({
        tema: item.tema,
        total: item.total,
        sentimientoPromedio: item.total > 0 ? Number((item.sumaSentimiento / item.total).toFixed(3)) : 0
      }))
      .sort((a, b) => b.total - a.total);

    const topEtiquetasCosmos = Object.entries(etiquetasCosmosMap)
      .map(([etiqueta, total]) => ({ etiqueta, total }))
      .sort((a, b) => b.total - a.total);

    const cuarentenaMotivos = {};
    const cuarentenaOrigenes = {};
    const cuarentenaItems = cosmosCuarentenaRes.resources || [];
    for (const q of cuarentenaItems) {
      const m = q.motivo_rechazo || 'OTRO';
      const o = q.origen || 'desconocido';
      cuarentenaMotivos[m] = (cuarentenaMotivos[m] || 0) + 1;
      cuarentenaOrigenes[o] = (cuarentenaOrigenes[o] || 0) + 1;
    }

    const ultimaBitacora = (cosmosBitacoraRes.resources || [])[0] || null;

    return res.status(200).json({
      ok: true,
      timestamp: new Date().toISOString(),
      usuariosPorPlataformaEstado: platEstatusRes.recordset,
      topIntereses: topInteresesRes.recordset,
      topEtiquetasSql: topEtiquetasSqlRes.recordset,
      topTemasCosmos,
      topEtiquetasCosmos,
      usuariosEnRiesgo,
      privacidadResumen: privacidadRes.recordset,
      calidadEtl: {
        totalEnCuarentena: cuarentenaItems.length,
        porMotivo: cuarentenaMotivos,
        porOrigen: cuarentenaOrigenes,
        ultimaEjecucion: ultimaBitacora,
        historialBitacora: cosmosBitacoraRes.resources || []
      }
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: 'Error al consultar analítica histórica híbrida.',
      detail: err.message
    });
  }
});

// =========================================================
// LISTADO DE USUARIOS (AZURE SQL - RESPETANDO ANONIMIZACIÓN)
// =========================================================
router.get('/usuarios', async (req, res) => {
  try {
    const limit = Math.min(200, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
    const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
    const estatus = req.query.estatus ? String(req.query.estatus).trim().toLowerCase() : null;
    const plataforma = req.query.plataforma ? normalizePlatform(String(req.query.plataforma)) : null;
    const search = req.query.search ? String(req.query.search).trim() : null;

    const pool = await getSqlPool();
    const request = pool
      .request()
      .input('limit', sql.Int, limit)
      .input('offset', sql.Int, offset);

    const conditions = [];
    if (estatus) {
      request.input('estatus', sql.VarChar(30), estatus);
      conditions.push('estatus = @estatus');
    }
    if (plataforma) {
      request.input('plataforma', sql.NVarChar(50), plataforma);
      conditions.push('plataforma_principal = @plataforma');
    }
    if (search) {
      request.input('search', sql.NVarChar(100), `%${search}%`);
      conditions.push('(id_usuario LIKE @search OR alias LIKE @search)');
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const queryResult = await request.query(`
      SELECT
        id_usuario, alias, fecha_ingreso, pais, estado, ciudad, latitud, longitud,
        zona_horaria, rango_edad, especie_fursona, interes_principal, plataforma_principal,
        es_artista, mensajes_30d, reacciones_30d, eventos_asistidos, comisiones_compradas,
        sentimiento_promedio, ultima_actividad, estatus, consentimiento_datos
      FROM dbo.usuarios
      ${whereClause}
      ORDER BY id_usuario ASC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY;

      SELECT COUNT(*) AS total FROM dbo.usuarios ${whereClause};
    `);

    const usuarios = (queryResult.recordsets[0] || []).map(enforceUserPrivacy);
    const total = queryResult.recordsets[1]?.[0]?.total ?? usuarios.length;

    return res.status(200).json({
      ok: true,
      total,
      limit,
      offset,
      usuarios
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: 'Error al consultar listado de usuarios en Azure SQL.',
      detail: err.message
    });
  }
});

// =========================================================
// VISTA 360 HÍBRIDA EN PARALELO (AZURE SQL + COSMOS DB)
// =========================================================
router.get('/usuarios/:id_usuario/vista-360', async (req, res) => {
  try {
    const idUsuario = String(req.params.id_usuario || '').trim().toUpperCase();
    if (!idUsuario) {
      return res.status(400).json({
        ok: false,
        error: 'Se requiere un id_usuario válido.'
      });
    }

    const pool = await getSqlPool();
    const containers = getContainers();

    const [sqlUserRes, sqlInteresesRes, cosmosInterRes] = await Promise.all([
      pool
        .request()
        .input('id_usuario', sql.VarChar(20), idUsuario)
        .query('SELECT * FROM dbo.usuarios WHERE id_usuario = @id_usuario'),
      pool
        .request()
        .input('id_usuario', sql.VarChar(20), idUsuario)
        .query('SELECT interes, tipo_interes FROM dbo.usuario_intereses WHERE id_usuario = @id_usuario ORDER BY tipo_interes DESC, interes ASC'),
      containers.interacciones.items
        .query(
          {
            query: 'SELECT * FROM c WHERE c.id_usuario = @id_usuario ORDER BY c.timestamp DESC',
            parameters: [{ name: '@id_usuario', value: idUsuario }]
          },
          { partitionKey: idUsuario }
        )
        .fetchAll()
    ]);

    if (sqlUserRes.recordset.length === 0) {
      return res.status(404).json({
        ok: false,
        error: `El usuario ${idUsuario} no existe en Azure SQL Database.`
      });
    }

    const perfil = enforceUserPrivacy(sqlUserRes.recordset[0]);
    const intereses = sqlInteresesRes.recordset;
    const interacciones = cosmosInterRes.resources || [];

    const canalesUsados = {};
    const tiposRealizados = {};
    let sumaSentimiento = 0;

    for (const item of interacciones) {
      canalesUsados[item.canal] = (canalesUsados[item.canal] || 0) + 1;
      tiposRealizados[item.tipo] = (tiposRealizados[item.tipo] || 0) + 1;
      sumaSentimiento += Number(item.sentimiento || 0);
    }

    const refTime = new Date('2026-11-19T00:00:00Z').getTime();

    return res.status(200).json({
      ok: true,
      id_usuario: idUsuario,
      perfil_relacional: {
        ...perfil,
        indice_riesgo_abandono: calculateUserChurnScore(perfil, refTime),
        privacidad_aplicada: String(perfil.consentimiento_datos).toLowerCase() === 'no'
      },
      intereses_normalizados: intereses,
      actividad_documental_cosmos: {
        total_interacciones: interacciones.length,
        sentimiento_promedio_cosmos:
          interacciones.length > 0 ? Number((sumaSentimiento / interacciones.length).toFixed(3)) : null,
        distribucion_canales: canalesUsados,
        distribucion_tipos: tiposRealizados,
        historial: interacciones
      }
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: 'Error al construir la Vista 360 híbrida del usuario.',
      detail: err.message
    });
  }
});

// =========================================================
// CRUD DE INTERACCIONES EN COSMOS DB + WEBSOCKET REALTIME
// =========================================================
router.get('/interacciones', async (req, res) => {
  try {
    const limit = Math.min(200, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
    const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);

    const conditions = [];
    const parameters = [];

    if (req.query.id_usuario) {
      conditions.push('c.id_usuario = @id_usuario');
      parameters.push({ name: '@id_usuario', value: String(req.query.id_usuario).trim().toUpperCase() });
    }
    if (req.query.canal) {
      conditions.push('c.canal = @canal');
      parameters.push({ name: '@canal', value: normalizePlatform(String(req.query.canal)) });
    }
    if (req.query.tipo) {
      conditions.push('c.tipo = @tipo');
      parameters.push({ name: '@tipo', value: String(req.query.tipo).trim().toLowerCase() });
    }
    if (req.query.tema) {
      conditions.push('c.tema = @tema');
      parameters.push({ name: '@tema', value: String(req.query.tema).trim().toLowerCase() });
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const containers = getContainers();

    const [itemsRes, countRes] = await Promise.all([
      containers.interacciones.items
        .query({
          query: `SELECT * FROM c ${whereClause} ORDER BY c.timestamp DESC OFFSET ${offset} LIMIT ${limit}`,
          parameters
        })
        .fetchAll(),
      containers.interacciones.items
        .query({
          query: `SELECT VALUE COUNT(1) FROM c ${whereClause}`,
          parameters
        })
        .fetchAll()
    ]);

    return res.status(200).json({
      ok: true,
      total: countRes.resources[0] ?? 0,
      limit,
      offset,
      interacciones: itemsRes.resources || []
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: 'Error al consultar interacciones en Cosmos DB.',
      detail: err.message
    });
  }
});

router.post('/interacciones', async (req, res) => {
  try {
    const body = req.body || {};
    const id_usuario = String(body.id_usuario || '').trim().toUpperCase();
    const canal = normalizePlatform(body.canal || body.plataforma);
    const tipo = String(body.tipo || '').trim().toLowerCase();
    const tema = String(body.tema || 'general').trim().toLowerCase();
    const texto = body.texto !== undefined && body.texto !== null ? String(body.texto).trim() : '';
    const sentimiento = body.sentimiento !== undefined ? Number.parseFloat(body.sentimiento) : 0;
    const reacciones_recibidas =
      body.reacciones_recibidas !== undefined ? Number.parseInt(body.reacciones_recibidas, 10) : 0;

    if (!id_usuario || !/^U\d+$/i.test(id_usuario)) {
      return res.status(400).json({
        ok: false,
        error: 'El campo id_usuario es obligatorio y debe tener formato válido (ej. U000001).'
      });
    }

    if (!canal || !tipo || !TIPOS_ORDEN.includes(tipo) || !tema) {
      return res.status(400).json({
        ok: false,
        error: `Campos obligatorios inválidos. canal requerido y tipo debe ser uno de: ${TIPOS_ORDEN.join(', ')}.`
      });
    }

    if (tipo !== 'reaccion' && texto.length === 0) {
      return res.status(400).json({
        ok: false,
        error: `El campo texto es obligatorio cuando el tipo de interacción es '${tipo}'.`
      });
    }

    if (Number.isNaN(sentimiento) || sentimiento < -1 || sentimiento > 1) {
      return res.status(400).json({
        ok: false,
        error: 'El campo sentimiento debe ser un número entre -1.0 y 1.0.'
      });
    }

    if (Number.isNaN(reacciones_recibidas) || reacciones_recibidas < 0) {
      return res.status(400).json({
        ok: false,
        error: 'El campo reacciones_recibidas debe ser un entero mayor o igual a 0.'
      });
    }

    // Verificar integridad referencial contra Azure SQL
    const pool = await getSqlPool();
    const userRes = await pool
      .request()
      .input('id_usuario', sql.VarChar(20), id_usuario)
      .query('SELECT id_usuario, consentimiento_datos, pais, estado, ciudad FROM dbo.usuarios WHERE id_usuario = @id_usuario');

    if (userRes.recordset.length === 0) {
      return res.status(404).json({
        ok: false,
        error: `Integridad referencial fallida: el usuario ${id_usuario} no existe en Azure SQL Database.`
      });
    }

    const sqlUser = userRes.recordset[0];
    const noConsent = String(sqlUser.consentimiento_datos || '').trim().toLowerCase() === 'no';

    const containers = getContainers();
    const customId = body.id_interaccion || body.id ? String(body.id_interaccion || body.id).trim().toUpperCase() : null;

    if (customId) {
      const existingCheck = await containers.interacciones.items
        .query({
          query: 'SELECT c.id FROM c WHERE c.id = @id OR c.id_interaccion = @id',
          parameters: [{ name: '@id', value: customId }]
        })
        .fetchAll();

      if (existingCheck.resources.length > 0) {
        return res.status(409).json({
          ok: false,
          error: `Conflicto: la interacción ${customId} ya existe en Azure Cosmos DB.`
        });
      }
    }

    const id_interaccion = customId || `I${Date.now().toString().slice(-7)}`;
    const timestamp = body.timestamp ? new Date(body.timestamp).toISOString().replace(/\.\d{3}Z$/, 'Z') : new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

    const newInteraction = {
      id: id_interaccion,
      id_interaccion,
      id_usuario,
      timestamp,
      canal,
      tipo,
      texto,
      tema,
      sentimiento: Number(sentimiento.toFixed(4)),
      idioma: String(body.idioma || 'es').trim().toLowerCase(),
      pais: noConsent ? null : (body.pais ?? sqlUser.pais ?? null),
      estado: noConsent ? null : (body.estado ?? sqlUser.estado ?? null),
      ciudad: noConsent ? null : (body.ciudad ?? sqlUser.ciudad ?? null),
      dispositivo: String(body.dispositivo || 'Web').trim(),
      longitud_texto: texto.length,
      reacciones_recibidas,
      etiquetas: normalizeEtiquetas(body.etiquetas)
    };

    await containers.interacciones.items.create(newInteraction);

    const snapshot = await emitDashboardUpdate({
      operacion: 'POST',
      id_interaccion,
      id_usuario,
      canal,
      tipo,
      tema,
      timestamp: new Date().toISOString()
    });

    return res.status(201).json({
      ok: true,
      message: 'Interacción creada en Cosmos DB y propagada en tiempo real.',
      interaccion: newInteraction,
      kpisActualizados: snapshot.kpis
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: 'Error al crear interacción en Cosmos DB.',
      detail: err.message
    });
  }
});

router.put('/interacciones/:id', async (req, res) => {
  try {
    const targetId = String(req.params.id || '').trim().toUpperCase();
    const body = req.body || {};
    const containers = getContainers();

    const foundRes = await containers.interacciones.items
      .query({
        query: 'SELECT * FROM c WHERE c.id = @id OR c.id_interaccion = @id',
        parameters: [{ name: '@id', value: targetId }]
      })
      .fetchAll();

    if (foundRes.resources.length === 0) {
      return res.status(404).json({
        ok: false,
        error: `La interacción ${targetId} no existe en Cosmos DB.`
      });
    }

    const currentDoc = foundRes.resources[0];
    const nextCanal = body.canal !== undefined ? normalizePlatform(body.canal) : currentDoc.canal;
    const nextTipo = body.tipo !== undefined ? String(body.tipo).trim().toLowerCase() : currentDoc.tipo;
    const nextTema = body.tema !== undefined ? String(body.tema).trim().toLowerCase() : currentDoc.tema;
    const nextTexto = body.texto !== undefined ? String(body.texto).trim() : currentDoc.texto;
    const nextSentimiento =
      body.sentimiento !== undefined ? Number.parseFloat(body.sentimiento) : currentDoc.sentimiento;
    const nextReacciones =
      body.reacciones_recibidas !== undefined
        ? Number.parseInt(body.reacciones_recibidas, 10)
        : currentDoc.reacciones_recibidas;

    if (!nextCanal || !nextTipo || !TIPOS_ORDEN.includes(nextTipo) || !nextTema) {
      return res.status(400).json({
        ok: false,
        error: `Datos de actualización inválidos. tipo debe ser uno de: ${TIPOS_ORDEN.join(', ')}.`
      });
    }

    if (nextTipo !== 'reaccion' && (!nextTexto || nextTexto.length === 0)) {
      return res.status(400).json({
        ok: false,
        error: `El campo texto no puede quedar vacío para el tipo '${nextTipo}'.`
      });
    }

    if (Number.isNaN(nextSentimiento) || nextSentimiento < -1 || nextSentimiento > 1) {
      return res.status(400).json({
        ok: false,
        error: 'El sentimiento debe estar entre -1.0 y 1.0.'
      });
    }

    if (Number.isNaN(nextReacciones) || nextReacciones < 0) {
      return res.status(400).json({
        ok: false,
        error: 'reacciones_recibidas debe ser un entero >= 0.'
      });
    }

    const updatedDoc = {
      ...currentDoc,
      canal: nextCanal,
      tipo: nextTipo,
      tema: nextTema,
      texto: nextTexto,
      longitud_texto: nextTexto.length,
      sentimiento: Number(nextSentimiento.toFixed(4)),
      reacciones_recibidas: nextReacciones,
      dispositivo: body.dispositivo !== undefined ? String(body.dispositivo).trim() : currentDoc.dispositivo,
      etiquetas: body.etiquetas !== undefined ? normalizeEtiquetas(body.etiquetas) : currentDoc.etiquetas,
      updated_at: new Date().toISOString()
    };

    await containers.interacciones.items.upsert(updatedDoc);

    const snapshot = await emitDashboardUpdate({
      operacion: 'PUT',
      id_interaccion: updatedDoc.id_interaccion,
      id_usuario: updatedDoc.id_usuario,
      canal: updatedDoc.canal,
      tipo: updatedDoc.tipo,
      tema: updatedDoc.tema,
      timestamp: new Date().toISOString()
    });

    return res.status(200).json({
      ok: true,
      message: 'Interacción actualizada en Cosmos DB y propagada por WebSocket.',
      interaccion: updatedDoc,
      kpisActualizados: snapshot.kpis
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: 'Error al actualizar interacción en Cosmos DB.',
      detail: err.message
    });
  }
});

router.delete('/interacciones/:id', async (req, res) => {
  try {
    const targetId = String(req.params.id || '').trim().toUpperCase();
    const containers = getContainers();

    const foundRes = await containers.interacciones.items
      .query({
        query: 'SELECT * FROM c WHERE c.id = @id OR c.id_interaccion = @id',
        parameters: [{ name: '@id', value: targetId }]
      })
      .fetchAll();

    if (foundRes.resources.length === 0) {
      return res.status(404).json({
        ok: false,
        error: `La interacción ${targetId} no existe en Cosmos DB.`
      });
    }

    const doc = foundRes.resources[0];
    await containers.interacciones.item(doc.id, doc.id_usuario).delete();

    const snapshot = await emitDashboardUpdate({
      operacion: 'DELETE',
      id_interaccion: doc.id_interaccion,
      id_usuario: doc.id_usuario,
      canal: doc.canal,
      tipo: doc.tipo,
      tema: doc.tema,
      timestamp: new Date().toISOString()
    });

    return res.status(200).json({
      ok: true,
      message: `Interacción ${doc.id_interaccion} eliminada de Cosmos DB y propagada por WebSocket.`,
      eliminada: {
        id_interaccion: doc.id_interaccion,
        id_usuario: doc.id_usuario,
        canal: doc.canal,
        tipo: doc.tipo
      },
      kpisActualizados: snapshot.kpis
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: 'Error al eliminar interacción en Cosmos DB.',
      detail: err.message
    });
  }
});

// =========================================================
// CUARENTENA Y BITÁCORA ETL (COSMOS DB)
// =========================================================
router.get('/cuarentena', async (req, res) => {
  try {
    const limit = Math.min(200, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
    const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
    const motivo = req.query.motivo ? String(req.query.motivo).trim() : null;
    const origen = req.query.origen ? String(req.query.origen).trim() : null;

    const conditions = [];
    const parameters = [];

    if (motivo) {
      conditions.push('c.motivo_rechazo = @motivo');
      parameters.push({ name: '@motivo', value: motivo });
    }
    if (origen) {
      conditions.push('c.origen = @origen');
      parameters.push({ name: '@origen', value: origen });
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const containers = getContainers();

    const [itemsRes, countRes] = await Promise.all([
      containers.cuarentena.items
        .query({
          query: `SELECT * FROM c ${whereClause} OFFSET ${offset} LIMIT ${limit}`,
          parameters
        })
        .fetchAll(),
      containers.cuarentena.items
        .query({
          query: `SELECT VALUE COUNT(1) FROM c ${whereClause}`,
          parameters
        })
        .fetchAll()
    ]);

    return res.status(200).json({
      ok: true,
      total: countRes.resources[0] ?? 0,
      limit,
      offset,
      registros: itemsRes.resources || []
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: 'Error al consultar contenedor de cuarentena en Cosmos DB.',
      detail: err.message
    });
  }
});

router.get('/bitacora', async (_req, res) => {
  try {
    const containers = getContainers();
    const result = await containers.bitacora.items
      .query('SELECT * FROM c ORDER BY c.fecha_proceso DESC')
      .fetchAll();

    return res.status(200).json({
      ok: true,
      total: (result.resources || []).length,
      ejecuciones: result.resources || []
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: 'Error al consultar bitácora ETL en Cosmos DB.',
      detail: err.message
    });
  }
});

module.exports = router;
