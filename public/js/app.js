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
  function latLngToCanvas(lat, lng, width, height) {
    // Enfoque táctico sobre América y Europa Occidental (lat: -45 a 50, lng: -130 a 10)
    const minLng = -128;
    const maxLng = 8;
    const minLat = -44;
    const maxLat = 48;
    const x = ((lng - minLng) / (maxLng - minLng)) * (width - 80) + 40;
    const y = ((maxLat - lat) / (maxLat - minLat)) * (height - 70) + 35;
    return {
      x: Math.max(36, Math.min(width - 36, x)),
      y: Math.max(36, Math.min(height - 36, y))
    };
  }

  // Siluetas vectoriales continentales simplificadas para el visor orbital
  const TACTICAL_LAND_POLYGONS = [
    // Norteamérica y México
    [[-124, 48], [-123, 37], [-117, 32], [-110, 23], [-105, 20], [-97, 16], [-92, 15], [-87, 21], [-90, 21], [-97, 26], [-95, 29], [-82, 25], [-80, 32], [-74, 40], [-70, 45], [-95, 48]],
    // Centroamérica y Caribe
    [[-92, 15], [-83, 9], [-77, 8], [-79, 9], [-83, 15], [-88, 18]],
    // Sudamérica
    [[-77, 8], [-81, -5], [-77, -12], [-71, -18], [-71, -33], [-73, -42], [-65, -42], [-58, -35], [-52, -32], [-43, -23], [-35, -6], [-50, 0], [-62, 10], [-75, 11]],
    // Península Ibérica / Europa Occidental
    [[-9, 37], [-9, 43], [-2, 43], [3, 42], [0, 38], [-6, 36]]
  ];

  function buildTacticalNodes(usersList, ejemploAnon) {
    const nodes = [];

    if (ejemploAnon && ejemploAnon.antes) {
      const a = ejemploAnon.antes;
      const fallback = CITY_COORDS_FALLBACK[a.ciudad] || { lat: 25.6866, lng: -100.3161 };
      nodes.push({
        id_usuario: a.id_usuario,
        alias: a.alias,
        consentimiento: 'no',
        rawCiudad: a.ciudad || 'Monterrey',
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
      const fallback = CITY_COORDS_FALLBACK[u.ciudad] || CITY_COORDS_FALLBACK['Monterrey'];
      const hasCoords = u.latitud !== null && u.longitud !== null && u.latitud !== undefined;

      nodes.push({
        id_usuario: u.id_usuario,
        alias: u.alias,
        consentimiento: noConsent ? 'no' : 'si',
        rawCiudad: u.ciudad || (noConsent ? 'SECTOR CLASIFICADO' : 'Mérida'),
        rawPais: u.pais || (noConsent ? 'OCULTO' : 'México'),
        rawTz: u.zona_horaria || 'America/Mexico_City',
        rawLat: hasCoords ? Number(u.latitud) : fallback.lat,
        rawLng: hasCoords ? Number(u.longitud) : fallback.lng,
        estatus: u.estatus,
        plataforma: u.plataforma_principal
      });
      if (nodes.length >= 24) break;
    }

    tacticalNodes = nodes;
    renderTacticalTargetList();
    selectTacticalTarget(0);
  }

  function renderTacticalTargetList() {
    const listEl = document.getElementById('hudTargetSelectorList');
    if (!listEl) return;

    listEl.innerHTML = tacticalNodes
      .slice(0, 10)
      .map((n, idx) => {
        const isAnon = n.consentimiento === 'no';
        const tagClass = isAnon ? 'blocked' : 'ok';
        const tagText = isAnon ? 'SHIELD' : 'LOCK';
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
        selectTacticalTarget(Number(btn.getAttribute('data-tidx')));
      });
    });
  }

  function selectTacticalTarget(idx) {
    if (!tacticalNodes.length) return;
    tacticalSelectedIdx = (idx + tacticalNodes.length) % tacticalNodes.length;
    const target = tacticalNodes[tacticalSelectedIdx];
    const canvas = document.getElementById('tacticalGeoCanvas');
    const w = canvas ? canvas.width : 860;
    const h = canvas ? canvas.height : 440;

    const isAnon = target.consentimiento === 'no';
    const isShieldedNow = isAnon && tacticalPostEtlShieldMode;

    document.querySelectorAll('.tactical-target-btn').forEach((b, i) => {
      b.classList.toggle('active', i === tacticalSelectedIdx);
    });

    document.getElementById('hudTargetAlias').textContent = `${target.id_usuario} // ${target.alias.toUpperCase()}`;
    const lockEl = document.getElementById('hudLockStatus');
    const coordsEl = document.getElementById('hudCoordsText');
    const sectorEl = document.getElementById('hudSectorText');
    const tzEl = document.getElementById('hudTimezoneText');
    const alertBanner = document.getElementById('hudAlertBanner');

    if (isShieldedNow) {
      // Escudo de privacidad post-ETL activado: coordenadas anuladas
      reticleTarget = { x: w * 0.5, y: h * 0.5 };
      lockEl.textContent = 'GEO-LOCK DENIED // NULL';
      lockEl.className = 'hud-status-text shielded';
      coordsEl.textContent = 'LAT: NULL // LON: NULL';
      sectorEl.textContent = 'UBICACIÓN SUPRIMIDA (ETL)';
      tzEl.textContent = 'NULL (PROTEGIDO)';
      alertBanner.className = 'hud-alert-banner shield-active';
      alertBanner.textContent = `ESCUDO DE PRIVACIDAD ACTIVO PARA ${target.id_usuario} · COORDENADAS ANULADAS EN BASE DE DATOS`;
    } else if (isAnon && !tacticalPostEtlShieldMode) {
      // Modo Pre-ETL (Datos crudos antes de anonimizar)
      const pt = latLngToCanvas(target.rawLat, target.rawLng, w, h);
      reticleTarget = pt;
      lockEl.textContent = 'RAW GEODATA EXPOSED';
      lockEl.className = 'hud-status-text exposed';
      coordsEl.textContent = `${target.rawLat.toFixed(4)}° N, ${target.rawLng.toFixed(4)}° W`;
      sectorEl.textContent = `${target.rawCiudad.toUpperCase()}, ${target.rawPais.toUpperCase()}`;
      tzEl.textContent = target.rawTz.toUpperCase();
      alertBanner.className = 'hud-alert-banner raw-warning';
      alertBanner.textContent = `VISTA PRE-ETL (CSV CRUDO): UBICACIÓN ${target.rawCiudad.toUpperCase()} DETECTADA ANTES DE ANONIMIZACIÓN`;
    } else {
      // Usuario con consentimiento = 'si'
      const pt = latLngToCanvas(target.rawLat, target.rawLng, w, h);
      reticleTarget = pt;
      lockEl.textContent = 'ORBITAL LOCK ENGAGED';
      lockEl.className = 'hud-status-text locked';
      coordsEl.textContent = `${target.rawLat.toFixed(4)}°, ${target.rawLng.toFixed(4)}°`;
      sectorEl.textContent = `${target.rawCiudad.toUpperCase()}, ${target.rawPais.toUpperCase()}`;
      tzEl.textContent = target.rawTz.toUpperCase();
      alertBanner.className = 'hud-alert-banner';
      alertBanner.textContent = `ADQUISICIÓN SATELITAL CONFIRMADA · ${target.rawCiudad.toUpperCase()} (${target.plataforma.toUpperCase()})`;
    }

    // Actualizar barras de onda y log vectorial
    document.querySelectorAll('#hudTelemetryBars .wave-bar').forEach((bar) => {
      const randH = isShieldedNow ? Math.floor(12 + Math.random() * 18) : Math.floor(30 + Math.random() * 68);
      bar.style.height = `${randH}%`;
    });

    const vectorLog = document.getElementById('hudVectorLog');
    if (vectorLog) {
      const nowStr = new Date().toLocaleTimeString('es-MX');
      vectorLog.innerHTML = `
        <div>[${nowStr}]TARGET: ${target.id_usuario}</div>
        <div>CONSENT: ${target.consentimiento.toUpperCase()}</div>
        <div>MODE: ${tacticalPostEtlShieldMode ? 'POST-ETL SHIELD' : 'PRE-ETL RAW'}</div>
        <div>VECTOR: ${isShieldedNow ? 'ENCRYPTED_NULL' : `${target.rawLat.toFixed(2)}, ${target.rawLng.toFixed(2)}`}</div>
        <div>CHANNEL: ${target.plataforma.toUpperCase()}</div>
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

      // 1. Cuadrícula táctica de latitud / longitud
      ctx.strokeStyle = 'rgba(6, 182, 212, 0.09)';
      ctx.lineWidth = 1;
      for (let x = 40; x < w; x += 60) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = 35; y < h; y += 55) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      // 2. Polígonos vectoriales continentales
      ctx.strokeStyle = 'rgba(6, 182, 212, 0.32)';
      ctx.fillStyle = 'rgba(6, 182, 212, 0.05)';
      ctx.lineWidth = 1.4;
      for (const poly of TACTICAL_LAND_POLYGONS) {
        ctx.beginPath();
        poly.forEach(([lng, lat], i) => {
          const pt = latLngToCanvas(lat, lng, w, h);
          if (i === 0) ctx.moveTo(pt.x, pt.y);
          else ctx.lineTo(pt.x, pt.y);
        });
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }

      // 3. Anillo de radar orbital central y haz de barrido
      const cx = w * 0.5;
      const cy = h * 0.5;
      ctx.strokeStyle = 'rgba(6, 182, 212, 0.14)';
      ctx.lineWidth = 1;
      [90, 165, 240].forEach((r) => {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
      });

      radarAngle = (radarAngle + 0.012) % (Math.PI * 2);
      const grad = ctx.createRadialGradient(cx, cy, 5, cx, cy, 240);
      grad.addColorStop(0, 'rgba(6, 182, 212, 0.18)');
      grad.addColorStop(1, 'rgba(6, 182, 212, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, 240, radarAngle, radarAngle + 0.48);
      ctx.closePath();
      ctx.fill();

      // 4. Arcos de enlace satelital y nodos de usuarios reales
      const currentTarget = tacticalNodes[tacticalSelectedIdx];
      tacticalNodes.forEach((node, idx) => {
        const isNodeAnon = node.consentimiento === 'no';
        if (isNodeAnon && tacticalPostEtlShieldMode) return; // Oculto del mapa en modo Post-ETL

        const pt = latLngToCanvas(node.rawLat, node.rawLng, w, h);

        // Línea de trayectoria orbital hacia el nodo activo
        if (idx === tacticalSelectedIdx) {
          ctx.strokeStyle = isNodeAnon ? 'rgba(245, 158, 11, 0.45)' : 'rgba(6, 182, 212, 0.45)';
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(cx, 18);
          ctx.quadraticCurveTo((cx + pt.x) / 2, Math.min(cy, pt.y) - 40, pt.x, pt.y);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        // Punto luminoso del nodo
        ctx.fillStyle = isNodeAnon ? '#f59e0b' : '#10b981';
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, idx === tacticalSelectedIdx ? 5 : 3.2, 0, Math.PI * 2);
        ctx.fill();
      });

      // 5. Interpolación suave de la retícula balística estilo G.I. Joe (Project Zeus)
      reticleCurrent.x += (reticleTarget.x - reticleCurrent.x) * 0.12;
      reticleCurrent.y += (reticleTarget.y - reticleCurrent.y) * 0.12;
      ringRotation += 0.025;

      const rx = reticleCurrent.x;
      const ry = reticleCurrent.y;
      const isTargetAnon = currentTarget && currentTarget.consentimiento === 'no';
      const isShieldedNow = isTargetAnon && tacticalPostEtlShieldMode;

      const mainColor = isShieldedNow
        ? '#f43f5e'
        : isTargetAnon
        ? '#f59e0b'
        : '#06b6d4';

      // Líneas guía de puntería de extremo a extremo
      ctx.strokeStyle = isShieldedNow ? 'rgba(244, 63, 94, 0.28)' : 'rgba(6, 182, 212, 0.28)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, ry);
      ctx.lineTo(rx - 44, ry);
      ctx.moveTo(rx + 44, ry);
      ctx.lineTo(w, ry);
      ctx.moveTo(rx, 0);
      ctx.lineTo(rx, ry - 44);
      ctx.moveTo(rx, ry + 44);
      ctx.lineTo(rx, h);
      ctx.stroke();

      // Anillo exterior giratorio segmentado (estilo mira satelital G.I. Joe)
      ctx.save();
      ctx.translate(rx, ry);
      ctx.rotate(ringRotation);
      ctx.strokeStyle = mainColor;
      ctx.lineWidth = 2;
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.arc(0, 0, 36, i * (Math.PI / 2) + 0.18, (i + 1) * (Math.PI / 2) - 0.18);
        ctx.stroke();
      }
      ctx.restore();

      // Rombo interior contra-giratorio
      ctx.save();
      ctx.translate(rx, ry);
      ctx.rotate(-ringRotation * 1.4);
      ctx.strokeStyle = mainColor;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(-16, -16, 32, 32);
      ctx.restore();

      // Centro de impacto / escudo
      ctx.fillStyle = mainColor;
      ctx.beginPath();
      ctx.arc(rx, ry, 3, 0, Math.PI * 2);
      ctx.fill();

      // Etiqueta flotante junto a la retícula
      if (currentTarget) {
        const boxX = Math.min(w - 215, rx + 44);
        const boxY = Math.max(24, ry - 38);
        ctx.fillStyle = 'rgba(7, 10, 16, 0.88)';
        ctx.strokeStyle = mainColor;
        ctx.lineWidth = 1.2;
        ctx.fillRect(boxX, boxY, 198, 46);
        ctx.strokeRect(boxX, boxY, 198, 46);

        ctx.fillStyle = '#f3f4f6';
        ctx.font = 'bold 11px Consolas, monospace';
        ctx.fillText(
          `${currentTarget.id_usuario} // ${currentTarget.alias}`,
          boxX + 8,
          boxY + 17
        );
        ctx.fillStyle = mainColor;
        ctx.font = '10px Consolas, monospace';
        ctx.fillText(
          isShieldedNow
            ? 'SHIELD: COORDS NULLIFIED'
            : `${currentTarget.rawCiudad} (${currentTarget.rawLat.toFixed(2)}, ${currentTarget.rawLng.toFixed(2)})`,
          boxX + 8,
          boxY + 34
        );
      }

      const azEl = document.getElementById('hudAzimuthVal');
      if (azEl) {
        azEl.textContent = `${(((radarAngle * 180) / Math.PI + 360) % 360).toFixed(1)}°`;
      }

      tacticalAnimFrame = requestAnimationFrame(renderFrame);
    }

    canvas.addEventListener('click', (e) => {
      const rect = canvas.getBoundingClientRect();
      const clickX = ((e.clientX - rect.left) / rect.width) * canvas.width;
      const clickY = ((e.clientY - rect.top) / rect.height) * canvas.height;

      let bestIdx = -1;
      let bestDist = 35;
      tacticalNodes.forEach((node, idx) => {
        if (node.consentimiento === 'no' && tacticalPostEtlShieldMode) return;
        const pt = latLngToCanvas(node.rawLat, node.rawLng, canvas.width, canvas.height);
        const dist = Math.hypot(pt.x - clickX, pt.y - clickY);
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = idx;
        }
      });

      if (bestIdx !== -1) {
        selectTacticalTarget(bestIdx);
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

    document.getElementById('btnTacticalModeBefore')?.addEventListener('click', (e) => {
      tacticalPostEtlShieldMode = false;
      e.currentTarget.classList.add('active');
      document.getElementById('btnTacticalModeAfter')?.classList.remove('active');
      selectTacticalTarget(0);
    });

    document.getElementById('btnTacticalModeAfter')?.addEventListener('click', (e) => {
      tacticalPostEtlShieldMode = true;
      e.currentTarget.classList.add('active');
      document.getElementById('btnTacticalModeBefore')?.classList.remove('active');
      selectTacticalTarget(tacticalSelectedIdx);
    });

    document.getElementById('btnTacticalCycleTarget')?.addEventListener('click', () => {
      selectTacticalTarget(tacticalSelectedIdx + 1);
    });
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
      apiFetch('/api/usuarios?limit=45')
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
