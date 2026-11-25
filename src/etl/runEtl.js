require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');
const { sql, getSqlPool, closeSqlPool } = require('../config/sql');
const { getContainers, ensureCosmosStructure } = require('../config/cosmos');

const RAW_DIR = path.join(__dirname, '../../data/raw');
const DEPURADOS_DIR = path.join(__dirname, '../../data/depurados');

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

const VALID_ESTATUS = new Set(['activo', 'en_riesgo', 'inactivo']);
const VALID_TIPOS_INTERACCION = new Set([
  'comentario',
  'reaccion',
  'mensaje',
  'respuesta_encuesta',
  'rsvp_evento'
]);

function normalizeText(value) {
  if (value === undefined || value === null) return null;
  const cleaned = String(value).replace(/\s+/g, ' ').trim();
  if (!cleaned || ['null', 'undefined', 'n/a', 'na', '-'].includes(cleaned.toLowerCase())) {
    return null;
  }
  return cleaned;
}

function normalizePlatform(value) {
  const clean = normalizeText(value);
  if (!clean) return null;
  const key = clean.toLowerCase();
  return CANONICAL_PLATFORMS[key] || clean;
}

function parseDateToISO(value) {
  const clean = normalizeText(value);
  if (!clean) return null;

  const dmy = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(clean);
  if (dmy) {
    const [, dd, mm, yyyy] = dmy;
    const iso = `${yyyy}-${mm}-${dd}`;
    const d = new Date(`${iso}T00:00:00Z`);
    if (!Number.isNaN(d.getTime()) && d.toISOString().startsWith(iso)) {
      return iso;
    }
    return null;
  }

  const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(clean);
  if (ymd) {
    const iso = `${ymd[1]}-${ymd[2]}-${ymd[3]}`;
    const d = new Date(`${iso}T00:00:00Z`);
    if (!Number.isNaN(d.getTime())) return iso;
  }
  return null;
}

function parseTimestampToISO(value) {
  const clean = normalizeText(value);
  if (!clean) return null;
  const d = new Date(clean);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function resolveInteractionsCsvPath() {
  const candidates = [
    'comunidad_virtual_interacciones_1000.csv',
    'comunidad_virtual_1000_interacciones.csv'
  ];
  for (const name of candidates) {
    const full = path.join(RAW_DIR, name);
    if (fs.existsSync(full)) return full;
  }
  throw new Error('No se encontró el archivo CSV de interacciones en data/raw/');
}

async function runWithConcurrency(items, concurrency, workerFn) {
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const current = index++;
      let retries = 0;
      while (true) {
        try {
          await workerFn(items[current], current);
          break;
        } catch (err) {
          if ((err.code === 429 || err.statusCode === 429) && retries < 5) {
            const waitMs = Number(err.retryAfterInMilliseconds || 500 * Math.pow(2, retries));
            retries++;
            await new Promise((r) => setTimeout(r, waitMs));
          } else {
            throw err;
          }
        }
      }
    }
  });
  await Promise.all(workers);
}

