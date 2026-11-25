const PLATAFORMAS_ORDEN = ['Facebook', 'Instagram', 'TikTok', 'Twitter/X', 'Telegram', 'Discord'];
const TIPOS_ORDEN = ['comentario', 'mensaje', 'reaccion', 'respuesta_encuesta', 'rsvp_evento'];

/**
 * Calcula el Índice Individual de Riesgo de Abandono (Churn Score 0 - 100).
 * Fórmula ponderada:
 *   Score = 100 * (0.45 * FactorInactividad + 0.35 * FactorBajaActividad + 0.20 * FactorSentimientoNegativo)
 * Donde:
 *   - FactorInactividad = min(1, diasSinActividad / 120)
 *   - FactorBajaActividad = 1 / (1 + mensajes_30d + 0.5 * reacciones_30d + 2 * eventos_asistidos)
 *   - FactorSentimientoNegativo = (1 - sentimiento_promedio) / 2   (normalizado de [-1, 1] a [0, 1])
 */
function calculateUserChurnScore(user, referenceDateMs = Date.now()) {
  const lastActMs = user.ultima_actividad ? new Date(user.ultima_actividad).getTime() : referenceDateMs;
  const diffDays = Math.max(0, (referenceDateMs - lastActMs) / (1000 * 60 * 60 * 24));
  const factorInactividad = Math.min(1, diffDays / 120);

  const msg = Number(user.mensajes_30d || 0);
  const reac = Number(user.reacciones_30d || 0);
  const ev = Number(user.eventos_asistidos || 0);
  const factorBajaActividad = 1 / (1 + msg + 0.5 * reac + 2 * ev);

  const sent = Number(user.sentimiento_promedio || 0);
  const factorSentimiento = Math.min(1, Math.max(0, (1 - sent) / 2));

  const estatusBoost = user.estatus === 'inactivo' ? 15 : user.estatus === 'en_riesgo' ? 10 : 0;
  const rawScore = (0.45 * factorInactividad + 0.35 * factorBajaActividad + 0.20 * factorSentimiento) * 100 + estatusBoost;

  return Number(Math.min(100, Math.max(0, rawScore)).toFixed(2));
}

/**
 * Calcula los indicadores matemáticos en tiempo real a partir de los resúmenes de Azure SQL
 * y los documentos de interacciones reales en Azure Cosmos DB.
 *
 * 1. Tasa de Participación Activa (TPA):
 *    TPA = (Usuarios_Activos / Total_Usuarios) * 100
 *    Tasa_Interaccion_Directa = (Usuarios_Unicos_Con_Interaccion / Total_Usuarios) * 100
 *
 * 2. Índice de Riesgo de Abandono (IRA):
 *    IRA = ((Usuarios_En_Riesgo + Usuarios_Inactivos) / Total_Usuarios) * 100
 *    Tasa_En_Riesgo = (Usuarios_En_Riesgo / Total_Usuarios) * 100
 *
 * 3. Promedio de Interacciones por Usuario:
 *    Promedio_Global = Total_Interacciones / Total_Usuarios
 *    Promedio_Por_Participante = Total_Interacciones / Usuarios_Unicos_Con_Interaccion
 *
 * 4. Distribución por Plataforma y Tipo:
 *    Frecuencia absoluta (n_i) y relativa (p_i = (n_i / N) * 100)
 *
 * 5. Matriz de Intensidad Cruzada (Mapa de Calor):
 *    M[p, t] = conteo de interacciones en la plataforma p de tipo t,
 *    formateado como ternas [xIndex, yIndex, valor] para Apache ECharts.
 */
