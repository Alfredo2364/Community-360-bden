(() => {
  // Pegar aquí la URL pública del backend desplegado en Railway (sin barra diagonal al final)
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

  function ensureChartsInitialized() {
    if (!chartRealtimeBars) {
      chartRealtimeBars = echarts.init(document.getElementById('chartRealtimeBars'));
      chartRealtimeDonut = echarts.init(document.getElementById('chartRealtimeDonut'));
      chartRealtimeHeatmap = echarts.init(document.getElementById('chartRealtimeHeatmap'));
      chartHistoricalInterests = echarts.init(document.getElementById('chartHistoricalInterests'));
      chartHistoricalPlatformStatus = echarts.init(document.getElementById('chartHistoricalPlatformStatus'));

      window.addEventListener('resize', () => {
        chartRealtimeBars?.resize();
        chartRealtimeDonut?.resize();
        chartRealtimeHeatmap?.resize();
        chartHistoricalInterests?.resize();
        chartHistoricalPlatformStatus?.resize();
      });
    }
  }

  function updateRealtimeUI(payload) {
    if (!payload || !payload.kpis) return;
    ensureChartsInitialized();

    const { kpis, series, evento } = payload;

    // 1. Actualizar KPIs en vivo
    document.getElementById('kpiTotalInteracciones').textContent = kpis.totalInteracciones.toLocaleString('es-MX');
    document.getElementById('kpiPromedioInteracciones').textContent =
      `${kpis.promedioInteraccionesParticipante} prom. por participante (${kpis.promedioInteraccionesGlobal} global)`;

    document.getElementById('kpiTasaParticipacion').textContent = `${kpis.tasaParticipacionActiva}%`;
    document.getElementById('kpiUsuariosActivos').textContent =
      `${kpis.usuariosActivos.toLocaleString('es-MX')} activos de ${kpis.totalUsuarios.toLocaleString('es-MX')} usuarios SQL`;

    document.getElementById('kpiIndiceRiesgo').textContent = `${kpis.indiceRiesgoAbandono}%`;
    document.getElementById('kpiDesgloseRiesgo').textContent =
      `${kpis.usuariosEnRiesgo} en riesgo (${kpis.porcentajeEnRiesgo}%) · ${kpis.usuariosInactivos} inactivos`;

    document.getElementById('kpiUsuariosConInteraccion').textContent =
      kpis.usuariosConInteraccion.toLocaleString('es-MX');
    document.getElementById('kpiTasaInteraccionDirecta').textContent =
      `${kpis.tasaInteraccionDirecta}% cobertura activa en Cosmos DB`;

    document.getElementById('kpiSentimientoPromedio').textContent = kpis.sentimientoPromedioInteracciones;
    document.getElementById('kpiTotalReacciones').textContent =
      `${kpis.totalReaccionesRecibidas.toLocaleString('es-MX')} reacciones recibidas`;

    document.getElementById('kpiTotalUsuariosSql').textContent = kpis.totalUsuarios.toLocaleString('es-MX');
    document.getElementById('kpiPromedioGlobal').textContent =
      `${kpis.promedioInteraccionesGlobal} interacciones / usuario padrón`;

    // 2. Actualizar log discreto del último evento WebSocket (POST/PUT/DELETE/SNAPSHOT)
    if (evento) {
      const op = String(evento.operacion || 'SNAPSHOT').toUpperCase();
      const badge = document.getElementById('eventBadge');
      const desc = document.getElementById('eventDescription');
      const timeEl = document.getElementById('eventTime');

      badge.className = `event-badge ${op.toLowerCase()}`;
      badge.textContent = op;

      if (['POST', 'PUT', 'DELETE'].includes(op)) {
        desc.textContent = `Interacción ${evento.id_interaccion || ''} · Usuario ${evento.id_usuario || ''} · ${evento.canal || ''} (${evento.tipo || ''})`;
      } else {
        desc.textContent = evento.detalle || ' Indicadores sincronizados en tiempo real';
      }

      const d = evento.timestamp ? new Date(evento.timestamp) : new Date();
      timeEl.textContent = d.toLocaleTimeString('es-MX');
    }

    // 3. Gráfica 1: Barras en vivo (Interacciones por Plataforma)
    const barrasData = series.barrasPlataforma || [];
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
      grid: { left: '6%', right: '5%', top: '12%', bottom: '12%', containLabel: true },
      xAxis: {
        type: 'category',
        data: barrasData.map((d) => d.plataforma),
        axisLine: { lineStyle: { color: '#2b2b38' } },
        axisLabel: { color: '#9ca3af', fontSize: 11 }
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
          barWidth: '48%',
          data: barrasData.map((d) => d.total),
          itemStyle: {
            borderRadius: [6, 6, 0, 0],
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: '#06b6d4' },
              { offset: 1, color: '#3b82f6' }
            ])
          },
          label: {
            show: true,
            position: 'top',
            color: '#e5e7eb',
            fontSize: 11
          }
        }
      ]
    });

    // 4. Gráfica 2: Dona en vivo (Distribución por Tipo de Interacción)
    const donaData = series.donaTipoInteraccion || [];
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
        bottom: 0,
        textStyle: { color: '#9ca3af', fontSize: 11 }
      },
      color: ['#3b82f6', '#06b6d4', '#10b981', '#f59e0b', '#8b5cf6'],
      series: [
        {
          name: 'Tipo de Interacción',
          type: 'pie',
          radius: ['44%', '72%'],
          center: ['50%', '44%'],
          avoidLabelOverlap: true,
          itemStyle: {
            borderColor: '#101015',
            borderWidth: 2,
            borderRadius: 5
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

    // 5. Gráfica 3: Mapa de Calor (Plataforma vs. Tipo de Interacción)
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
      grid: { left: '12%', right: '8%', top: '8%', bottom: '16%', containLabel: true },
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
            fontWeight: 600
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
  }

  async function loadHistoricalAnalytics() {
    ensureChartsInitialized();
    const [histData, cuarentenaData] = await Promise.all([
      apiFetch('/api/analytics/historical'),
      apiFetch('/api/cuarentena?limit=35')
    ]);

    // 1. Gráfica Top Intereses (Azure SQL usuario_intereses)
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
      grid: { left: '4%', right: '6%', top: '8%', bottom: '8%', containLabel: true },
      xAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: '#1b1b24' } },
        axisLabel: { color: '#9ca3af' }
      },
      yAxis: {
        type: 'category',
        inverse: true,
        data: intereses.map((i) => i.interes),
        axisLabel: { color: '#d1d5db', fontSize: 11 }
      },
      series: [
        {
          name: 'Total Usuarios',
          type: 'bar',
          data: intereses.map((i) => i.totalUsuarios),
          itemStyle: {
            color: '#8b5cf6',
            borderRadius: [0, 5, 5, 0]
          },
          label: {
            show: true,
            position: 'right',
            color: '#e5e7eb'
          }
        }
      ]
    });

    // 2. Gráfica Usuarios por Plataforma y Estatus (Azure SQL)
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
        textStyle: { color: '#9ca3af' }
      },
      grid: { left: '5%', right: '5%', top: '14%', bottom: '10%', containLabel: true },
      xAxis: {
        type: 'category',
        data: plataformasSet,
        axisLabel: { color: '#d1d5db', fontSize: 11 }
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: '#1b1b24' } },
        axisLabel: { color: '#9ca3af' }
      },
      series: statusSeries
    });

    // 3. Tabla de Usuarios en Riesgo de Abandono
    const tbodyRiesgo = document.getElementById('tableRiesgoBody');
    tbodyRiesgo.innerHTML = (histData.usuariosEnRiesgo || [])
      .map((u) => {
        const noConsent = String(u.consentimiento_datos).toLowerCase() === 'no';
        const ubicacionCell = noConsent
          ? '<span class="tag-pill privacy-alert">ANONIMIZADO (consentimiento=no)</span>'
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
          </tr>
        `;
      })
      .join('');

    tbodyRiesgo.querySelectorAll('tr.clickable-row').forEach((row) => {
      row.addEventListener('click', () => {
        const id = row.getAttribute('data-userid');
        document.getElementById('inputVista360').value = '';
        loadVista360(id);
      });
    });

    // 4. Resumen de Calidad ETL, Privacidad y Bitácora
    const ultima = histData.calidadEtl?.ultimaEjecucion;
    const summaryContainer = document.getElementById('etlSummaryMetrics');
    const privacyBox = document.getElementById('privacyExampleBox');

    if (ultima && ultima.totales_globales) {
      const tg = ultima.totales_globales;
      const avd = ultima.antes_vs_despues;
      summaryContainer.innerHTML = `
        <div class="mini-stat">
          <span>Total Recibidos (Raw CSV)</span>
          <strong>${tg.recibidos.toLocaleString('es-MX')}</strong>
        </div>
        <div class="mini-stat">
          <span>Total Aceptados (Nube)</span>
          <strong>${tg.aceptados.toLocaleString('es-MX')}</strong>
        </div>
        <div class="mini-stat">
          <span>En Cuarentena (Cosmos)</span>
          <strong>${tg.en_cuarentena.toLocaleString('es-MX')}</strong>
        </div>
        <div class="mini-stat">
          <span>Usuarios Anonimizados</span>
          <strong>${avd?.usuarios?.anonimizados_sin_consentimiento ?? 0}</strong>
        </div>
        <div class="mini-stat">
          <span>Intereses Normalizados SQL</span>
          <strong>${avd?.usuarios?.intereses_normalizados_sql ?? 0}</strong>
        </div>
        <div class="mini-stat">
          <span>Interacciones Huérfanas</span>
          <strong>${avd?.interacciones?.huerfanos_integridad_referencial ?? 0}</strong>
        </div>
      `;

      if (ultima.ejemplo_anonimizacion) {
        privacyBox.innerHTML = `
          <div><strong>Evidencia de Privacidad Obligatoria (<code>consentimiento_datos = "no"</code>)</strong></div>
          <div class="privacy-compare">
            <div>
              <span>ANTES (CSV Crudo):</span>
              <pre>${JSON.stringify(ultima.ejemplo_anonimizacion.antes, null, 2)}</pre>
            </div>
            <div>
              <span>DESPUÉS (Azure SQL / Depurado):</span>
              <pre>${JSON.stringify(ultima.ejemplo_anonimizacion.despues, null, 2)}</pre>
            </div>
          </div>
        `;
      }
    }

    // 5. Tabla y desglose de Cuarentena
    const motivos = histData.calidadEtl?.porMotivo || {};
    document.getElementById('cuarentenaReasonsBox').innerHTML = Object.entries(motivos)
      .map(
        ([motivo, count]) =>
          `<span class="tag-pill privacy-alert">${motivo}: <strong>${count}</strong></span>`
      )
      .join('');

    const tbodyCuarentena = document.getElementById('tableCuarentenaBody');
    tbodyCuarentena.innerHTML = (cuarentenaData.registros || [])
      .map(
        (r) => `
        <tr>
          <td><code>${r.id_registro || 'N/A'}</code></td>
          <td><code>${r.id_usuario || 'N/A'}</code></td>
          <td>${r.origen}</td>
          <td>${r.motivo_rechazo}</td>
          <td>#${r.linea_csv || '-'}</td>
        </tr>
      `
      )
      .join('');
  }

  async function loadVista360(idUsuario) {
    const cleanId = String(idUsuario || '').trim().toUpperCase();
    if (!cleanId) return;

    const container = document.getElementById('vista360Container');
    container.innerHTML = '<div class="v360-box">Consultando perfil híbrido en Azure SQL + Cosmos DB...</div>';

    try {
      const data = await apiFetch(`/api/usuarios/${encodeURIComponent(cleanId)}/vista-360`);
      const p = data.perfil_relacional;
      const doc = data.actividad_documental_cosmos;
      const intereses = data.intereses_normalizados || [];

      const ubicacionDisplay = p.privacidad_aplicada
        ? '<span class="tag-pill privacy-alert">NULL (Ubicación protegida por consentimiento_datos = no)</span>'
        : `${p.ciudad || 'Sin ciudad'}, ${p.estado || ''}, ${p.pais || ''} (${p.latitud ?? 'N/A'}, ${p.longitud ?? 'N/A'})`;

      const historialHtml =
        doc.historial.length === 0
          ? '<p class="panel-subtitle">Este usuario no registra interacciones individuales en el contenedor documental.</p>'
          : `
            <div class="table-responsive compact-scroll">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>ID Interacción</th>
                    <th>Timestamp</th>
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
                      <td>${i.canal}</td>
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
        <div class="v360-box">
          <div class="v360-header">
            <div>
              <strong>Perfil Relacional (Azure SQL)</strong> · <code>${p.id_usuario}</code>
            </div>
            <span class="badge-status ${p.estatus}">${p.estatus}</span>
          </div>
          <div class="v360-kv-grid">
            <div class="v360-kv-item"><span>Alias</span><strong>${p.alias}</strong></div>
            <div class="v360-kv-item"><span>Plataforma Principal</span><strong>${p.plataforma_principal}</strong></div>
            <div class="v360-kv-item"><span>Especie / Rango Edad</span><strong>${p.especie_fursona} (${p.rango_edad})</strong></div>
            <div class="v360-kv-item"><span>Índice Riesgo Abandono</span><strong>${p.indice_riesgo_abandono}%</strong></div>
            <div class="v360-kv-item"><span>Actividad 30d (SQL)</span><strong>${p.mensajes_30d} msg · ${p.reacciones_30d} reacc</strong></div>
            <div class="v360-kv-item"><span>Consentimiento Datos</span><strong>${p.consentimiento_datos.toUpperCase()}</strong></div>
            <div class="v360-kv-item" style="grid-column: 1 / -1;">
              <span>Ubicación Geográfica y Coordenadas</span>
              <div>${ubicacionDisplay}</div>
            </div>
          </div>
          <div style="margin-top: 14px;">
            <span style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase;">
              Intereses y Etiquetas Normalizadas (<code>dbo.usuario_intereses</code>)
            </span>
            <div class="tag-list">
              ${intereses
                .map((it) => `<span class="tag-pill">${it.interes} (${it.tipo_interes})</span>`)
                .join('')}
            </div>
          </div>
        </div>

        <div class="v360-box">
          <div class="v360-header">
            <div>
              <strong>Actividad Documental (Azure Cosmos DB)</strong>
            </div>
            <span class="chart-badge">${doc.total_interacciones} interacciones</span>
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
      wsStatusText.textContent = 'WebSocket: Conectado en Vivo';
    });

    socket.on('disconnect', () => {
      wsStatusPill.className = 'status-pill disconnected';
      wsStatusText.textContent = 'WebSocket: Desconectado';
    });

    socket.on('connect_error', () => {
      wsStatusPill.className = 'status-pill disconnected';
      wsStatusText.textContent = 'WebSocket: Error de Autenticación';
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
    dashboardView.classList.add('hidden');
    loginView.classList.remove('hidden');
  }

  async function enterDashboard(user) {
    clearLoginInputs();
    adminEmailLabel.textContent = `${user.email} (${user.rol})`;
    loginView.classList.add('hidden');
    dashboardView.classList.remove('hidden');

    ensureChartsInitialized();
    connectWebSocket();

    const [realtimeSnap] = await Promise.all([
      apiFetch('/api/analytics/realtime'),
      loadHistoricalAnalytics(),
      loadVista360('U000852')
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
    await Promise.all([
      loadHistoricalAnalytics(),
      loadVista360('U000852')
    ]);
  });

  document.getElementById('btnBuscar360').addEventListener('click', async () => {
    const inputEl = document.getElementById('inputVista360');
    const targetId = inputEl.value;
    inputEl.value = '';
    await loadVista360(targetId);
  });

  document.querySelectorAll('.btn-chip[data-userid]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const uid = btn.getAttribute('data-userid');
      document.getElementById('inputVista360').value = '';
      await loadVista360(uid);
    });
  });

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