async function upsertSqlUsersAndInterests(pool, usuariosDepurados, interesesRows) {
  const chunkSize = 200;
  for (let i = 0; i < usuariosDepurados.length; i += chunkSize) {
    const chunk = usuariosDepurados.slice(i, i + chunkSize);
    const jsonPayload = JSON.stringify(chunk);

    await pool
      .request()
      .input('json', sql.NVarChar(sql.MAX), jsonPayload)
      .query(`
        MERGE INTO dbo.usuarios AS target
        USING (
          SELECT
            id_usuario,
            alias,
            CAST(fecha_ingreso AS DATE) AS fecha_ingreso,
            pais,
            estado,
            ciudad,
            latitud,
            longitud,
            zona_horaria,
            rango_edad,
            especie_fursona,
            interes_principal,
            plataforma_principal,
            CAST(es_artista AS BIT) AS es_artista,
            mensajes_30d,
            reacciones_30d,
            eventos_asistidos,
            comisiones_compradas,
            sentimiento_promedio,
            CAST(ultima_actividad AS DATE) AS ultima_actividad,
            estatus,
            consentimiento_datos
          FROM OPENJSON(@json)
          WITH (
            id_usuario VARCHAR(20) '$.id_usuario',
            alias NVARCHAR(100) '$.alias',
            fecha_ingreso VARCHAR(20) '$.fecha_ingreso',
            pais NVARCHAR(100) '$.pais',
            estado NVARCHAR(100) '$.estado',
            ciudad NVARCHAR(100) '$.ciudad',
            latitud FLOAT '$.latitud',
            longitud FLOAT '$.longitud',
            zona_horaria VARCHAR(80) '$.zona_horaria',
            rango_edad VARCHAR(20) '$.rango_edad',
            especie_fursona NVARCHAR(60) '$.especie_fursona',
            interes_principal NVARCHAR(100) '$.interes_principal',
            plataforma_principal NVARCHAR(50) '$.plataforma_principal',
            es_artista INT '$.es_artista',
            mensajes_30d INT '$.mensajes_30d',
            reacciones_30d INT '$.reacciones_30d',
            eventos_asistidos INT '$.eventos_asistidos',
            comisiones_compradas INT '$.comisiones_compradas',
            sentimiento_promedio FLOAT '$.sentimiento_promedio',
            ultima_actividad VARCHAR(20) '$.ultima_actividad',
            estatus VARCHAR(30) '$.estatus',
            consentimiento_datos VARCHAR(10) '$.consentimiento_datos'
          )
        ) AS src
        ON target.id_usuario = src.id_usuario
        WHEN MATCHED THEN
          UPDATE SET
            target.alias = src.alias,
            target.fecha_ingreso = src.fecha_ingreso,
            target.pais = src.pais,
            target.estado = src.estado,
            target.ciudad = src.ciudad,
            target.latitud = src.latitud,
            target.longitud = src.longitud,
            target.zona_horaria = src.zona_horaria,
            target.rango_edad = src.rango_edad,
            target.especie_fursona = src.especie_fursona,
            target.interes_principal = src.interes_principal,
            target.plataforma_principal = src.plataforma_principal,
            target.es_artista = src.es_artista,
            target.mensajes_30d = src.mensajes_30d,
            target.reacciones_30d = src.reacciones_30d,
            target.eventos_asistidos = src.eventos_asistidos,
            target.comisiones_compradas = src.comisiones_compradas,
            target.sentimiento_promedio = src.sentimiento_promedio,
            target.ultima_actividad = src.ultima_actividad,
            target.estatus = src.estatus,
            target.consentimiento_datos = src.consentimiento_datos,
            target.updated_at = SYSUTCDATETIME()
        WHEN NOT MATCHED THEN
          INSERT (
            id_usuario, alias, fecha_ingreso, pais, estado, ciudad, latitud, longitud,
            zona_horaria, rango_edad, especie_fursona, interes_principal, plataforma_principal,
            es_artista, mensajes_30d, reacciones_30d, eventos_asistidos, comisiones_compradas,
            sentimiento_promedio, ultima_actividad, estatus, consentimiento_datos, updated_at
          )
          VALUES (
            src.id_usuario, src.alias, src.fecha_ingreso, src.pais, src.estado, src.ciudad, src.latitud, src.longitud,
            src.zona_horaria, src.rango_edad, src.especie_fursona, src.interes_principal, src.plataforma_principal,
            src.es_artista, src.mensajes_30d, src.reacciones_30d, src.eventos_asistidos, src.comisiones_compradas,
            src.sentimiento_promedio, src.ultima_actividad, src.estatus, src.consentimiento_datos, SYSUTCDATETIME()
          );
      `);
  }

  for (let i = 0; i < interesesRows.length; i += chunkSize) {
    const chunk = interesesRows.slice(i, i + chunkSize);
    const jsonPayload = JSON.stringify(chunk);

    await pool
      .request()
      .input('json', sql.NVarChar(sql.MAX), jsonPayload)
      .query(`
        MERGE INTO dbo.usuario_intereses AS target
        USING (
          SELECT id_usuario, interes, tipo_interes
          FROM OPENJSON(@json)
          WITH (
            id_usuario VARCHAR(20) '$.id_usuario',
            interes NVARCHAR(100) '$.interes',
            tipo_interes VARCHAR(30) '$.tipo_interes'
          )
        ) AS src
        ON target.id_usuario = src.id_usuario AND target.interes = src.interes
        WHEN MATCHED THEN
          UPDATE SET target.tipo_interes = src.tipo_interes
        WHEN NOT MATCHED THEN
          INSERT (id_usuario, interes, tipo_interes)
          VALUES (src.id_usuario, src.interes, src.tipo_interes);
      `);
  }
}