function computeRealtimeMetrics(sqlUserStats, interacciones) {
  const totalUsuarios = Number(sqlUserStats.totalUsuarios || 0);
  const usuariosActivos = Number(sqlUserStats.activos || 0);
  const usuariosEnRiesgo = Number(sqlUserStats.enRiesgo || 0);
  const usuariosInactivos = Number(sqlUserStats.inactivos || 0);

  const totalInteracciones = interacciones.length;
  const usuariosConInteraccionSet = new Set();

  let sumaSentimiento = 0;
  let totalReaccionesRecibidas = 0;

  const conteoPorPlataforma = {};
  const conteoPorTipo = {};
  const conteoPorTema = {};

  for (const p of PLATAFORMAS_ORDEN) conteoPorPlataforma[p] = 0;
  for (const t of TIPOS_ORDEN) conteoPorTipo[t] = 0;

  const matrixMap = {};
  for (let x = 0; x < PLATAFORMAS_ORDEN.length; x++) {
    for (let y = 0; y < TIPOS_ORDEN.length; y++) {
      matrixMap[`${x}:${y}`] = 0;
    }
  }

  for (const item of interacciones) {
    if (item.id_usuario) {
      usuariosConInteraccionSet.add(item.id_usuario);
    }

    const canal = item.canal || 'Otro';
    const tipo = (item.tipo || 'otro').toLowerCase();
    const tema = (item.tema || 'general').toLowerCase();

    conteoPorPlataforma[canal] = (conteoPorPlataforma[canal] || 0) + 1;
    conteoPorTipo[tipo] = (conteoPorTipo[tipo] || 0) + 1;
    conteoPorTema[tema] = (conteoPorTema[tema] || 0) + 1;

    sumaSentimiento += Number(item.sentimiento || 0);
    totalReaccionesRecibidas += Number(item.reacciones_recibidas || 0);

    const xIdx = PLATAFORMAS_ORDEN.indexOf(canal);
    const yIdx = TIPOS_ORDEN.indexOf(tipo);
    if (xIdx !== -1 && yIdx !== -1) {
      matrixMap[`${xIdx}:${yIdx}`] += 1;
    }
  }

  const usuariosUnicosActivosEnCosmos = usuariosConInteraccionSet.size;

  const tasaParticipacionActiva =
    totalUsuarios > 0 ? Number(((usuariosActivos / totalUsuarios) * 100).toFixed(2)) : 0;

  const tasaInteraccionDirecta =
    totalUsuarios > 0 ? Number(((usuariosUnicosActivosEnCosmos / totalUsuarios) * 100).toFixed(2)) : 0;

  const indiceRiesgoAbandono =
    totalUsuarios > 0
      ? Number((((usuariosEnRiesgo + usuariosInactivos) / totalUsuarios) * 100).toFixed(2))
      : 0;

  const porcentajeEnRiesgo =
    totalUsuarios > 0 ? Number(((usuariosEnRiesgo / totalUsuarios) * 100).toFixed(2)) : 0;

  const promedioInteraccionesGlobal =
    totalUsuarios > 0 ? Number((totalInteracciones / totalUsuarios).toFixed(2)) : 0;

  const promedioInteraccionesParticipante =
    usuariosUnicosActivosEnCosmos > 0
      ? Number((totalInteracciones / usuariosUnicosActivosEnCosmos).toFixed(2))
      : 0;

  const sentimientoPromedioInteracciones =
    totalInteracciones > 0 ? Number((sumaSentimiento / totalInteracciones).toFixed(3)) : 0;

  const distribucionPlataforma = Object.entries(conteoPorPlataforma)
    .map(([plataforma, total]) => ({
      plataforma,
      total,
      porcentaje: totalInteracciones > 0 ? Number(((total / totalInteracciones) * 100).toFixed(2)) : 0
    }))
    .sort((a, b) => b.total - a.total);

  const distribucionTipo = Object.entries(conteoPorTipo)
    .map(([tipo, total]) => ({
      tipo,
      total,
      porcentaje: totalInteracciones > 0 ? Number(((total / totalInteracciones) * 100).toFixed(2)) : 0
    }))
    .sort((a, b) => b.total - a.total);

  const distribucionTema = Object.entries(conteoPorTema)
    .map(([tema, total]) => ({
      tema,
      total,
      porcentaje: totalInteracciones > 0 ? Number(((total / totalInteracciones) * 100).toFixed(2)) : 0
    }))
    .sort((a, b) => b.total - a.total);

  const heatmapData = [];
  let maxHeatmapValue = 0;
  for (let x = 0; x < PLATAFORMAS_ORDEN.length; x++) {
    for (let y = 0; y < TIPOS_ORDEN.length; y++) {
      const val = matrixMap[`${x}:${y}`] || 0;
      if (val > maxHeatmapValue) maxHeatmapValue = val;
      heatmapData.push([x, y, val]);
    }
  }

  return {
    timestamp: new Date().toISOString(),
    kpis: {
      totalUsuarios,
      usuariosActivos,
      usuariosEnRiesgo,
      usuariosInactivos,
      totalInteracciones,
      usuariosConInteraccion: usuariosUnicosActivosEnCosmos,
      tasaParticipacionActiva,
      tasaInteraccionDirecta,
      indiceRiesgoAbandono,
      porcentajeEnRiesgo,
      promedioInteraccionesGlobal,
      promedioInteraccionesParticipante,
      sentimientoPromedioInteracciones,
      totalReaccionesRecibidas
    },
    series: {
      barrasPlataforma: distribucionPlataforma,
      donaTipoInteraccion: distribucionTipo,
      temasInteraccion: distribucionTema,
      heatmap: {
        plataformas: PLATAFORMAS_ORDEN,
        tipos: TIPOS_ORDEN,
        matrix: heatmapData,
        max: maxHeatmapValue
      }
    }
  };
}

module.exports = {
  PLATAFORMAS_ORDEN,
  TIPOS_ORDEN,
  calculateUserChurnScore,
  computeRealtimeMetrics
};
