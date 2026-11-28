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

      // Generar accesos dinámicos en Vista 360 basados en los usuarios activos del stream (sin IDs estáticos en HTML)
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
  // ANALÍTICA HISTÓRICA
  // =========================================================
  async function loadHistoricalAnalytics() {
    ensureChartsInitialized();
    const [histData, cuarentenaData] = await Promise.all([
      apiFetch('/api/analytics/historical'),
      apiFetch('/api/cuarentena?limit=60')
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