async function runEtl() {
  const startTime = Date.now();
  const processTimestamp = new Date().toISOString();
  console.log(`[ETL] Iniciando pipeline ETL híbrido Community 360 (${processTimestamp})...`);

  await ensureCosmosStructure();
  const pool = await getSqlPool();
  const containers = getContainers();

  const usersCsvPath = path.join(RAW_DIR, 'comunidad_virtual_usuarios.csv');
  const interactionsCsvPath = resolveInteractionsCsvPath();

  const rawUsers = parse(fs.readFileSync(usersCsvPath, 'utf8'), {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true
  });

  const rawInteractions = parse(fs.readFileSync(interactionsCsvPath, 'utf8'), {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true
  });

  const cuarentenaDocs = [];
  const motivosRechazoCount = {};

  function pushCuarentena(origen, idRegistro, idUsuario, motivo, detalle, lineaCsv, originalRow) {
    motivosRechazoCount[motivo] = (motivosRechazoCount[motivo] || 0) + 1;
    const safeId = `${origen}_${idRegistro || 'SIN_ID'}_L${lineaCsv}`.replace(/[^a-zA-Z0-9_-]/g, '_');
    cuarentenaDocs.push({
      id: safeId,
      origen,
      id_registro: idRegistro || null,
      id_usuario: idUsuario || null,
      motivo_rechazo: motivo,
      detalle_rechazo: detalle,
      fecha_proceso: processTimestamp,
      linea_csv: lineaCsv,
      registro_original: originalRow
    });
  }

  // =========================================================
  // FASE A: PROCESAMIENTO Y DEPURACIÓN DE USUARIOS
  // =========================================================
  const seenUserIds = new Set();
  const seenAliases = new Set();
  const usuariosAceptadosMap = new Map();
  const usuariosDepurados = [];

  let usuariosTransformados = 0;
  let usuariosAnonimizados = 0;
  let usuariosDuplicados = 0;
  let usuariosRechazados = 0;
  let ejemploAnonimizacion = null;

  rawUsers.forEach((rawRow, idx) => {
    const lineaCsv = idx + 2;
    let wasTransformed = false;

    const id_usuario = normalizeText(rawRow.id_usuario)?.toUpperCase() || null;
    const alias = normalizeText(rawRow.alias);

    if (!id_usuario || !/^U\d+$/i.test(id_usuario)) {
      usuariosRechazados++;
      pushCuarentena(
        'usuarios_csv',
        id_usuario,
        id_usuario,
        'ID_USUARIO_INVALIDO',
        'El campo id_usuario es obligatorio y debe cumplir el formato U######.',
        lineaCsv,
        rawRow
      );
      return;
    }

    if (seenUserIds.has(id_usuario)) {
      usuariosDuplicados++;
      usuariosRechazados++;
      pushCuarentena(
        'usuarios_csv',
        id_usuario,
        id_usuario,
        'DUPLICADO_ID_USUARIO',
        `El id_usuario ${id_usuario} ya fue procesado previamente.`,
        lineaCsv,
        rawRow
      );
      return;
    }

    if (!alias) {
      usuariosRechazados++;
      pushCuarentena(
        'usuarios_csv',
        id_usuario,
        id_usuario,
        'ALIAS_OBLIGATORIO_VACIO',
        'El usuario no cuenta con alias válido.',
        lineaCsv,
        rawRow
      );
      return;
    }

    const aliasKey = alias.toLowerCase();
    if (seenAliases.has(aliasKey)) {
      usuariosDuplicados++;
      usuariosRechazados++;
      pushCuarentena(
        'usuarios_csv',
        id_usuario,
        id_usuario,
        'DUPLICADO_ALIAS',
        `El alias ${alias} está duplicado en el padrón.`,
        lineaCsv,
        rawRow
      );
      return;
    }

    const fecha_ingreso = parseDateToISO(rawRow.fecha_ingreso);
    const ultima_actividad = parseDateToISO(rawRow.ultima_actividad);
    if (!fecha_ingreso || !ultima_actividad) {
      usuariosRechazados++;
      pushCuarentena(
        'usuarios_csv',
        id_usuario,
        id_usuario,
        'FECHA_INVALIDA',
        'fecha_ingreso o ultima_actividad no tienen un formato de fecha válido.',
        lineaCsv,
        rawRow
      );
      return;
    }
    if (fecha_ingreso !== rawRow.fecha_ingreso || ultima_actividad !== rawRow.ultima_actividad) {
      wasTransformed = true;
    }

    const plataforma_principal = normalizePlatform(rawRow.plataforma_principal);
    const interes_principal = normalizeText(rawRow.interes_principal);
    const rango_edad = normalizeText(rawRow.rango_edad);
    const especie_fursona = normalizeText(rawRow.especie_fursona);
    const estatusRaw = normalizeText(rawRow.estatus)?.toLowerCase();
    const estatus = VALID_ESTATUS.has(estatusRaw) ? estatusRaw : null;

    const consentRaw = normalizeText(rawRow.consentimiento_datos)
      ?.toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    const consentimiento_datos = consentRaw === 'si' || consentRaw === 'no' ? consentRaw : null;

    if (!plataforma_principal || !interes_principal || !rango_edad || !especie_fursona || !estatus || !consentimiento_datos) {
      usuariosRechazados++;
      pushCuarentena(
        'usuarios_csv',
        id_usuario,
        id_usuario,
        'CAMPOS_OBLIGATORIOS_INCOMPLETOS',
        'Faltan campos categóricos obligatorios o contienen valores fuera de catálogo.',
        lineaCsv,
        rawRow
      );
      return;
    }

    const es_artista = Number(rawRow.es_artista) === 1 ? 1 : 0;
    const mensajes_30d = Number.parseInt(rawRow.mensajes_30d, 10);
    const reacciones_30d = Number.parseInt(rawRow.reacciones_30d, 10);
    const eventos_asistidos = Number.parseInt(rawRow.eventos_asistidos, 10);
    const comisiones_compradas = Number.parseInt(rawRow.comisiones_compradas, 10);
    const sentimiento_promedio = Number.parseFloat(rawRow.sentimiento_promedio);

    if (
      Number.isNaN(mensajes_30d) || mensajes_30d < 0 ||
      Number.isNaN(reacciones_30d) || reacciones_30d < 0 ||
      Number.isNaN(eventos_asistidos) || eventos_asistidos < 0 ||
      Number.isNaN(comisiones_compradas) || comisiones_compradas < 0 ||
      Number.isNaN(sentimiento_promedio) || sentimiento_promedio < -1 || sentimiento_promedio > 1
    ) {
      usuariosRechazados++;
      pushCuarentena(
        'usuarios_csv',
        id_usuario,
        id_usuario,
        'METRICAS_NUMERICAS_INVALIDAS',
        'Métricas numéricas fuera de rango o con tipo inválido.',
        lineaCsv,
        rawRow
      );
      return;
    }

    let pais = normalizeText(rawRow.pais);
    let estado = normalizeText(rawRow.estado);
    let ciudad = normalizeText(rawRow.ciudad);
    let zona_horaria = normalizeText(rawRow.zona_horaria);
    const latRaw = normalizeText(rawRow.latitud);
    const lngRaw = normalizeText(rawRow.longitud);
    let latitud = latRaw !== null ? Number.parseFloat(latRaw) : null;
    let longitud = lngRaw !== null ? Number.parseFloat(lngRaw) : null;

    if (
      (latitud !== null && (Number.isNaN(latitud) || latitud < -90 || latitud > 90)) ||
      (longitud !== null && (Number.isNaN(longitud) || longitud < -180 || longitud > 180))
    ) {
      usuariosRechazados++;
      pushCuarentena(
        'usuarios_csv',
        id_usuario,
        id_usuario,
        'COORDENADAS_INVALIDAS',
        'Latitud o longitud fuera de rango geográfico válido.',
        lineaCsv,
        rawRow
      );
      return;
    }

    // Regla 5: Privacidad obligatoria (consentimiento_datos = "no")
    if (consentimiento_datos === 'no') {
      const snapshotAntes = {
        id_usuario,
        alias,
        consentimiento_datos: rawRow.consentimiento_datos,
        pais: rawRow.pais,
        estado: rawRow.estado,
        ciudad: rawRow.ciudad,
        latitud: rawRow.latitud,
        longitud: rawRow.longitud,
        zona_horaria: rawRow.zona_horaria
      };

      pais = null;
      estado = null;
      ciudad = null;
      latitud = null;
      longitud = null;
      zona_horaria = null;

      usuariosAnonimizados++;
      wasTransformed = true;

      if (!ejemploAnonimizacion) {
        ejemploAnonimizacion = {
          antes: snapshotAntes,
          despues: {
            id_usuario,
            alias,
            consentimiento_datos,
            pais: null,
            estado: null,
            ciudad: null,
            latitud: null,
            longitud: null,
            zona_horaria: null
          }
        };
      }
    }

    if (wasTransformed) usuariosTransformados++;

    const userClean = {
      id_usuario,
      alias,
      fecha_ingreso,
      pais,
      estado,
      ciudad,
      latitud,
      longitud,
      zona_horaria,
      rango_edad,
      especie_fursona,
      interes_principal,
      plataforma_principal,
      es_artista,
      mensajes_30d,
      reacciones_30d,
      eventos_asistidos,
      comisiones_compradas,
      sentimiento_promedio: Number(sentimiento_promedio.toFixed(4)),
      ultima_actividad,
      estatus,
      consentimiento_datos
    };

    seenUserIds.add(id_usuario);
    seenAliases.add(aliasKey);
    usuariosAceptadosMap.set(id_usuario, userClean);
    usuariosDepurados.push(userClean);
  });

  // =========================================================
  // FASE B: PROCESAMIENTO Y DEPURACIÓN DE INTERACCIONES
  // =========================================================
  const seenInteractionIds = new Set();
  const seenCompositeKeys = new Set();
  const interaccionesDepuradas = [];

  let interaccionesTransformadas = 0;
  let interaccionesAnonimizadas = 0;
  let interaccionesDuplicadas = 0;
  let interaccionesHuerfanas = 0;
  let interaccionesRechazadas = 0;

  rawInteractions.forEach((rawRow, idx) => {
    const lineaCsv = idx + 2;
    let wasTransformed = false;

    const id_interaccion = normalizeText(rawRow.id_interaccion)?.toUpperCase() || null;
    const id_usuario = normalizeText(rawRow.id_usuario)?.toUpperCase() || null;

    if (!id_interaccion || !/^I\d+$/i.test(id_interaccion)) {
      interaccionesRechazadas++;
      pushCuarentena(
        'interacciones_csv',
        id_interaccion,
        id_usuario,
        'ID_INTERACCION_INVALIDO',
        'El campo id_interaccion es obligatorio y debe cumplir formato I#######.',
        lineaCsv,
        rawRow
      );
      return;
    }

    if (seenInteractionIds.has(id_interaccion)) {
      interaccionesDuplicadas++;
      interaccionesRechazadas++;
      pushCuarentena(
        'interacciones_csv',
        id_interaccion,
        id_usuario,
        'DUPLICADO_ID_INTERACCION',
        `El id_interaccion ${id_interaccion} se encuentra duplicado.`,
        lineaCsv,
        rawRow
      );
      return;
    }

    const timestamp = parseTimestampToISO(rawRow.timestamp);
    const canal = normalizePlatform(rawRow.canal);
    const tipo = normalizeText(rawRow.tipo)?.toLowerCase() || null;
    const texto = normalizeText(rawRow.texto) || '';
    const tema = normalizeText(rawRow.tema)?.toLowerCase() || null;
    const idioma = normalizeText(rawRow.idioma)?.toLowerCase() || 'es';
    const dispositivo = normalizeText(rawRow.dispositivo) || 'Desconocido';

    const compositeKey = `${id_usuario}|${timestamp}|${canal}|${tipo}|${texto}`;
    if (seenCompositeKeys.has(compositeKey)) {
      interaccionesDuplicadas++;
      interaccionesRechazadas++;
      pushCuarentena(
        'interacciones_csv',
        id_interaccion,
        id_usuario,
        'DUPLICADO_HUELLA_COMPUESTA',
        'Interacción duplicada detectada por huella compuesta (usuario + timestamp + canal + tipo + texto).',
        lineaCsv,
        rawRow
      );
      return;
    }

    if (!id_usuario || !timestamp || !canal || !tipo || !VALID_TIPOS_INTERACCION.has(tipo) || !tema) {
      interaccionesRechazadas++;
      pushCuarentena(
        'interacciones_csv',
        id_interaccion,
        id_usuario,
        'CAMPOS_OBLIGATORIOS_INVALIDOS',
        'Faltan campos obligatorios (id_usuario, timestamp, canal, tipo o tema) o son inválidos.',
        lineaCsv,
        rawRow
      );
      return;
    }

    if (tipo !== 'reaccion' && texto.length === 0) {
      interaccionesRechazadas++;
      pushCuarentena(
        'interacciones_csv',
        id_interaccion,
        id_usuario,
        'TEXTO_VACIO_EN_INTERACCION',
        `Las interacciones de tipo '${tipo}' requieren contenido de texto.`,
        lineaCsv,
        rawRow
      );
      return;
    }

    const sentimiento = Number.parseFloat(rawRow.sentimiento);
    const reacciones_recibidas = Number.parseInt(rawRow.reacciones_recibidas, 10);
    const rawLongitud = Number.parseInt(rawRow.longitud_texto, 10);

    if (
      Number.isNaN(sentimiento) || sentimiento < -1 || sentimiento > 1 ||
      Number.isNaN(reacciones_recibidas) || reacciones_recibidas < 0
    ) {
      interaccionesRechazadas++;
      pushCuarentena(
        'interacciones_csv',
        id_interaccion,
        id_usuario,
        'METRICAS_INTERACCION_INVALIDAS',
        'Sentimiento o reacciones_recibidas fuera de rango válido.',
        lineaCsv,
        rawRow
      );
      return;
    }

    // Regla 6: Integridad referencial contra padrón depurado de usuarios
    const parentUser = usuariosAceptadosMap.get(id_usuario);
    if (!parentUser) {
      interaccionesHuerfanas++;
      interaccionesRechazadas++;
      pushCuarentena(
        'interacciones_csv',
        id_interaccion,
        id_usuario,
        'INTEGRIDAD_REFERENCIAL_ID_USUARIO_HUERFANO',
        `El id_usuario ${id_usuario} no existe en el padrón depurado de usuarios.`,
        lineaCsv,
        rawRow
      );
      return;
    }

    const longitud_texto = texto.length;
    if (longitud_texto !== rawLongitud) {
      wasTransformed = true;
    }

    let pais = normalizeText(rawRow.pais);
    let estado = normalizeText(rawRow.estado);
    let ciudad = normalizeText(rawRow.ciudad);

    // Respetar privacidad si el usuario propietario no dio consentimiento
    if (parentUser.consentimiento_datos === 'no') {
      if (pais !== null || estado !== null || ciudad !== null) {
        wasTransformed = true;
      }
      pais = null;
      estado = null;
      ciudad = null;
      interaccionesAnonimizadas++;
    }

    const etiquetasRaw = normalizeText(rawRow.etiquetas);
    const etiquetas = etiquetasRaw
      ? [...new Set(etiquetasRaw.split(/[|,;]/).map((t) => t.trim().toLowerCase()).filter(Boolean))]
      : [];

    if (etiquetasRaw) wasTransformed = true;
    if (wasTransformed) interaccionesTransformadas++;

    seenInteractionIds.add(id_interaccion);
    seenCompositeKeys.add(compositeKey);

    interaccionesDepuradas.push({
      id: id_interaccion,
      id_interaccion,
      id_usuario,
      timestamp,
      canal,
      tipo,
      texto,
      tema,
      sentimiento: Number(sentimiento.toFixed(4)),
      idioma,
      pais,
      estado,
      ciudad,
      dispositivo,
      longitud_texto,
      reacciones_recibidas,
      etiquetas
    });
  });

  // =========================================================
  // TABLA NORMALIZADA DE INTERESES DEL USUARIO
  // =========================================================
  const interesesMap = new Map();
  for (const u of usuariosDepurados) {
    const parts = u.interes_principal
      .split(/[|;,]/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const interes of parts) {
      const key = `${u.id_usuario}|${interes.toLowerCase()}`;
      interesesMap.set(key, {
        id_usuario: u.id_usuario,
        interes,
        tipo_interes: 'principal'
      });
    }
  }

  for (const inter of interaccionesDepuradas) {
    for (const tag of inter.etiquetas) {
      const formattedTag = tag.charAt(0).toUpperCase() + tag.slice(1);
      const key = `${inter.id_usuario}|${formattedTag.toLowerCase()}`;
      if (!interesesMap.has(key)) {
        interesesMap.set(key, {
          id_usuario: inter.id_usuario,
          interes: formattedTag,
          tipo_interes: 'etiqueta_interaccion'
        });
      }
    }
  }
  const interesesRows = Array.from(interesesMap.values());

  // =========================================================
  // REGLA 8: EXPORTAR ARCHIVOS DEPURADOS Y RESUMEN DE CALIDAD
  // =========================================================
  fs.mkdirSync(DEPURADOS_DIR, { recursive: true });

  const usuariosCsvOut = stringify(usuariosDepurados, { header: true });
  fs.writeFileSync(path.join(DEPURADOS_DIR, 'usuarios_depurados.csv'), usuariosCsvOut, 'utf8');

  const interaccionesForCsv = interaccionesDepuradas.map((item) => ({
    id_interaccion: item.id_interaccion,
    id_usuario: item.id_usuario,
    timestamp: item.timestamp,
    canal: item.canal,
    tipo: item.tipo,
    texto: item.texto,
    tema: item.tema,
    sentimiento: item.sentimiento,
    idioma: item.idioma,
    pais: item.pais,
    estado: item.estado,
    ciudad: item.ciudad,
    dispositivo: item.dispositivo,
    longitud_texto: item.longitud_texto,
    reacciones_recibidas: item.reacciones_recibidas,
    etiquetas: item.etiquetas.join('|')
  }));
  const interaccionesCsvOut = stringify(interaccionesForCsv, { header: true });
  fs.writeFileSync(path.join(DEPURADOS_DIR, 'interacciones_depuradas.csv'), interaccionesCsvOut, 'utf8');

  // =========================================================
  // REGLA 9: CARGA HÍBRIDA IDEMPOTENTE (AZURE SQL + COSMOS DB)
  // =========================================================
  console.log(
    `[ETL] Cargando ${usuariosDepurados.length} usuarios y ${interesesRows.length} registros en usuario_intereses hacia Azure SQL...`
  );
  await upsertSqlUsersAndInterests(pool, usuariosDepurados, interesesRows);

  console.log(`[ETL] Cargando ${interaccionesDepuradas.length} interacciones válidas en Cosmos DB (interacciones)...`);
  await runWithConcurrency(interaccionesDepuradas, 25, async (doc) => {
    await containers.interacciones.items.upsert(doc);
  });

  console.log(`[ETL] Cargando ${cuarentenaDocs.length} registros rechazados en Cosmos DB (cuarentena)...`);
  await runWithConcurrency(cuarentenaDocs, 25, async (doc) => {
    await containers.cuarentena.items.upsert(doc);
  });

  // =========================================================
  // REGLA 10: BITÁCORA Y REPORTE DE CALIDAD (ANTES VS DESPUÉS)
  // =========================================================
  const durationMs = Date.now() - startTime;
  const bitacoraId = `etl_run_${processTimestamp.replace(/[:.]/g, '-')}`;

  const resumenCalidad = {
    id: bitacoraId,
    fecha_proceso: processTimestamp,
    duracion_ms: durationMs,
    estado: 'COMPLETADO',
    archivos_origen: {
      usuarios: path.basename(usersCsvPath),
      interacciones: path.basename(interactionsCsvPath)
    },
    totales_globales: {
      recibidos: rawUsers.length + rawInteractions.length,
      aceptados: usuariosDepurados.length + interaccionesDepuradas.length,
      transformados: usuariosTransformados + interaccionesTransformadas,
      anonimizados: usuariosAnonimizados + interaccionesAnonimizadas,
      rechazados: usuariosRechazados + interaccionesRechazadas,
      en_cuarentena: cuarentenaDocs.length
    },
    antes_vs_despues: {
      usuarios: {
        antes_recibidos: rawUsers.length,
        despues_aceptados: usuariosDepurados.length,
        transformados: usuariosTransformados,
        anonimizados_sin_consentimiento: usuariosAnonimizados,
        duplicados_descartados: usuariosDuplicados,
        rechazados_cuarentena: usuariosRechazados,
        intereses_normalizados_sql: interesesRows.length
      },
      interacciones: {
        antes_recibidos: rawInteractions.length,
        despues_aceptados: interaccionesDepuradas.length,
        transformados: interaccionesTransformadas,
        anonimizados_ubicacion: interaccionesAnonimizadas,
        duplicados_descartados: interaccionesDuplicadas,
        huerfanos_integridad_referencial: interaccionesHuerfanas,
        rechazados_cuarentena: interaccionesRechazadas
      }
    },
    desglose_motivos_rechazo: motivosRechazoCount,
    ejemplo_anonimizacion: ejemploAnonimizacion
  };

  fs.writeFileSync(
    path.join(DEPURADOS_DIR, 'resumen_calidad.json'),
    JSON.stringify(resumenCalidad, null, 2),
    'utf8'
  );

  await containers.bitacora.items.upsert(resumenCalidad);

  console.log('[ETL] Proceso ETL finalizado con éxito:');
  console.log(`  - Usuarios Azure SQL: ${usuariosDepurados.length} aceptados (${usuariosAnonimizados} anonimizados)`);
  console.log(`  - Usuario_Intereses Azure SQL: ${interesesRows.length} relaciones normalizadas`);
  console.log(`  - Interacciones Cosmos DB: ${interaccionesDepuradas.length} aceptadas`);
  console.log(`  - Cuarentena Cosmos DB: ${cuarentenaDocs.length} registros en cuarentena`);
  console.log(`  - Bitácora Cosmos DB: ${bitacoraId} (${durationMs} ms)`);

  return resumenCalidad;
}

if (require.main === module) {
  runEtl()
    .then(async () => {
      await closeSqlPool();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('[ETL] Error crítico:', err);
      await closeSqlPool();
      process.exit(1);
    });
}

module.exports = { runEtl };
