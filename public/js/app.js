(() => {
  const RAILWAY_BACKEND_URL = 'https://community-360-bden-production.up.railway.app';

  const API_BASE_URL = ['localhost', '127.0.0.1'].includes(window.location.hostname)
    ? 'http://localhost:3000'
    : RAILWAY_BACKEND_URL.replace(/\/+$/, '');

  const TOKEN_KEY = 'c360_jwt_token';

  const loginView = document.getElementById('loginView');
  const dashboardView = document.getElementById('dashboardView');
  const loginForm = document.getElementById('loginForm');
  const loginError = document.getElementById('loginError');
  const adminEmailLabel = document.getElementById('adminEmailLabel');
  const logoutBtn = document.getElementById('logoutBtn');
  const refreshHistoricalBtn = document.getElementById('refreshHistoricalBtn');
  const wsStatusPill = document.getElementById('wsStatusPill');
  const wsStatusText = document.getElementById('wsStatusText');

  let socket = null;
  let chartRealtimeBars = null;
  let chartRealtimeDonut = null;
  let chartRealtimeHeatmap = null;
  let chartHistoricalInterests = null;
  let chartHistoricalPlatformStatus = null;

  let cachedRiesgoUsers = [];
  let cachedCuarentenaRows = [];
  let currentRiesgoFilter = 'all';
  let activeVista360Id = null;

  // Estado del Sistema de Geolocalización Satelital Orbital (ZEUS-360 G.I. Joe HUD)
  let tacticalNodes = [];
  let tacticalSelectedIdx = 0;
  let tacticalPostEtlShieldMode = true; // true = Post-ETL (escudo activo), false = Pre-ETL (crudo)
  let tacticalAnimFrame = null;
  let reticleCurrent = { x: 430, y: 220 };
  let reticleTarget = { x: 430, y: 220 };
  let radarAngle = 0;
  let ringRotation = 0;
  let ejemploAnonimizacionCache = null;

  const CITY_COORDS_FALLBACK = {
    'Mérida': { lat: 20.9674, lng: -89.5926, pais: 'México', tz: 'America/Merida' },
    'Guadalajara': { lat: 20.6597, lng: -103.3496, pais: 'México', tz: 'America/Mexico_City' },
    'Monterrey': { lat: 25.6866, lng: -100.3161, pais: 'México', tz: 'America/Monterrey' },
    'Ciudad de México': { lat: 19.4326, lng: -99.1332, pais: 'México', tz: 'America/Mexico_City' },
    'Cancún': { lat: 21.1619, lng: -86.8515, pais: 'México', tz: 'America/Cancun' },
    'Puebla': { lat: 19.0414, lng: -98.2063, pais: 'México', tz: 'America/Mexico_City' },
    'Querétaro': { lat: 20.5888, lng: -100.3899, pais: 'México', tz: 'America/Mexico_City' },
    'Villahermosa': { lat: 17.9895, lng: -92.9475, pais: 'México', tz: 'America/Mexico_City' },
    'Veracruz': { lat: 19.1738, lng: -96.1342, pais: 'México', tz: 'America/Mexico_City' },
    'Tijuana': { lat: 32.5149, lng: -117.0382, pais: 'México', tz: 'America/Tijuana' },
    'León': { lat: 21.1221, lng: -101.6826, pais: 'México', tz: 'America/Mexico_City' },
    'Chihuahua': { lat: 28.6353, lng: -106.0889, pais: 'México', tz: 'America/Chihuahua' },
    'Oaxaca': { lat: 17.0732, lng: -96.7266, pais: 'México', tz: 'America/Mexico_City' },
    'Campeche': { lat: 19.8301, lng: -90.5349, pais: 'México', tz: 'America/Merida' },
    'Buenos Aires': { lat: -34.6037, lng: -58.3816, pais: 'Argentina', tz: 'America/Argentina/Buenos_Aires' },
    'Lima': { lat: -12.0464, lng: -77.0428, pais: 'Perú', tz: 'America/Lima' },
    'Bogotá': { lat: 4.711, lng: -74.0721, pais: 'Colombia', tz: 'America/Bogota' },
    'Santiago': { lat: -33.4489, lng: -70.6693, pais: 'Chile', tz: 'America/Santiago' },
    'Madrid': { lat: 40.4168, lng: -3.7038, pais: 'España', tz: 'Europe/Madrid' },
    'Houston': { lat: 29.7604, lng: -95.3698, pais: 'Estados Unidos', tz: 'America/Chicago' },
    'Los Ángeles': { lat: 34.0522, lng: -118.2437, pais: 'Estados Unidos', tz: 'America/Los_Angeles' }
  };

  function getToken() {
    return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY);
  }

  function setToken(token) {
    sessionStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(TOKEN_KEY, token);
  }

  function clearToken() {
    sessionStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_KEY);
  }

  async function apiFetch(endpoint, options = {}) {
    const token = getToken();
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const url = endpoint.startsWith('http') ? endpoint : `${API_BASE_URL}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers
    });

    if (response.status === 401 && endpoint !== '/api/auth/login') {
      handleForceLogout();
      throw new Error('Sesión expirada o no autorizada.');
    }

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || `Error HTTP ${response.status}`);
    }
    return data;
  }

  function resizeAllCharts() {
    requestAnimationFrame(() => {
      chartRealtimeBars?.resize();
      chartRealtimeDonut?.resize();
      chartRealtimeHeatmap?.resize();
      chartHistoricalInterests?.resize();
      chartHistoricalPlatformStatus?.resize();
    });
  }

  function ensureChartsInitialized() {
    if (!chartRealtimeBars) {
      chartRealtimeBars = echarts.init(document.getElementById('chartRealtimeBars'));
      chartRealtimeDonut = echarts.init(document.getElementById('chartRealtimeDonut'));
      chartRealtimeHeatmap = echarts.init(document.getElementById('chartRealtimeHeatmap'));
      chartHistoricalInterests = echarts.init(document.getElementById('chartHistoricalInterests'));
      chartHistoricalPlatformStatus = echarts.init(document.getElementById('chartHistoricalPlatformStatus'));

      window.addEventListener('resize', resizeAllCharts);
    }
  }

  // =========================================================
  // SISTEMA DE GEOLOCALIZACIÓN SATELITAL G.I. JOE (ZEUS-360)
  // =========================================================
  let dotPatternCache = null;

  // Cámara geoespacial con interpolación suave de Zoom y Paneo
  let camCurLat = 12;
  let camCurLng = -25;
  let camCurZoom = 1.0;
  let camTargetLat = 12;
  let camTargetLng = -25;
  let camTargetZoom = 1.0;

  function toDMS(deg, posHem, negHem) {
    if (deg === null || deg === undefined || Number.isNaN(Number(deg))) return 'Sin registro';
    const num = Number(deg);
    const hem = num >= 0 ? posHem : negHem;
    const abs = Math.abs(num);
    const d = Math.floor(abs);
    const minFloat = (abs - d) * 60;
    const m = Math.floor(minFloat);
    const s = ((minFloat - m) * 60).toFixed(1);
    return `${d}° ${String(m).padStart(2, '0')}' ${String(s).padStart(4, '0')}" ${hem}`;
  }

  function getDotMatrixPattern(ctx) {
    if (dotPatternCache) return dotPatternCache;
    const off = document.createElement('canvas');
    off.width = 7;
    off.height = 7;
    const octx = off.getContext('2d');
    octx.fillStyle = 'rgba(6, 182, 212, 0.08)';
    octx.fillRect(0, 0, 7, 7);
    octx.fillStyle = 'rgba(34, 211, 238, 0.42)';
    octx.beginPath();
    octx.arc(3.5, 3.5, 1.15, 0, Math.PI * 2);
    octx.fill();
    dotPatternCache = ctx.createPattern(off, 'repeat');
    return dotPatternCache;
  }

  function getCameraBounds() {
    const halfLng = 180 / camCurZoom;
    const halfLat = 70 / camCurZoom;
    let minLng = camCurLng - halfLng;
    let maxLng = camCurLng + halfLng;
    if (minLng < -180) {
      maxLng += -180 - minLng;
      minLng = -180;
    }
    if (maxLng > 180) {
      minLng -= maxLng - 180;
      maxLng = 180;
    }
    let minLat = camCurLat - halfLat;
    let maxLat = camCurLat + halfLat;
    if (minLat < -65) {
      maxLat += -65 - minLat;
      minLat = -65;
    }
    if (maxLat > 78) {
      minLat -= maxLat - 78;
      maxLat = 78;
    }
    return { minLng, maxLng, minLat, maxLat };
  }

  function latLngToCanvas(lat, lng, width, height) {
    const padX = 42;
    const padY = 30;
    const { minLng, maxLng, minLat, maxLat } = getCameraBounds();
    const x = ((lng - minLng) / (maxLng - minLng)) * (width - padX * 2) + padX;
    const y = ((maxLat - lat) / (maxLat - minLat)) * (height - padY * 2) + padY;
    return { x, y };
  }

  // Cartografía vectorial planetaria de alta densidad (Todos los continentes e islas mayores)
  const TACTICAL_LAND_POLYGONS = [
    // Norteamérica (Alaska, Canadá, EE.UU., México, Baja California y Yucatán)
    [
      [-166, 60], [-162, 66], [-156, 71], [-140, 70], [-128, 70], [-115, 73], [-95, 74],
      [-82, 74], [-78, 68], [-82, 63], [-92, 62], [-94, 58], [-80, 54], [-78, 61],
      [-65, 62], [-62, 54], [-55, 51], [-60, 46], [-67, 45], [-70, 42], [-74, 40],
      [-76, 35], [-80, 32], [-81, 25], [-83, 29], [-89, 30], [-95, 29], [-97, 26],
      [-97, 21], [-94, 18], [-90, 21], [-87, 21], [-88, 18], [-92, 15], [-97, 16],
      [-105, 20], [-109, 25], [-114, 30], [-110, 23], [-115, 28], [-117, 33],
      [-122, 37], [-124, 43], [-124, 48], [-130, 54], [-138, 59], [-148, 61], [-155, 58]
    ],
    // Centroamérica
    [
      [-92, 15], [-88, 18], [-83, 15], [-83, 11], [-79, 9], [-77, 8],
      [-80, 7], [-83, 9], [-87, 12], [-90, 14]
    ],
    // Cuba y Antillas Mayores
    [[-85, 22], [-80, 23], [-74, 20], [-78, 20], [-82, 22]],
    [[-74, 19], [-68, 19], [-69, 18], [-74, 18]],
    // Groenlandia e Islandia
    [[-52, 60], [-55, 68], [-60, 76], [-45, 82], [-22, 81], [-18, 74], [-24, 68], [-38, 64], [-44, 60]],
    [[-24, 64], [-22, 66], [-14, 66], [-14, 64]],
    // Sudamérica completa
    [
      [-77, 9], [-75, 11], [-71, 12], [-62, 11], [-58, 7], [-52, 4], [-48, -1],
      [-41, -3], [-35, -6], [-35, -10], [-39, -15], [-40, -22], [-44, -23],
      [-48, -26], [-52, -33], [-58, -35], [-57, -38], [-62, -40], [-65, -44],
      [-67, -50], [-66, -55], [-71, -55], [-75, -50], [-74, -44], [-72, -36],
      [-71, -30], [-70, -20], [-75, -15], [-78, -10], [-81, -5], [-80, 1], [-78, 5]
    ],
    // Islas Británicas e Irlanda
    [[-6, 50], [-5, 54], [-6, 58], [-2, 58], [1, 53], [1, 51], [-3, 50]],
    [[-10, 52], [-10, 55], [-6, 55], [-6, 52]],
    // Europa Occidental, Escandinavia y Mediterráneo
    [
      [-9, 37], [-9, 43], [-2, 43], [-5, 48], [2, 51], [8, 54], [10, 58],
      [5, 60], [6, 63], [14, 68], [20, 70], [28, 71], [31, 69], [28, 65],
      [22, 64], [18, 59], [14, 55], [19, 55], [24, 59], [30, 60], [38, 56],
      [40, 47], [36, 45], [28, 42], [26, 40], [23, 37], [20, 39], [18, 43],
      [13, 45], [16, 41], [15, 38], [12, 41], [9, 44], [5, 43], [3, 42],
      [0, 38], [-5, 36]
    ],
    // África completa y Madagascar
    [
      [-6, 36], [3, 37], [10, 37], [11, 33], [20, 32], [25, 32], [32, 31],
      [34, 28], [38, 22], [41, 15], [44, 12], [51, 12], [49, 8], [45, 2],
      [40, -5], [40, -11], [36, -18], [35, -24], [31, -30], [25, -34],
      [18, -35], [16, -29], [14, -22], [12, -15], [12, -6], [9, -1],
      [9, 4], [4, 6], [-2, 5], [-8, 5], [-13, 8], [-17, 15], [-17, 21],
      [-13, 28], [-9, 33]
    ],
    [[44, -25], [43, -18], [49, -12], [50, -16], [47, -25]],
    // Asia, Medio Oriente, India, Sudeste Asiático y Siberia
    [
      [27, 40], [35, 42], [42, 42], [40, 47], [38, 56], [31, 69], [45, 68],
      [60, 70], [75, 73], [95, 76], [115, 74], [140, 73], [165, 69], [178, 66],
      [170, 60], [162, 55], [156, 51], [160, 58], [142, 54], [136, 46],
      [130, 42], [128, 35], [125, 38], [121, 39], [122, 32], [120, 24],
      [114, 22], [108, 21], [109, 13], [105, 9], [101, 13], [103, 2],
      [99, 7], [97, 16], [91, 22], [85, 19], [80, 13], [77, 8], [73, 15],
      [70, 22], [66, 25], [57, 26], [51, 24], [55, 28], [48, 30], [50, 26],
      [58, 21], [52, 16], [44, 13], [40, 20], [35, 28], [35, 33], [36, 37], [27, 39]
    ],
    // Japón, Filipinas e Indonesia
    [[130, 31], [134, 34], [139, 36], [141, 41], [144, 44], [141, 45], [139, 40], [135, 35]],
    [[120, 18], [122, 18], [125, 10], [125, 6], [121, 13]],
    [[96, 5], [104, -1], [106, -6], [102, -4], [96, 3]],
    [[109, 1], [115, 4], [118, 1], [115, -4], [110, -3]],
    [[132, -2], [141, -3], [148, -8], [145, -9], [135, -5]],
    // Australia y Nueva Zelanda
    [
      [114, -22], [122, -17], [130, -12], [136, -12], [138, -16], [142, -11],
      [146, -17], [153, -25], [151, -34], [147, -38], [140, -38], [135, -34],
      [129, -32], [122, -34], [115, -34], [113, -26]
    ],
    [[167, -46], [172, -41], [178, -37], [176, -41], [170, -46]]
  ];

  let tacticalTargetFilter = 'all'; // 'all' | 'deployed' | 'undeployed'
  let cachedAnonimosUsers = [];

  function resetCameraToGlobal() {
    camTargetLat = 12;
    camTargetLng = -25;
    camTargetZoom = 1.0;
    const btn = document.getElementById('btnTacticalZoomToggle');
    if (btn) btn.textContent = '🌐 VISTA GLOBAL 1.0X (ACTIVA)';
  }

  function buildTacticalNodes(usersList, ejemploAnon) {
    const nodes = [];

    if (ejemploAnon && ejemploAnon.antes) {
      const a = ejemploAnon.antes;
      const fallback = CITY_COORDS_FALLBACK[a.ciudad] || { lat: 25.6866, lng: -100.3161 };
      nodes.push({
        id_usuario: a.id_usuario,
        alias: a.alias,
        consentimiento: 'no',
        hasPreEtlSample: true,
        rawCiudad: a.ciudad || 'Monterrey',
        rawEstado: a.estado || 'Nuevo León',
        rawPais: a.pais || 'México',
        rawTz: a.zona_horaria || 'America/Monterrey',
        rawLat: a.latitud ? Number(a.latitud) : fallback.lat,
        rawLng: a.longitud ? Number(a.longitud) : fallback.lng,
        estatus: 'activo',
        plataforma: 'Twitter/X'
      });
    }

    for (const u of usersList) {
      if (nodes.some((n) => n.id_usuario === u.id_usuario)) continue;
      const noConsent = String(u.consentimiento_datos).toLowerCase() === 'no';
      const fallback = CITY_COORDS_FALLBACK[u.ciudad] || CITY_COORDS_FALLBACK['Mérida'];
      const hasCoords = u.latitud !== null && u.longitud !== null && u.latitud !== undefined;

      nodes.push({
        id_usuario: u.id_usuario,
        alias: u.alias,
        consentimiento: noConsent ? 'no' : 'si',
        hasPreEtlSample: false,
        rawCiudad: noConsent ? null : (u.ciudad || 'Mérida'),
        rawEstado: noConsent ? null : (u.estado || ''),
        rawPais: noConsent ? null : (u.pais || 'México'),
        rawTz: noConsent ? null : (u.zona_horaria || 'America/Mexico_City'),
        rawLat: noConsent ? null : (hasCoords ? Number(u.latitud) : fallback.lat),
        rawLng: noConsent ? null : (hasCoords ? Number(u.longitud) : fallback.lng),
        estatus: u.estatus,
        plataforma: u.plataforma_principal
      });
    }

    tacticalNodes = nodes;
    cachedAnonimosUsers = nodes.filter((n) => n.consentimiento === 'no');
    renderTacticalTargetList();
    renderAnonimosUnmappedTable();
    const firstDeployedIdx = nodes.findIndex((n) => n.consentimiento === 'si');
    selectTacticalTarget(firstDeployedIdx !== -1 ? firstDeployedIdx : 0, false);
  }

  function renderTacticalTargetList() {
    const listEl = document.getElementById('hudTargetSelectorList');
    if (!listEl) return;

    const filteredWithIndex = tacticalNodes
      .map((n, idx) => ({ n, idx }))
      .filter(({ n }) => {
        if (tacticalTargetFilter === 'deployed') return n.consentimiento === 'si';
        if (tacticalTargetFilter === 'undeployed') return n.consentimiento === 'no';
        return true;
      })
      .slice(0, 35);

    listEl.innerHTML = filteredWithIndex
      .map(({ n, idx }) => {
        const isAnon = n.consentimiento === 'no';
        const tagClass = isAnon ? 'blocked' : 'ok';
        const tagText = isAnon ? 'SIN DESPLEGAR' : 'EN MAPA';
        return `
          <button class="tactical-target-btn ${idx === tacticalSelectedIdx ? 'active' : ''}" data-tidx="${idx}">
            <span>${n.id_usuario} · ${n.alias}</span>
            <span class="t-shield-tag ${tagClass}">${tagText}</span>
          </button>
        `;
      })
      .join('');

    listEl.querySelectorAll('.tactical-target-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectTacticalTarget(Number(btn.getAttribute('data-tidx')), true);
      });
    });
  }

  function renderPrivacyComparisonForTarget(target) {
    const privacyBox = document.getElementById('privacyExampleBox');
    if (!privacyBox || !target) return;

    const antesObj = target.hasPreEtlSample && ejemploAnonimizacionCache?.antes
      ? ejemploAnonimizacionCache.antes
      : {
          id_usuario: target.id_usuario,
          alias: target.alias,
          consentimiento_datos: target.consentimiento,
          pais: target.consentimiento === 'no' ? '(Suprimido en ETL antes de carga SQL)' : target.rawPais,
          estado: target.consentimiento === 'no' ? '(Suprimido en ETL antes de carga SQL)' : target.rawEstado,
          ciudad: target.consentimiento === 'no' ? '(Suprimido en ETL antes de carga SQL)' : target.rawCiudad,
          latitud: target.consentimiento === 'no' ? '(Suprimido en ETL)' : target.rawLat,
          longitud: target.consentimiento === 'no' ? '(Suprimido en ETL)' : target.rawLng,
          zona_horaria: target.consentimiento === 'no' ? '(Suprimido en ETL)' : target.rawTz
        };

    const despuesObj = {
      id_usuario: target.id_usuario,
      alias: target.alias,
      consentimiento_datos: target.consentimiento,
      pais: target.consentimiento === 'no' ? 'Sin registro' : target.rawPais,
      estado: target.consentimiento === 'no' ? 'Sin registro' : target.rawEstado,
      ciudad: target.consentimiento === 'no' ? 'Sin registro' : target.rawCiudad,
      latitud: target.consentimiento === 'no' ? 'No encontrado' : target.rawLat,
      longitud: target.consentimiento === 'no' ? 'No encontrado' : target.rawLng,
      zona_horaria: target.consentimiento === 'no' ? 'Sin registro' : target.rawTz,
      estado_mapa: target.consentimiento === 'no' ? 'Sin desplegar (Ubicación no encontrada)' : 'Desplegado en mapa'
    };

    privacyBox.innerHTML = `
      <div>
        <strong>Auditoría de Ubicación del Objetivo Seleccionado (<code>${target.id_usuario} · ${target.alias}</code>)</strong>
      </div>
      <div class="privacy-compare">
        <div>
          <span>ANTES (Entrada al Pipeline ETL):</span>
          <pre>${JSON.stringify(antesObj, null, 2)}</pre>
        </div>
        <div>
          <span>DESPUÉS (Estado en Base de Datos y Geo-Radar):</span>
          <pre>${JSON.stringify(despuesObj, null, 2)}</pre>
        </div>
      </div>
    `;
  }

  function renderAnonimosUnmappedTable() {
    const tbody = document.getElementById('tableAnonimosUnmappedBody');
    if (!tbody) return;
    const q = (document.getElementById('inputFilterAnonimos')?.value || '').trim().toLowerCase();

    const filtered = cachedAnonimosUsers.filter((u) => {
      if (!q) return true;
      return (
        String(u.id_usuario).toLowerCase().includes(q) ||
        String(u.alias).toLowerCase().includes(q) ||
        String(u.plataforma).toLowerCase().includes(q)
      );
    });

    tbody.innerHTML = filtered
      .map(
        (u) => `
        <tr class="clickable-row" data-anonid="${u.id_usuario}">
          <td><code>${u.id_usuario}</code></td>
          <td><strong>${u.alias}</strong></td>
          <td>${u.plataforma}</td>
          <td><span class="badge-status inactivo">NO</span></td>
          <td><code>Sin registro</code></td>
          <td><code>No encontrado / Sin registro</code></td>
          <td><span class="tag-pill privacy-alert">SIN DESPLEGAR EN MAPA</span></td>
          <td><button class="btn-table-action" data-focusanon="${u.id_usuario}">Auditar en Radar ↑</button></td>
        </tr>
      `
      )
      .join('');

    tbody.querySelectorAll('tr.clickable-row').forEach((row) => {
      row.addEventListener('click', () => {
        const uid = row.getAttribute('data-anonid');
        const idx = tacticalNodes.findIndex((n) => n.id_usuario === uid);
        if (idx !== -1) {
          selectTacticalTarget(idx, true);
          document.querySelector('.tactical-hud-shell')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      });
    });
  }

  function selectTacticalTarget(idx, autoZoom = true) {
    if (!tacticalNodes.length) return;
    tacticalSelectedIdx = (idx + tacticalNodes.length) % tacticalNodes.length;
    const target = tacticalNodes[tacticalSelectedIdx];

    const isAnon = target.consentimiento === 'no';
    const canShowRawPreEtl = isAnon && !tacticalPostEtlShieldMode && target.hasPreEtlSample;
    const isShieldedNow = isAnon && !canShowRawPreEtl;

    document.querySelectorAll('.tactical-target-btn').forEach((b) => {
      b.classList.toggle('active', Number(b.getAttribute('data-tidx')) === tacticalSelectedIdx);
    });

    document.getElementById('hudTargetAlias').textContent = `${target.id_usuario} // ${target.alias.toUpperCase()}`;
    const lockEl = document.getElementById('hudLockStatus');
    const coordsEl = document.getElementById('hudCoordsText');
    const sectorEl = document.getElementById('hudSectorText');
    const tzEl = document.getElementById('hudTimezoneText');
    const alertBanner = document.getElementById('hudAlertBanner');
    const zoomBtn = document.getElementById('btnTacticalZoomToggle');

    if (isShieldedNow) {
      resetCameraToGlobal();
      lockEl.textContent = 'UBICACIÓN NO ENCONTRADA';
      lockEl.className = 'hud-status-text shielded';
      coordsEl.textContent = 'SIN REGISTRO DE COORDENADAS';
      sectorEl.textContent = 'NO ENCONTRADO / SIN REGISTRO';
      tzEl.textContent = 'SIN REGISTRO (PROTEGIDO)';
      alertBanner.className = 'hud-alert-banner shield-active';
      alertBanner.textContent = `PERFIL ANÓNIMO ${target.id_usuario} (${target.alias.toUpperCase()}) · UBICACIÓN NO ENCONTRADA / SIN REGISTRO EN EL SISTEMA`;
    } else {
      if (autoZoom) {
        camTargetLat = target.rawLat;
        camTargetLng = target.rawLng;
        camTargetZoom = 4.2;
        if (zoomBtn) zoomBtn.textContent = '🌐 RESTABLECER MAPA GLOBAL 1.0X';
      }
      const dmsLat = toDMS(target.rawLat, 'N', 'S');
      const dmsLng = toDMS(target.rawLng, 'E', 'W');

      if (canShowRawPreEtl) {
        lockEl.textContent = 'RAW GEODATA EXPOSED (PRE-ETL)';
        lockEl.className = 'hud-status-text exposed';
        coordsEl.textContent = `${dmsLat} · ${dmsLng}`;
        sectorEl.textContent = `${target.rawCiudad.toUpperCase()}, ${target.rawPais.toUpperCase()}`;
        tzEl.textContent = target.rawTz.toUpperCase();
        alertBanner.className = 'hud-alert-banner raw-warning';
        alertBanner.textContent = `ZOOM PRE-ETL: ${target.id_usuario} EN ${target.rawCiudad.toUpperCase()} (${dmsLat}, ${dmsLng})`;
      } else {
        lockEl.textContent = 'DESPLEGADO EN MAPA // LOCK';
        lockEl.className = 'hud-status-text locked';
        coordsEl.textContent = `${dmsLat} · ${dmsLng}`;
        sectorEl.textContent = `${target.rawCiudad.toUpperCase()}, ${target.rawPais.toUpperCase()}`;
        tzEl.textContent = target.rawTz.toUpperCase();
        alertBanner.className = 'hud-alert-banner';
        alertBanner.textContent = `ZOOM GEOGRÁFICO ACTIVO (${camTargetZoom.toFixed(1)}X) · ${target.rawCiudad.toUpperCase()}, ${target.rawPais.toUpperCase()} · ${dmsLat} | ${dmsLng}`;
      }
    }

    renderPrivacyComparisonForTarget(target);

    document.querySelectorAll('#hudTelemetryBars .wave-bar').forEach((bar) => {
      const randH = isShieldedNow ? Math.floor(12 + Math.random() * 18) : Math.floor(35 + Math.random() * 62);
      bar.style.height = `${randH}%`;
    });

    const vectorLog = document.getElementById('hudVectorLog');
    if (vectorLog) {
      const dmsLat = isShieldedNow ? 'SIN REGISTRO' : toDMS(target.rawLat, 'N', 'S');
      const dmsLng = isShieldedNow ? 'SIN REGISTRO' : toDMS(target.rawLng, 'E', 'W');
      vectorLog.innerHTML = `
        <div>OBJETIVO: ${target.id_usuario} (${target.alias})</div>
        <div>LAT (DMS): ${dmsLat}</div>
        <div>LON (DMS): ${dmsLng}</div>
        <div>DEC: ${isShieldedNow ? 'NO ENCONTRADO' : `${target.rawLat.toFixed(4)}°, ${target.rawLng.toFixed(4)}°`}</div>
        <div>ZOOM: ${camTargetZoom.toFixed(1)}X · ${target.plataforma.toUpperCase()}</div>
      `;
    }
  }

  function startTacticalCanvasLoop() {
    const canvas = document.getElementById('tacticalGeoCanvas');
    if (!canvas || tacticalAnimFrame) return;
    const ctx = canvas.getContext('2d');

    function renderFrame() {
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      // Interpolación suave de cámara (efecto de Zoom y Paneo hacia la ubicación)
      camCurLat += (camTargetLat - camCurLat) * 0.11;
      camCurLng += (camTargetLng - camCurLng) * 0.11;
      camCurZoom += (camTargetZoom - camCurZoom) * 0.11;

      const { minLng, maxLng, minLat, maxLat } = getCameraBounds();
      const lngStep = camCurZoom > 2.4 ? 10 : 30;
      const latStep = camCurZoom > 2.4 ? 10 : 20;

      // 1. Retícula cartográfica de Meridianos (Longitud) y Paralelos (Latitud) con Grados
      ctx.font = '9px Consolas, monospace';
      const firstLng = Math.ceil(minLng / lngStep) * lngStep;
      for (let lng = firstLng; lng <= maxLng; lng += lngStep) {
        const ptTop = latLngToCanvas(maxLat, lng, w, h);
        const ptBot = latLngToCanvas(minLat, lng, w, h);
        const isPrime = lng === 0;
        ctx.strokeStyle = isPrime ? 'rgba(6, 182, 212, 0.25)' : 'rgba(6, 182, 212, 0.09)';
        ctx.lineWidth = isPrime ? 1.2 : 1;
        ctx.beginPath();
        ctx.moveTo(ptTop.x, 28);
        ctx.lineTo(ptBot.x, h - 28);
        ctx.stroke();

        ctx.fillStyle = 'rgba(103, 232, 249, 0.65)';
        const lbl = lng === 0 ? '0°' : lng > 0 ? `${lng}°E` : `${Math.abs(lng)}°W`;
        ctx.fillText(lbl, ptTop.x - 13, 21);
      }

      const firstLat = Math.ceil(minLat / latStep) * latStep;
      for (let lat = firstLat; lat <= maxLat; lat += latStep) {
        const ptL = latLngToCanvas(lat, minLng, w, h);
        const isEq = lat === 0;
        ctx.strokeStyle = isEq ? 'rgba(6, 182, 212, 0.28)' : 'rgba(6, 182, 212, 0.09)';
        ctx.lineWidth = isEq ? 1.2 : 1;
        ctx.beginPath();
        ctx.moveTo(42, ptL.y);
        ctx.lineTo(w - 42, ptL.y);
        ctx.stroke();

        ctx.fillStyle = isEq ? 'rgba(103, 232, 249, 0.8)' : 'rgba(103, 232, 249, 0.55)';
        const latLbl = isEq ? '0° EQ' : lat > 0 ? `${lat}°N` : `${Math.abs(lat)}°S`;
        ctx.fillText(latLbl, 6, ptL.y + 3);
      }

      // 2. Continentes con recorte al marco cartográfico, textura Dot-Matrix y borde de costa
      ctx.save();
      ctx.beginPath();
      ctx.rect(42, 28, w - 84, h - 56);
      ctx.clip();

      const dotPattern = getDotMatrixPattern(ctx);
      for (const poly of TACTICAL_LAND_POLYGONS) {
        ctx.beginPath();
        poly.forEach(([lng, lat], i) => {
          const pt = latLngToCanvas(lat, lng, w, h);
          if (i === 0) ctx.moveTo(pt.x, pt.y);
          else ctx.lineTo(pt.x, pt.y);
        });
        ctx.closePath();

        ctx.fillStyle = dotPattern;
        ctx.fill();

        ctx.strokeStyle = 'rgba(6, 182, 212, 0.22)';
        ctx.lineWidth = 3;
        ctx.stroke();

        ctx.strokeStyle = 'rgba(34, 211, 238, 0.78)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }

      // 3. Puntos Geográficos Reales de los Usuarios Desplegados en el Mapa
      const currentTarget = tacticalNodes[tacticalSelectedIdx];
      tacticalNodes.forEach((node, idx) => {
        const isNodeAnon = node.consentimiento === 'no';
        const canPlotRaw = isNodeAnon && !tacticalPostEtlShieldMode && node.hasPreEtlSample;
        if (isNodeAnon && !canPlotRaw) return;
        if (node.rawLat === null || node.rawLng === null) return;

        const pt = latLngToCanvas(node.rawLat, node.rawLng, w, h);
        const isSelected = idx === tacticalSelectedIdx;

        // Anillo exterior estático de ubicación
        ctx.strokeStyle = isNodeAnon ? 'rgba(245, 158, 11, 0.55)' : 'rgba(16, 185, 129, 0.55)';
        ctx.lineWidth = isSelected ? 1.6 : 1;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, isSelected ? 11 : 6, 0, Math.PI * 2);
        ctx.stroke();

        // Punto central del nodo
        ctx.fillStyle = isNodeAnon ? '#f59e0b' : '#10b981';
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, isSelected ? 4.5 : 3, 0, Math.PI * 2);
        ctx.fill();

        // Si el mapa está en zoom (> 2x), mostrar el nombre de la ciudad junto a cada punto cercano
        if (camCurZoom > 2.0 && !isSelected && node.rawCiudad) {
          ctx.fillStyle = 'rgba(209, 213, 219, 0.72)';
          ctx.font = '9px Consolas, monospace';
          ctx.fillText(node.rawCiudad, pt.x + 8, pt.y + 3);
        }
      });

      // 4. Mira Geográfica Fija y Ficha de Coordenadas (Latitud, Longitud, Grados DMS) sobre el Punto Seleccionado
      const isTargetAnon = currentTarget && currentTarget.consentimiento === 'no';
      const canShowRawPreEtl = isTargetAnon && !tacticalPostEtlShieldMode && currentTarget.hasPreEtlSample;
      const isShieldedNow = isTargetAnon && !canShowRawPreEtl;

      if (currentTarget && !isShieldedNow && currentTarget.rawLat !== null) {
        const targetPt = latLngToCanvas(currentTarget.rawLat, currentTarget.rawLng, w, h);
        reticleCurrent.x += (targetPt.x - reticleCurrent.x) * 0.25;
        reticleCurrent.y += (targetPt.y - reticleCurrent.y) * 0.25;
        const rx = reticleCurrent.x;
        const ry = reticleCurrent.y;
        const mainColor = isTargetAnon ? '#f59e0b' : '#06b6d4';

        // Líneas de referencia ortogonales hacia las reglas de grados
        ctx.strokeStyle = 'rgba(6, 182, 212, 0.32)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(42, ry);
        ctx.lineTo(w - 42, ry);
        ctx.moveTo(rx, 28);
        ctx.lineTo(rx, h - 28);
        ctx.stroke();
        ctx.setLineDash([]);

        // Mira circular de precisión geográfica (estática y limpia)
        ctx.strokeStyle = mainColor;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(rx, ry, 26, 0, Math.PI * 2);
        ctx.stroke();

        ctx.lineWidth = 1.2;
        ctx.strokeRect(rx - 14, ry - 14, 28, 28);

        // Tarjeta de Telemetría Geográfica con Latitud, Longitud y Grados DMS
        const dmsLat = toDMS(currentTarget.rawLat, 'N', 'S');
        const dmsLng = toDMS(currentTarget.rawLng, 'E', 'W');
        const cardW = 264;
        const cardH = 82;
        const boxX = rx + cardW + 50 > w ? rx - cardW - 34 : rx + 34;
        const boxY = Math.max(36, Math.min(h - cardH - 36, ry - 40));

        ctx.fillStyle = 'rgba(6, 10, 18, 0.94)';
        ctx.strokeStyle = mainColor;
        ctx.lineWidth = 1.4;
        ctx.fillRect(boxX, boxY, cardW, cardH);
        ctx.strokeRect(boxX, boxY, cardW, cardH);

        ctx.fillStyle = '#f3f4f6';
        ctx.font = 'bold 11px Consolas, monospace';
        ctx.fillText(
          `${currentTarget.id_usuario} · ${currentTarget.alias} (${currentTarget.plataforma})`,
          boxX + 10,
          boxY + 18
        );

        ctx.fillStyle = mainColor;
        ctx.font = 'bold 10px Consolas, monospace';
        ctx.fillText(
          `UBICACIÓN: ${currentTarget.rawCiudad.toUpperCase()}, ${currentTarget.rawPais.toUpperCase()}`,
          boxX + 10,
          boxY + 35
        );

        ctx.fillStyle = '#e5e7eb';
        ctx.font = '10px Consolas, monospace';
        ctx.fillText(
          `GRADOS: ${dmsLat} | ${dmsLng}`,
          boxX + 10,
          boxY + 52
        );

        ctx.fillStyle = '#9ca3af';
        ctx.fillText(
          `DECIMAL: ${currentTarget.rawLat.toFixed(4)}°, ${currentTarget.rawLng.toFixed(4)}° · ZOOM ${camCurZoom.toFixed(1)}X`,
          boxX + 10,
          boxY + 69
        );
      } else if (currentTarget && isShieldedNow) {
        // Indicador central fijo cuando el usuario seleccionado es Anónimo (Sin Desplegar en el Mapa)
        const boxW = 330;
        const boxH = 66;
        const bx = w * 0.5 - boxW * 0.5;
        const by = h * 0.5 - boxH * 0.5;

        ctx.fillStyle = 'rgba(15, 7, 12, 0.92)';
        ctx.strokeStyle = '#f43f5e';
        ctx.lineWidth = 1.5;
        ctx.fillRect(bx, by, boxW, boxH);
        ctx.strokeRect(bx, by, boxW, boxH);

        ctx.fillStyle = '#fda4af';
        ctx.font = 'bold 11px Consolas, monospace';
        ctx.fillText(
          `OBJETIVO ${currentTarget.id_usuario} (${currentTarget.alias.toUpperCase()}) · NO ENCONTRADO`,
          bx + 14,
          by + 24
        );
        ctx.fillStyle = '#f3f4f6';
        ctx.font = '10px Consolas, monospace';
        ctx.fillText(
          'UBICACIÓN: SIN REGISTRO GEOLOCALIZADO EN EL SISTEMA',
          bx + 14,
          by + 45
        );
      }

      ctx.restore();

      // Actualizar indicador superior de Zoom / Centro de Cámara
      const azEl = document.getElementById('hudAzimuthVal');
      if (azEl) {
        azEl.textContent = `ZOOM ${camCurZoom.toFixed(1)}X (${camCurLat.toFixed(1)}°, ${camCurLng.toFixed(1)}°)`;
      }

      tacticalAnimFrame = requestAnimationFrame(renderFrame);
    }

    canvas.addEventListener('click', (e) => {
      const rect = canvas.getBoundingClientRect();
      const clickX = ((e.clientX - rect.left) / rect.width) * canvas.width;
      const clickY = ((e.clientY - rect.top) / rect.height) * canvas.height;

      let bestIdx = -1;
      let bestDist = 28;
      tacticalNodes.forEach((node, idx) => {
        if (node.consentimiento === 'no' && (tacticalPostEtlShieldMode || !node.hasPreEtlSample)) return;
        if (node.rawLat === null || node.rawLng === null) return;
        const pt = latLngToCanvas(node.rawLat, node.rawLng, canvas.width, canvas.height);
        const dist = Math.hypot(pt.x - clickX, pt.y - clickY);
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = idx;
        }
      });

      if (bestIdx !== -1) {
        selectTacticalTarget(bestIdx, true);
      } else if (camTargetZoom > 1.2) {
        resetCameraToGlobal();
      }
    });

    tacticalAnimFrame = requestAnimationFrame(renderFrame);
  }

  // =========================================================
  // NAVEGACIÓN DE CATEGORÍAS Y SUBAPARTADOS
  // =========================================================
  function switchCategory(categoryId) {
    document.querySelectorAll('.cat-tab-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-category') === categoryId);
    });
    document.querySelectorAll('.category-pane').forEach((pane) => {
      pane.classList.toggle('active', pane.id === categoryId);
    });
    resizeAllCharts();
  }

  function switchRealtimeSubtab(subtabId) {
    const kpisPane = document.getElementById('rt-sub-kpis');
    const chartsStage = document.getElementById('rt-charts-stage');
    const cardBars = document.getElementById('cardChartBars');
    const cardDonut = document.getElementById('cardChartDonut');
    const cardHeatmap = document.getElementById('cardChartHeatmap');

    if (subtabId === 'rt-sub-kpis') {
      kpisPane.classList.add('active');
      chartsStage.classList.add('hidden');
      chartsStage.className = 'rt-charts-stage hidden';
    } else {
      kpisPane.classList.remove('active');
      chartsStage.classList.remove('hidden');

      if (subtabId === 'rt-sub-all') {
        chartsStage.className = 'rt-charts-stage grid-all';
        cardBars.classList.remove('hidden');
        cardDonut.classList.remove('hidden');
        cardHeatmap.classList.remove('hidden');
      } else {
        chartsStage.className = 'rt-charts-stage single-stage';
        cardBars.classList.toggle('hidden', subtabId !== 'rt-sub-bars');
        cardDonut.classList.toggle('hidden', subtabId !== 'rt-sub-donut');
        cardHeatmap.classList.toggle('hidden', subtabId !== 'rt-sub-heatmap');
      }
    }
    resizeAllCharts();
  }

  function initNavigationEvents() {
    document.querySelectorAll('.cat-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        switchCategory(btn.getAttribute('data-category'));
      });
    });

    document.querySelectorAll('.subtab-bar').forEach((bar) => {
      const parentCategory = bar.getAttribute('data-parent');
      bar.querySelectorAll('.subtab-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          bar.querySelectorAll('.subtab-btn').forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
          const subtabId = btn.getAttribute('data-subtab');

          if (parentCategory === 'cat-realtime') {
            switchRealtimeSubtab(subtabId);
            return;
          }

          if (parentCategory === 'cat-vista360') {
            document.getElementById('vista360Container').setAttribute('data-view-mode', subtabId);
            return;
          }

          const parentEl = document.getElementById(parentCategory);
          parentEl.querySelectorAll('.subtab-pane').forEach((pane) => {
            pane.classList.toggle('active', pane.id === subtabId);
          });
          resizeAllCharts();
        });
      });
    });

    document.getElementById('btnTacticalZoomToggle')?.addEventListener('click', () => {
      if (camTargetZoom > 1.2) {
        resetCameraToGlobal();
      } else {
        selectTacticalTarget(tacticalSelectedIdx, true);
      }
    });

    document.getElementById('btnTacticalModeBefore')?.addEventListener('click', (e) => {
      tacticalPostEtlShieldMode = false;
      e.currentTarget.classList.add('active');
      document.getElementById('btnTacticalModeAfter')?.classList.remove('active');
      selectTacticalTarget(0, true);
    });

    document.getElementById('btnTacticalModeAfter')?.addEventListener('click', (e) => {
      tacticalPostEtlShieldMode = true;
      e.currentTarget.classList.add('active');
      document.getElementById('btnTacticalModeBefore')?.classList.remove('active');
      selectTacticalTarget(tacticalSelectedIdx, true);
    });

    document.getElementById('btnTacticalCycleTarget')?.addEventListener('click', () => {
      selectTacticalTarget(tacticalSelectedIdx + 1, true);
    });

    document.querySelectorAll('.t-filter-btn[data-tfilter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.t-filter-btn[data-tfilter]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        tacticalTargetFilter = btn.getAttribute('data-tfilter');
        renderTacticalTargetList();
      });
    });

    document.getElementById('inputFilterAnonimos')?.addEventListener('input', renderAnonimosUnmappedTable);
  }

  // =========================================================
  // ACTUALIZACIÓN EN TIEMPO REAL (WEBSOCKETS)
  // =========================================================
  function updateRealtimeUI(payload) {
    if (!payload || !payload.kpis) return;
    ensureChartsInitialized();

    const { kpis, series, recentInteractions, evento } = payload;

    document.getElementById('badgeNavTotalInter').textContent = kpis.totalInteracciones.toLocaleString('es-MX');
    document.getElementById('badgeNavRiesgo').textContent = `${kpis.indiceRiesgoAbandono}%`;

    document.getElementById('kpiTotalInteracciones').textContent = kpis.totalInteracciones.toLocaleString('es-MX');
    document.getElementById('kpiPromedioInteracciones').textContent =
      `${kpis.promedioInteraccionesParticipante} prom. por participante (${kpis.promedioInteraccionesGlobal} global)`;

    document.getElementById('kpiTasaParticipacion').textContent = `${kpis.tasaParticipacionActiva}%`;
    document.getElementById('kpiUsuariosActivos').textContent =
      `${kpis.usuariosActivos.toLocaleString('es-MX')} activos de ${kpis.totalUsuarios.toLocaleString('es-MX')} registrados`;
    document.getElementById('barKpiTpa').style.width = `${Math.min(100, kpis.tasaParticipacionActiva)}%`;

    document.getElementById('kpiIndiceRiesgo').textContent = `${kpis.indiceRiesgoAbandono}%`;
    document.getElementById('kpiDesgloseRiesgo').textContent =
      `${kpis.usuariosEnRiesgo} en riesgo (${kpis.porcentajeEnRiesgo}%) · ${kpis.usuariosInactivos} inactivos`;
    document.getElementById('barKpiIra').style.width = `${Math.min(100, kpis.indiceRiesgoAbandono)}%`;

    document.getElementById('kpiUsuariosConInteraccion').textContent =
      kpis.usuariosConInteraccion.toLocaleString('es-MX');
    document.getElementById('kpiTasaInteraccionDirecta').textContent =
      `${kpis.tasaInteraccionDirecta}% cobertura activa`;
    document.getElementById('barKpiDirecta').style.width = `${Math.min(100, kpis.tasaInteraccionDirecta)}%`;

    document.getElementById('kpiSentimientoPromedio').textContent = kpis.sentimientoPromedioInteracciones;
    document.getElementById('kpiTotalReacciones').textContent =
      `${kpis.totalReaccionesRecibidas.toLocaleString('es-MX')} reacciones recibidas`;
    const sentPercent = Math.min(100, Math.max(0, ((Number(kpis.sentimientoPromedioInteracciones) + 1) / 2) * 100));
    document.getElementById('barKpiSent').style.width = `${sentPercent}%`;

    document.getElementById('kpiTotalUsuariosSql').textContent = kpis.totalUsuarios.toLocaleString('es-MX');
    document.getElementById('kpiPromedioGlobal').textContent =
      `${kpis.promedioInteraccionesGlobal} interacciones / usuario`;

    const pillCobertura = document.getElementById('kpiPillCobertura');
    if (pillCobertura) pillCobertura.textContent = `${kpis.tasaInteraccionDirecta}%`;

    const pillSent = document.getElementById('kpiPillSentimiento');
    if (pillSent) {
      const sVal = Number(kpis.sentimientoPromedioInteracciones);
      pillSent.textContent = sVal >= 0.15 ? 'Positivo' : sVal <= -0.1 ? 'Negativo' : 'Neutral';
    }

    // Actualizar Barra Ejecutiva de Balance de Comunidad y Tendencias
    const totalU = Math.max(1, Number(kpis.totalUsuarios || 1));
    const pAct = ((Number(kpis.usuariosActivos || 0) / totalU) * 100).toFixed(1);
    const pRie = ((Number(kpis.usuariosEnRiesgo || 0) / totalU) * 100).toFixed(1);
    const pIna = ((Number(kpis.usuariosInactivos || 0) / totalU) * 100).toFixed(1);

    const segAct = document.getElementById('healthSegActivo');
    const segRie = document.getElementById('healthSegRiesgo');
    const segIna = document.getElementById('healthSegInactivo');
    if (segAct) segAct.style.width = `${pAct}%`;
    if (segRie) segRie.style.width = `${pRie}%`;
    if (segIna) segIna.style.width = `${pIna}%`;

    const legendEl = document.getElementById('pulseHealthLegend');
    if (legendEl) {
      legendEl.innerHTML = `
        <span class="pulse-legend-item"><i class="legend-dot emerald"></i> Activos: <strong>${kpis.usuariosActivos}</strong> (${pAct}%)</span>
        <span class="pulse-legend-item"><i class="legend-dot amber"></i> En Riesgo: <strong>${kpis.usuariosEnRiesgo}</strong> (${pRie}%)</span>
        <span class="pulse-legend-item"><i class="legend-dot rose"></i> Inactivos: <strong>${kpis.usuariosInactivos}</strong> (${pIna}%)</span>
      `;
    }

    const topPlat = series.barrasPlataforma?.[0];
    const topTipo = series.donaTipoInteraccion?.[0];
    const topTema = series.temasInteraccion?.[0];
    const hiChan = document.getElementById('hiTopChannel');
    const hiType = document.getElementById('hiTopType');
    const hiTop = document.getElementById('hiTopTopic');
    if (hiChan && topPlat) hiChan.textContent = `${topPlat.plataforma} (${topPlat.porcentaje}%)`;
    if (hiType && topTipo) hiType.textContent = `${topTipo.tipo} (${topTipo.porcentaje}%)`;
    if (hiTop && topTema) hiTop.textContent = `${topTema.tema} (${topTema.porcentaje}%)`;

    if (evento) {
      const op = String(evento.operacion || 'SNAPSHOT').toUpperCase();
      const badge = document.getElementById('eventBadge');
      const desc = document.getElementById('eventDescription');
      const timeEl = document.getElementById('eventTime');
      const logBox = document.getElementById('liveEventLog');

      badge.className = `event-badge ${op.toLowerCase()}`;
      badge.textContent = op;

      if (['POST', 'PUT', 'DELETE'].includes(op)) {
        desc.textContent = `${evento.id_interaccion || ''} · Usuario ${evento.id_usuario || ''} · ${evento.canal || ''} (${evento.tipo || ''})`;
        logBox.classList.remove('pulse-update');
        void logBox.offsetWidth;
        logBox.classList.add('pulse-update');
      } else {
        desc.textContent = 'Indicadores sincronizados en tiempo real';
      }

      const d = evento.timestamp ? new Date(evento.timestamp) : new Date();
      timeEl.textContent = d.toLocaleTimeString('es-MX');
    }

    const streamBody = document.getElementById('tableRecentStreamBody');
    if (streamBody && Array.isArray(recentInteractions)) {
      streamBody.innerHTML = recentInteractions
        .map(
          (item) => `
          <tr class="clickable-row" data-userid="${item.id_usuario}">
            <td><code>${item.id_interaccion}</code></td>
            <td><strong>${item.id_usuario}</strong></td>
            <td>${item.canal}</td>
            <td><span class="tag-pill">${item.tipo}</span></td>
            <td>${item.tema}</td>
            <td>${item.sentimiento}</td>
            <td>${item.timestamp}</td>
          </tr>
        `
        )
        .join('');

      streamBody.querySelectorAll('tr.clickable-row').forEach((row) => {
        row.addEventListener('click', () => {
          const uid = row.getAttribute('data-userid');
          switchCategory('cat-vista360');
          loadVista360(uid);
        });
      });

      const quickBox = document.getElementById('dynamicQuickUsers');
      if (quickBox && recentInteractions.length > 0) {
        const uniqueUsers = [...new Set(recentInteractions.map((r) => r.id_usuario))].slice(0, 4);
        quickBox.innerHTML = uniqueUsers
          .map((uid) => `<button class="btn-chip" data-userid="${uid}">${uid}</button>`)
          .join('');
        quickBox.querySelectorAll('.btn-chip').forEach((btn) => {
          btn.addEventListener('click', () => {
            document.getElementById('inputVista360').value = '';
            loadVista360(btn.getAttribute('data-userid'));
          });
        });

        if (!activeVista360Id && uniqueUsers[0]) {
          loadVista360(uniqueUsers[0]);
        }
      }
    }

    const temasBox = document.getElementById('liveTemasBreakdown');
    if (temasBox && Array.isArray(series.temasInteraccion)) {
      temasBox.innerHTML = series.temasInteraccion
        .map(
          (t) => `
          <div class="metric-bar-item">
            <div class="metric-bar-top">
              <strong>${t.tema}</strong>
              <span>${t.total} interacciones (${t.porcentaje}%)</span>
            </div>
            <div class="kpi-progress">
              <div class="kpi-progress-fill cyan" style="width: ${Math.min(100, t.porcentaje * 2.2)}%"></div>
            </div>
          </div>
        `
        )
        .join('');
    }

    const barrasData = series.barrasPlataforma || [];
    document.getElementById('summaryPillsBars').innerHTML = barrasData
      .map((d) => `<span class="stat-chip">${d.plataforma}: <strong>${d.total}</strong> (${d.porcentaje}%)</span>`)
      .join('');

    chartRealtimeBars.setOption({
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#16161d',
        borderColor: '#23232e',
        textStyle: { color: '#f3f4f6' },
        formatter: (params) => {
          const p = params[0];
          const item = barrasData[p.dataIndex];
          return `<strong>${p.name}</strong><br/>Interacciones: ${p.value} (${item?.porcentaje || 0}%)`;
        }
      },
      grid: { left: '5%', right: '4%', top: '10%', bottom: '12%', containLabel: true },
      xAxis: {
        type: 'category',
        data: barrasData.map((d) => d.plataforma),
        axisLine: { lineStyle: { color: '#2b2b38' } },
        axisLabel: { color: '#d1d5db', fontSize: 12, fontWeight: 600 }
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: '#1b1b24' } },
        axisLabel: { color: '#9ca3af' }
      },
      series: [
        {
          name: 'Interacciones',
          type: 'bar',
          barWidth: '46%',
          data: barrasData.map((d) => d.total),
          itemStyle: {
            borderRadius: [7, 7, 0, 0],
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: '#06b6d4' },
              { offset: 1, color: '#3b82f6' }
            ])
          },
          label: {
            show: true,
            position: 'top',
            color: '#f3f4f6',
            fontWeight: 700,
            fontSize: 12
          }
        }
      ]
    });

    const donaData = series.donaTipoInteraccion || [];
    document.getElementById('summaryPillsDonut').innerHTML = donaData
      .map((d) => `<span class="stat-chip">${d.tipo}: <strong>${d.total}</strong> (${d.porcentaje}%)</span>`)
      .join('');

    chartRealtimeDonut.setOption({
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'item',
        backgroundColor: '#16161d',
        borderColor: '#23232e',
        textStyle: { color: '#f3f4f6' },
        formatter: '{b}: <strong>{c}</strong> ({d}%)'
      },
      legend: {
        bottom: 4,
        textStyle: { color: '#d1d5db', fontSize: 12 }
      },
      color: ['#3b82f6', '#06b6d4', '#10b981', '#f59e0b', '#8b5cf6'],
      series: [
        {
          name: 'Tipo de Interacción',
          type: 'pie',
          radius: ['45%', '73%'],
          center: ['50%', '45%'],
          avoidLabelOverlap: true,
          itemStyle: {
            borderColor: '#121218',
            borderWidth: 3,
            borderRadius: 6
          },
          label: {
            color: '#e5e7eb',
            formatter: '{b}\n{d}%'
          },
          data: donaData.map((d) => ({
            name: d.tipo,
            value: d.total
          }))
        }
      ]
    });

    const hm = series.heatmap || { plataformas: [], tipos: [], matrix: [], max: 10 };
    chartRealtimeHeatmap.setOption({
      backgroundColor: 'transparent',
      tooltip: {
        position: 'top',
        backgroundColor: '#16161d',
        borderColor: '#23232e',
        textStyle: { color: '#f3f4f6' },
        formatter: (p) => {
          const plat = hm.plataformas[p.data[0]];
          const tipo = hm.tipos[p.data[1]];
          return `<strong>${plat}</strong> · <em>${tipo}</em><br/>Intensidad: <strong>${p.data[2]}</strong> interacciones`;
        }
      },
      grid: { left: '10%', right: '6%', top: '8%', bottom: '16%', containLabel: true },
      xAxis: {
        type: 'category',
        data: hm.plataformas,
        splitArea: { show: true, areaStyle: { color: ['rgba(255,255,255,0.01)', 'rgba(255,255,255,0.02)'] } },
        axisLabel: { color: '#d1d5db', fontWeight: 600 }
      },
      yAxis: {
        type: 'category',
        data: hm.tipos,
        splitArea: { show: true },
        axisLabel: { color: '#9ca3af' }
      },
      visualMap: {
        min: 0,
        max: Math.max(1, hm.max),
        calculable: true,
        orient: 'horizontal',
        left: 'center',
        bottom: 0,
        textStyle: { color: '#9ca3af' },
        inRange: {
          color: ['#111827', '#1e3a8a', '#0284c7', '#06b6d4', '#10b981']
        }
      },
      series: [
        {
          name: 'Intensidad',
          type: 'heatmap',
          data: hm.matrix,
          label: {
            show: true,
            color: '#f9fafb',
            fontWeight: 700
          },
          emphasis: {
            itemStyle: {
              shadowBlur: 10,
              shadowColor: 'rgba(0, 0, 0, 0.6)'
            }
          }
        }
      ]
    });

    resizeAllCharts();
  }

  // =========================================================
  // TABLAS CON FILTROS REACTIVOS
  // =========================================================
  function renderRiesgoTable() {
    const tbodyRiesgo = document.getElementById('tableRiesgoBody');
    const searchTerm = (document.getElementById('inputFilterRiesgo')?.value || '').trim().toLowerCase();

    const filtered = cachedRiesgoUsers.filter((u) => {
      const noConsent = String(u.consentimiento_datos).toLowerCase() === 'no';
      if (currentRiesgoFilter === 'anonimizados' && !noConsent) return false;
      if (currentRiesgoFilter === 'con-ubicacion' && noConsent) return false;
      if (!searchTerm) return true;
      return (
        String(u.id_usuario).toLowerCase().includes(searchTerm) ||
        String(u.alias).toLowerCase().includes(searchTerm) ||
        String(u.plataforma_principal).toLowerCase().includes(searchTerm) ||
        String(u.interes_principal).toLowerCase().includes(searchTerm)
      );
    });

    tbodyRiesgo.innerHTML = filtered
      .map((u) => {
        const noConsent = String(u.consentimiento_datos).toLowerCase() === 'no';
        const ubicacionCell = noConsent
          ? '<span class="tag-pill privacy-alert">Ubicación Protegida</span>'
          : `${u.ciudad || 'N/A'}, ${u.pais || ''}`;

        return `
          <tr class="clickable-row" data-userid="${u.id_usuario}">
            <td><code>${u.id_usuario}</code></td>
            <td><strong>${u.alias}</strong></td>
            <td>${u.plataforma_principal}</td>
            <td>${u.interes_principal}</td>
            <td><span class="badge-status ${u.estatus}">${u.estatus}</span></td>
            <td>${u.mensajes_30d} msg · ${u.reacciones_30d} reacc</td>
            <td>${u.sentimiento_promedio}</td>
            <td>${ubicacionCell}</td>
            <td><strong>${u.indice_riesgo}%</strong></td>
            <td><button class="btn-table-action" data-open360="${u.id_usuario}">Ver 360° →</button></td>
          </tr>
        `;
      })
      .join('');

    tbodyRiesgo.querySelectorAll('tr.clickable-row').forEach((row) => {
      row.addEventListener('click', () => {
        const id = row.getAttribute('data-userid');
        document.getElementById('inputVista360').value = '';
        switchCategory('cat-vista360');
        loadVista360(id);
      });
    });
  }

  function renderCuarentenaTable() {
    const tbodyCuarentena = document.getElementById('tableCuarentenaBody');
    const q = (document.getElementById('inputFilterCuarentena')?.value || '').trim().toLowerCase();

    const filtered = cachedCuarentenaRows.filter((r) => {
      if (!q) return true;
      return (
        String(r.id_registro || '').toLowerCase().includes(q) ||
        String(r.id_usuario || '').toLowerCase().includes(q) ||
        String(r.motivo_rechazo || '').toLowerCase().includes(q)
      );
    });

    tbodyCuarentena.innerHTML = filtered
      .map(
        (r) => `
        <tr>
          <td><code>${r.id_registro || 'N/A'}</code></td>
          <td><code>${r.id_usuario || 'N/A'}</code></td>
          <td>${r.origen}</td>
          <td><span class="tag-pill privacy-alert">${r.motivo_rechazo}</span></td>
          <td>#${r.linea_csv || '-'}</td>
        </tr>
      `
      )
      .join('');
  }

  // =========================================================
  // ANALÍTICA HISTÓRICA + CARGA DE NODOS ORBITALES
  // =========================================================
  async function loadHistoricalAnalytics() {
    ensureChartsInitialized();
    const [histData, cuarentenaData, usersGeoData] = await Promise.all([
      apiFetch('/api/analytics/historical'),
      apiFetch('/api/cuarentena?limit=60'),
      apiFetch('/api/usuarios?limit=150')
    ]);

    const intereses = histData.topIntereses || [];
    chartHistoricalInterests.setOption({
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        backgroundColor: '#16161d',
        borderColor: '#23232e',
        textStyle: { color: '#f3f4f6' }
      },
      grid: { left: '4%', right: '7%', top: '6%', bottom: '8%', containLabel: true },
      xAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: '#1b1b24' } },
        axisLabel: { color: '#9ca3af' }
      },
      yAxis: {
        type: 'category',
        inverse: true,
        data: intereses.map((i) => i.interes),
        axisLabel: { color: '#d1d5db', fontSize: 12, fontWeight: 600 }
      },
      series: [
        {
          name: 'Total Usuarios',
          type: 'bar',
          data: intereses.map((i) => i.totalUsuarios),
          itemStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
              { offset: 0, color: '#6366f1' },
              { offset: 1, color: '#8b5cf6' }
            ]),
            borderRadius: [0, 6, 6, 0]
          },
          label: {
            show: true,
            position: 'right',
            color: '#e5e7eb',
            fontWeight: 700
          }
        }
      ]
    });

    document.getElementById('tableInterestsDetailBody').innerHTML = intereses
      .map(
        (i) => `
        <tr>
          <td><strong>${i.interes}</strong></td>
          <td>${i.totalUsuarios}</td>
          <td><span class="badge-status activo">${i.activos}</span></td>
          <td><span class="badge-status en_riesgo">${i.enRiesgo}</span></td>
          <td><code>${i.sentimientoPromedio}</code></td>
        </tr>
      `
      )
      .join('');

    const rawPlatStatus = histData.usuariosPorPlataformaEstado || [];
    const plataformasSet = [...new Set(rawPlatStatus.map((r) => r.plataforma))];
    const estatusList = ['activo', 'en_riesgo', 'inactivo'];
    const colorsMap = {
      activo: '#10b981',
      en_riesgo: '#f59e0b',
      inactivo: '#f43f5e'
    };

    const statusSeries = estatusList.map((est) => ({
      name: est,
      type: 'bar',
      stack: 'total',
      emphasis: { focus: 'series' },
      itemStyle: { color: colorsMap[est] },
      data: plataformasSet.map((plat) => {
        const found = rawPlatStatus.find((r) => r.plataforma === plat && r.estatus === est);
        return found ? found.total : 0;
      })
    }));

    chartHistoricalPlatformStatus.setOption({
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        backgroundColor: '#16161d',
        borderColor: '#23232e',
        textStyle: { color: '#f3f4f6' }
      },
      legend: {
        top: 0,
        textStyle: { color: '#d1d5db' }
      },
      grid: { left: '5%', right: '5%', top: '14%', bottom: '10%', containLabel: true },
      xAxis: {
        type: 'category',
        data: plataformasSet,
        axisLabel: { color: '#d1d5db', fontSize: 12, fontWeight: 600 }
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: '#1b1b24' } },
        axisLabel: { color: '#9ca3af' }
      },
      series: statusSeries
    });

    document.getElementById('tablePlatformStatusSummaryBody').innerHTML = plataformasSet
      .map((plat) => {
        const act = rawPlatStatus.find((r) => r.plataforma === plat && r.estatus === 'activo')?.total || 0;
        const rie = rawPlatStatus.find((r) => r.plataforma === plat && r.estatus === 'en_riesgo')?.total || 0;
        const ina = rawPlatStatus.find((r) => r.plataforma === plat && r.estatus === 'inactivo')?.total || 0;
        const tot = act + rie + ina;
        const ret = tot > 0 ? ((act / tot) * 100).toFixed(1) : '0.0';
        return `
          <tr>
            <td><strong>${plat}</strong></td>
            <td><span class="badge-status activo">${act}</span></td>
            <td><span class="badge-status en_riesgo">${rie}</span></td>
            <td><span class="badge-status inactivo">${ina}</span></td>
            <td><strong>${tot}</strong></td>
            <td><code>${ret}%</code></td>
          </tr>
        `;
      })
      .join('');

    cachedRiesgoUsers = histData.usuariosEnRiesgo || [];
    renderRiesgoTable();

    // Actualizar contadores de privacidad en el HUD orbital
    const privRes = histData.privacidadResumen || [];
    const yesRow = privRes.find((r) => String(r.consentimiento).toLowerCase() === 'si');
    const noRow = privRes.find((r) => String(r.consentimiento).toLowerCase() === 'no');
    if (yesRow) {
      document.getElementById('hudConsentYesCount').textContent = yesRow.total.toLocaleString('es-MX');
      document.getElementById('hudActiveNodesCount').textContent = yesRow.total.toLocaleString('es-MX');
    }
    if (noRow) {
      document.getElementById('hudConsentNoCount').textContent = noRow.total.toLocaleString('es-MX');
      document.getElementById('hudShieldedNodesCount').textContent = noRow.total.toLocaleString('es-MX');
    }

    const ultima = histData.calidadEtl?.ultimaEjecucion;
    const summaryContainer = document.getElementById('etlSummaryMetrics');
    const privacyBox = document.getElementById('privacyExampleBox');

    if (ultima && ultima.totales_globales) {
      const tg = ultima.totales_globales;
      const avd = ultima.antes_vs_despues;
      document.getElementById('badgeNavCuarentena').textContent = tg.en_cuarentena.toLocaleString('es-MX');
      document.getElementById('etlRunBadgeId').textContent = `Procesado en ${ultima.duracion_ms} ms`;

      summaryContainer.innerHTML = `
        <div class="mini-stat">
          <span>Registros Recibidos</span>
          <strong>${tg.recibidos.toLocaleString('es-MX')}</strong>
        </div>
        <div class="mini-stat">
          <span>Registros Válidos</span>
          <strong>${tg.aceptados.toLocaleString('es-MX')}</strong>
        </div>
        <div class="mini-stat">
          <span>Registros en Cuarentena</span>
          <strong>${tg.en_cuarentena.toLocaleString('es-MX')}</strong>
        </div>
        <div class="mini-stat">
          <span>Perfiles Anonimizados</span>
          <strong>${avd?.usuarios?.anonimizados_sin_consentimiento ?? 0}</strong>
        </div>
        <div class="mini-stat">
          <span>Relaciones de Interés</span>
          <strong>${avd?.usuarios?.intereses_normalizados_sql ?? 0}</strong>
        </div>
        <div class="mini-stat">
          <span>Eventos Huérfanos</span>
          <strong>${avd?.interacciones?.huerfanos_integridad_referencial ?? 0}</strong>
        </div>
      `;

      if (ultima.ejemplo_anonimizacion) {
        ejemploAnonimizacionCache = ultima.ejemplo_anonimizacion;
        privacyBox.innerHTML = `
          <div><strong>Comparativa de Supresión de Ubicación por Consentimiento</strong></div>
          <div class="privacy-compare">
            <div>
              <span>ANTES (Datos de Entrada):</span>
              <pre>${JSON.stringify(ultima.ejemplo_anonimizacion.antes, null, 2)}</pre>
            </div>
            <div>
              <span>DESPUÉS (Registro Anonimizado):</span>
              <pre>${JSON.stringify(ultima.ejemplo_anonimizacion.despues, null, 2)}</pre>
            </div>
          </div>
        `;
      }
    }

    buildTacticalNodes(usersGeoData.usuarios || [], ejemploAnonimizacionCache);
    startTacticalCanvasLoop();

    const motivos = histData.calidadEtl?.porMotivo || {};
    document.getElementById('cuarentenaReasonsBox').innerHTML = Object.entries(motivos)
      .map(
        ([motivo, count]) =>
          `<span class="tag-pill privacy-alert">${motivo}: <strong>${count}</strong></span>`
      )
      .join('');

    cachedCuarentenaRows = cuarentenaData.registros || [];
    renderCuarentenaTable();
    resizeAllCharts();
  }

  // =========================================================
  // EXPEDIENTE VISTA 360°
  // =========================================================
  async function loadVista360(idUsuario) {
    const cleanId = String(idUsuario || '').trim().toUpperCase();
    if (!cleanId) return;

    activeVista360Id = cleanId;
    document.getElementById('badgeNavCurrent360').textContent = cleanId;
    document.querySelectorAll('#dynamicQuickUsers .btn-chip').forEach((b) => {
      b.classList.toggle('active', b.getAttribute('data-userid') === cleanId);
    });

    const container = document.getElementById('vista360Container');
    container.innerHTML = '<div class="v360-box">Consultando expediente integral del usuario...</div>';

    try {
      const data = await apiFetch(`/api/usuarios/${encodeURIComponent(cleanId)}/vista-360`);
      const p = data.perfil_relacional;
      const doc = data.actividad_documental_cosmos;
      const intereses = data.intereses_normalizados || [];

      const ubicacionDisplay = p.privacidad_aplicada
        ? '<span class="tag-pill privacy-alert">Ubicación Protegida por Privacidad</span>'
        : `${p.ciudad || 'Sin ciudad'}, ${p.estado || ''}, ${p.pais || ''} (${p.latitud ?? 'N/A'}, ${p.longitud ?? 'N/A'})`;

      const historialHtml =
        doc.historial.length === 0
          ? '<p class="panel-subtitle">Este perfil no registra eventos individuales en el historial de actividad.</p>'
          : `
            <div class="table-responsive">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>ID Evento</th>
                    <th>Fecha / Hora</th>
                    <th>Canal</th>
                    <th>Tipo</th>
                    <th>Tema</th>
                    <th>Sentimiento</th>
                    <th>Etiquetas</th>
                  </tr>
                </thead>
                <tbody>
                  ${doc.historial
                    .map(
                      (i) => `
                    <tr>
                      <td><code>${i.id_interaccion}</code></td>
                      <td>${i.timestamp}</td>
                      <td><strong>${i.canal}</strong></td>
                      <td>${i.tipo}</td>
                      <td>${i.tema}</td>
                      <td>${i.sentimiento}</td>
                      <td>${(i.etiquetas || []).map((t) => `<span class="tag-pill">${t}</span>`).join(' ') || '-'}</td>
                    </tr>
                  `
                    )
                    .join('')}
                </tbody>
              </table>
            </div>
          `;

      container.innerHTML = `
        <div class="v360-box v360-sql-pane">
          <div class="v360-header">
            <div>
              <strong>Ficha de Perfil</strong> · <code>${p.id_usuario}</code>
            </div>
            <span class="badge-status ${p.estatus}">${p.estatus}</span>
          </div>
          <div class="v360-kv-grid">
            <div class="v360-kv-item"><span>Alias</span><strong>${p.alias}</strong></div>
            <div class="v360-kv-item"><span>Plataforma Principal</span><strong>${p.plataforma_principal}</strong></div>
            <div class="v360-kv-item"><span>Categoría / Rango Edad</span><strong>${p.especie_fursona} (${p.rango_edad})</strong></div>
            <div class="v360-kv-item"><span>Índice Riesgo Abandono</span><strong>${p.indice_riesgo_abandono}%</strong></div>
            <div class="v360-kv-item"><span>Actividad 30d</span><strong>${p.mensajes_30d} msg · ${p.reacciones_30d} reacc</strong></div>
            <div class="v360-kv-item"><span>Consentimiento</span><strong>${p.consentimiento_datos.toUpperCase()}</strong></div>
            <div class="v360-kv-item" style="grid-column: 1 / -1;">
              <span>Ubicación Geográfica</span>
              <div style="margin-top: 4px;">${ubicacionDisplay}</div>
            </div>
          </div>
          <div style="margin-top: 16px;">
            <span style="font-size: 0.73rem; color: var(--text-muted); text-transform: uppercase; font-weight: 600;">
              Intereses y Etiquetas Asociadas
            </span>
            <div class="tag-list">
              ${intereses
                .map((it) => `<span class="tag-pill">${it.interes} (${it.tipo_interes})</span>`)
                .join('')}
            </div>
          </div>
        </div>

        <div class="v360-box v360-cosmos-pane">
          <div class="v360-header">
            <div>
              <strong>Historial de Actividad</strong>
            </div>
            <span class="chart-badge">${doc.total_interacciones} eventos</span>
          </div>
          ${historialHtml}
        </div>
      `;
    } catch (err) {
      container.innerHTML = `<div class="login-error">${err.message}</div>`;
    }
  }

  function connectWebSocket() {
    if (socket) {
      socket.disconnect();
      socket = null;
    }

    const token = getToken();
    if (!token) return;

    socket = io(API_BASE_URL, {
      auth: { token }
    });

    socket.on('connect', () => {
      wsStatusPill.className = 'status-pill connected';
      wsStatusText.textContent = 'Tiempo Real: Conectado';
    });

    socket.on('disconnect', () => {
      wsStatusPill.className = 'status-pill disconnected';
      wsStatusText.textContent = 'Tiempo Real: Desconectado';
    });

    socket.on('connect_error', () => {
      wsStatusPill.className = 'status-pill disconnected';
      wsStatusText.textContent = 'Tiempo Real: Reconectando';
    });

    socket.on('dashboard:update', (snapshot) => {
      updateRealtimeUI(snapshot);
    });
  }

  function clearLoginInputs() {
    loginForm.reset();
    document.getElementById('loginEmail').value = '';
    document.getElementById('loginPassword').value = '';
  }

  function handleForceLogout() {
    if (socket) {
      socket.disconnect();
      socket = null;
    }
    clearToken();
    clearLoginInputs();
    activeVista360Id = null;
    dashboardView.classList.add('hidden');
    loginView.classList.remove('hidden');
  }

  async function enterDashboard(user) {
    clearLoginInputs();
    adminEmailLabel.textContent = user.rol ? `${user.rol.toUpperCase()}` : 'SESIÓN AUTORIZADA';
    loginView.classList.add('hidden');
    dashboardView.classList.remove('hidden');

    ensureChartsInitialized();
    connectWebSocket();

    const [realtimeSnap] = await Promise.all([
      apiFetch('/api/analytics/realtime'),
      loadHistoricalAnalytics()
    ]);
    updateRealtimeUI(realtimeSnap);
  }

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.classList.add('hidden');
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    clearLoginInputs();

    try {
      const data = await apiFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });
      setToken(data.token);
      await enterDashboard(data.user);
    } catch (err) {
      loginError.textContent = err.message;
      loginError.classList.remove('hidden');
    }
  });

  logoutBtn.addEventListener('click', async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch (_) {
      // Ignorar si el token ya expiró
    } finally {
      handleForceLogout();
    }
  });

  refreshHistoricalBtn.addEventListener('click', async () => {
    const tasks = [apiFetch('/api/analytics/realtime'), loadHistoricalAnalytics()];
    if (activeVista360Id) {
      tasks.push(loadVista360(activeVista360Id));
    }
    const [realtimeSnap] = await Promise.all(tasks);
    updateRealtimeUI(realtimeSnap);
  });

  document.getElementById('btnBuscar360').addEventListener('click', async () => {
    const inputEl = document.getElementById('inputVista360');
    const targetId = inputEl.value;
    inputEl.value = '';
    await loadVista360(targetId);
  });

  document.getElementById('inputVista360').addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const inputEl = e.target;
      const targetId = inputEl.value;
      inputEl.value = '';
      await loadVista360(targetId);
    }
  });

  document.getElementById('inputFilterRiesgo')?.addEventListener('input', renderRiesgoTable);
  document.querySelectorAll('.filter-pill[data-riesgo-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-pill[data-riesgo-filter]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentRiesgoFilter = btn.getAttribute('data-riesgo-filter');
      renderRiesgoTable();
    });
  });

  document.getElementById('inputFilterCuarentena')?.addEventListener('input', renderCuarentenaTable);

  initNavigationEvents();

  // Verificación inicial de sesión al cargar la aplicación
  (async function bootstrap() {
    const token = getToken();
    if (!token) {
      handleForceLogout();
      return;
    }
    try {
      const me = await apiFetch('/api/auth/me');
      await enterDashboard(me.user);
    } catch (_) {
      handleForceLogout();
    }
  })();
})();
