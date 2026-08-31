'use strict';

const DATA = {
  main: 'data/rm08_infraestructura.json',
  alcaldias: 'data/alcaldias.json',
  subsidencias: 'data/subsidencias.json',
  fracturamiento: 'data/fracturamiento.json'
};

const q = id => document.getElementById(id);
const clean = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]));
const formatNumber = value => Number(value || 0).toLocaleString('es-MX');
const isMapped = item => Number.isFinite(item.lat) && Number.isFinite(item.lon);

let dataset;
let programMap = new Map();
let currentItems = [];
let markersLayer;
let subsidyLayer;
let fractureLayer;
let alcaldiasLayer;
let hasFitResult = false;

const map = L.map('map', {zoomControl:false, preferCanvas:true, minZoom:9}).setView([19.35, -99.13], 10);
L.control.zoom({position:'topright'}).addTo(map);

const baseLayers = {
  'OpenStreetMap': L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 20,
    attribution: '© OpenStreetMap'
  }),
  'Satélite': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 20,
    attribution: 'Tiles © Esri'
  }),
  'Mapa oscuro': L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 20,
    attribution: '© OpenStreetMap © CARTO'
  })
};
baseLayers.OpenStreetMap.addTo(map);
L.control.layers(baseLayers, {}, {collapsed:true, position:'bottomright'}).addTo(map);

bootstrap();

async function bootstrap() {
  try {
    const [main, alcaldias, subsidencias, fracturamiento] = await Promise.all([
      fetchJson(DATA.main), fetchJson(DATA.alcaldias), fetchJson(DATA.subsidencias), fetchJson(DATA.fracturamiento)
    ]);
    dataset = main;
    programMap = new Map(main.programas.map(program => [program.id, program]));
    markersLayer = L.layerGroup().addTo(map);
    configureBoundary(alcaldias);
    configureTerritorialLayers(subsidencias, fracturamiento);
    buildControls();
    bindEvents();
    restoreState();
    render(true);
    q('mapStatus').classList.add('hidden');
  } catch (error) {
    console.error(error);
    q('mapStatus').textContent = 'No fue posible cargar la información del visor.';
    q('mapStatus').classList.add('error');
  }
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Error ${response.status} al cargar ${url}`);
  return response.json();
}

function configureBoundary(geojson) {
  alcaldiasLayer = L.geoJSON(geojson, {
    style: {color:'#315b7d', weight:1.1, fillColor:'#dbe7ef', fillOpacity:.05, dashArray:'4 3'},
    interactive:false
  }).addTo(map);
}

function configureTerritorialLayers(subsidencias, fracturamiento) {
  const colors = {1:'#006837', 2:'#78c679', 3:'#ffd166', 4:'#f97316', 5:'#dc2626'};
  subsidyLayer = L.geoJSON(subsidencias, {
    style: feature => ({color:colors[feature.properties.gridcode] || '#64748b', fillColor:colors[feature.properties.gridcode] || '#64748b', fillOpacity:.3, weight:.35}),
    interactive:false
  });
  fractureLayer = L.geoJSON(fracturamiento, {
    style: {color:'#a21caf', weight:2.2, opacity:.85},
    onEachFeature: (feature, layer) => {
      const type = feature.properties?.TIPO || 'Fractura cartografiada';
      layer.bindTooltip(escapeHtml(type), {className:'fracture-tooltip', sticky:true});
    }
  });
}

function buildControls() {
  const all = [...dataset.inmuebles, ...dataset.ccts];
  fillSelect(q('filtroAlcaldia'), unique(all.flatMap(item => item.alcaldia || [])));
  fillSelect(q('filtroNivel'), unique(all.flatMap(item => item.niveles || [item.nivel])));
  q('programFilters').innerHTML = dataset.programas.map(program =>
    `<label class="inline-check"><input type="checkbox" value="${escapeHtml(program.id)}"><span><i class="program-dot" style="--program-color:${escapeHtml(program.color)}"></i>${escapeHtml(program.label)} <small>(${formatNumber(program.count)})</small></span></label>`
  ).join('');
  refreshDatalists();
  q('coverageNote').textContent = `${formatNumber(dataset.metadata.total_registros_principales)} registros fuente · ${formatNumber(dataset.metadata.registros_sin_coordenadas)} sin coordenadas no se dibujan en el mapa.`;
}

function fillSelect(select, values) {
  values.forEach(value => select.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`));
}

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort((a,b) => String(a).localeCompare(String(b), 'es'));
}

function activeMode() {
  return document.querySelector('input[name="viewMode"]:checked')?.value || 'inmueble';
}

function activeItems() {
  return activeMode() === 'cct' ? dataset.ccts : dataset.inmuebles;
}

function refreshDatalists() {
  const items = activeItems();
  q('listaCCT').innerHTML = unique(items.flatMap(item => item.ccts)).map(value => `<option value="${escapeHtml(value)}"></option>`).join('');
  q('listaNombres').innerHTML = unique(items.flatMap(item => item.nombres)).map(value => `<option value="${escapeHtml(value)}"></option>`).join('');
}

function bindEvents() {
  document.querySelectorAll('input[name="viewMode"]').forEach(input => input.addEventListener('change', () => {
    hasFitResult = false;
    refreshDatalists();
    render(true);
  }));
  ['filtroAlcaldia','filtroNivel','buscarCCT','buscarNombre','rankMin','rankMax','toggleSchools']
    .forEach(id => q(id).addEventListener(id.startsWith('buscar') || id.startsWith('rank') ? 'input' : 'change', () => render(false)));
  q('priorityFilters').addEventListener('change', () => render(false));
  document.querySelectorAll('input[name="riskMode"]').forEach(input => input.addEventListener('change', () => render(false)));
  q('programFilters').addEventListener('change', () => render(false));
  q('selectAllProgramas').onclick = () => setChecks('#programFilters input', true);
  q('clearProgramas').onclick = () => setChecks('#programFilters input', false);
  q('selectAllPrioridades').onclick = () => setChecks('#priorityFilters input', true);
  q('clearPrioridades').onclick = () => setChecks('#priorityFilters input', false);
  q('clearRiesgos').onclick = () => {
    document.querySelectorAll('input[name="riskMode"]').forEach(input => input.checked = false);
    render(false);
  };
  q('btnLimpiar').onclick = clearFilters;
  q('toggleSubsidencias').onchange = toggleSubsidencies;
  q('toggleFracturamiento').onchange = toggleFractures;
  q('toggleProgramas').onclick = () => toggleMenu('programasBody','programasArrow','toggleProgramas');
  q('toggleRiesgos').onclick = () => toggleMenu('riesgosBody','riesgosArrow','toggleRiesgos');
  q('toggleLegend').onclick = () => toggleLegend('legendBody','toggleLegend');
  q('toggleSubLegend').onclick = () => toggleLegend('subLegendBody','toggleSubLegend');
  q('toggleSidebar').onclick = hideSidebar;
  q('showSidebar').onclick = showSidebar;
  q('closeDetail').onclick = () => q('detailPanel').classList.remove('open');
  q('fullscreenButton').onclick = toggleFullscreen;
  document.addEventListener('fullscreenchange', syncFullscreen);
  window.addEventListener('resize', () => map.invalidateSize());
}

function setChecks(selector, checked) {
  document.querySelectorAll(selector).forEach(input => input.checked = checked);
  render(false);
}

function toggleMenu(bodyId, arrowId, buttonId) {
  const body = q(bodyId);
  const open = body.classList.toggle('hidden') === false;
  q(arrowId).textContent = open ? '⌄' : '›';
  q(buttonId).setAttribute('aria-expanded', String(open));
}

function toggleLegend(bodyId, buttonId) {
  const body = q(bodyId);
  body.classList.toggle('hidden');
  q(buttonId).textContent = body.classList.contains('hidden') ? '+' : '−';
}

function toggleSubsidencies() {
  if (q('toggleSubsidencias').checked) {
    subsidyLayer.addTo(map);
    subsidyLayer.bringToBack();
    if (alcaldiasLayer) alcaldiasLayer.bringToBack();
    q('subsidenciaLegend').classList.remove('hidden');
  } else {
    map.removeLayer(subsidyLayer);
    q('subsidenciaLegend').classList.add('hidden');
  }
}

function toggleFractures() {
  if (q('toggleFracturamiento').checked) fractureLayer.addTo(map);
  else map.removeLayer(fractureLayer);
}

function selectedPrograms() {
  return [...document.querySelectorAll('#programFilters input:checked')].map(input => input.value);
}

function selectedPriorities() {
  return [...document.querySelectorAll('#priorityFilters input:checked')].map(input => input.value);
}

function selectedRisk() {
  return document.querySelector('input[name="riskMode"]:checked')?.value || '';
}

function getState() {
  return {
    mode: activeMode(),
    alcaldia: q('filtroAlcaldia').value,
    nivel: q('filtroNivel').value,
    prioridades: selectedPriorities(),
    cct: q('buscarCCT').value,
    nombre: q('buscarNombre').value,
    rankMin: q('rankMin').value,
    rankMax: q('rankMax').value,
    programas: selectedPrograms(),
    risk: selectedRisk()
  };
}

function restoreState() {
  try {
    const state = JSON.parse(localStorage.getItem('rm08_visor_state') || 'null');
    if (!state) return;
    const mode = document.querySelector(`input[name="viewMode"][value="${state.mode}"]`);
    if (mode) mode.checked = true;
    ['alcaldia','nivel'].forEach(field => {
      const target = q(`filtro${field.charAt(0).toUpperCase() + field.slice(1)}`);
      if (target && [...target.options].some(option => option.value === state[field])) target.value = state[field] || '';
    });
    const restoredPriorities = state.prioridades || (state.prioridad ? [state.prioridad] : []);
    document.querySelectorAll('#priorityFilters input').forEach(input => input.checked = restoredPriorities.includes(input.value));
    q('buscarCCT').value = state.cct || '';
    q('buscarNombre').value = state.nombre || '';
    q('rankMin').value = state.rankMin || '';
    q('rankMax').value = state.rankMax || '';
    document.querySelectorAll('#programFilters input').forEach(input => input.checked = (state.programas || []).includes(input.value));
    const risk = document.querySelector(`input[name="riskMode"][value="${state.risk}"]`);
    if (risk) risk.checked = true;
  } catch (error) {
    console.warn('No se pudo restaurar el estado previo.', error);
  }
}

function render(fitResult) {
  if (!dataset) return;
  const state = getState();
  try { localStorage.setItem('rm08_visor_state', JSON.stringify(state)); } catch (_) {}
  const programSet = new Set(state.programas);
  const prioritySet = new Set(state.prioridades);
  const rankMin = state.rankMin === '' ? null : Number(state.rankMin);
  const rankMax = state.rankMax === '' ? null : Number(state.rankMax);
  currentItems = activeItems().filter(item => {
    if (state.alcaldia && item.alcaldia !== state.alcaldia) return false;
    if (state.nivel && !item.niveles.includes(state.nivel)) return false;
    if (prioritySet.size && !prioritySet.has(item.prioridad_rm08)) return false;
    if (state.cct && !clean(item.ccts.join(' ')).includes(clean(state.cct))) return false;
    if (state.nombre && !clean(item.nombres.join(' ')).includes(clean(state.nombre))) return false;
    if (rankMin !== null && (item.prioridad_123_2026 === null || item.prioridad_123_2026 < rankMin)) return false;
    if (rankMax !== null && (item.prioridad_123_2026 === null || item.prioridad_123_2026 > rankMax)) return false;
    if (programSet.size && !item.programas.some(program => programSet.has(program))) return false;
    if (state.risk === 'obs_fractura' && !item.cercano_fracturamiento_250m) return false;
    if (state.risk === 'obs_subsidencia' && !item.subsidencia_alta) return false;
    if (state.risk === 'obs_combinada' && !(item.cercano_fracturamiento_250m && item.subsidencia_alta)) return false;
    return true;
  });
  drawMarkers();
  updateSummary(state);
  if (fitResult && !hasFitResult) fitCurrentResult();
}

function drawMarkers() {
  markersLayer.clearLayers();
  if (!q('toggleSchools').checked) return;
  const canvas = L.canvas({padding:.35});
  currentItems.filter(isMapped).forEach(item => {
    const marker = L.circleMarker([item.lat, item.lon], {
      renderer:canvas,
      radius:6,
      color:'#fff',
      weight:1.3,
      fillColor:priorityColor(item.prioridad_rm08),
      fillOpacity:.9
    });
    marker.bindTooltip(`<div class="popup-title">${escapeHtml(item.nombre)}</div><div class="popup-meta">${escapeHtml(item.ccts.join(', ') || 'Sin CCT')} · ${escapeHtml(item.prioridad_rm08 || 'Sin prioridad')}</div>`, {sticky:true});
    marker.on('click', () => showDetail(item));
    marker.addTo(markersLayer);
  });
}

function priorityColor(priority) {
  return ({ALTA:'#dc2626', MEDIA:'#f59e0b', BAJA:'#16a34a'})[priority] || '#64748b';
}

function updateSummary(state) {
  q('kpi1').textContent = formatNumber(currentItems.length);
  q('kpiLabel1').textContent = activeMode() === 'cct' ? 'CCT' : 'Inmuebles';
  q('kpi2').textContent = formatNumber(currentItems.filter(item => item.prioridad_rm08 === 'ALTA').length);
  q('kpi3').textContent = formatNumber(currentItems.filter(item => item.programas.length).length);
  q('kpi4').textContent = formatNumber(currentItems.filter(item => item.observacion_territorial !== 'Sin observación').length);
  const parts = [];
  if (state.prioridades.length) parts.push(`RM08: ${state.prioridades.map(value => value.toLowerCase()).join(', ')}`);
  if (state.programas.length) parts.push(`${state.programas.length} programa(s)`);
  if (state.risk) parts.push('observación territorial');
  if (state.rankMin || state.rankMax) parts.push(`clasificación 1,2,3: ${state.rankMin || 1}–${state.rankMax || 464}`);
  q('activeCrossSummary').textContent = parts.length ? `Cruce activo: ${parts.join(' + ')}.` : 'Sin cruces temáticos activos.';
}

function fitCurrentResult() {
  const points = currentItems.filter(isMapped).map(item => [item.lat, item.lon]);
  if (points.length) {
    map.fitBounds(L.latLngBounds(points), {padding:[28,28], maxZoom:15});
    hasFitResult = true;
  }
}

function clearFilters() {
  ['filtroAlcaldia','filtroNivel','buscarCCT','buscarNombre','rankMin','rankMax'].forEach(id => q(id).value = '');
  document.querySelectorAll('#priorityFilters input, #programFilters input, input[name="riskMode"]').forEach(input => input.checked = false);
  hasFitResult = false;
  render(true);
}

function showDetail(item) {
  q('detailTitle').textContent = item.nombre;
  const programCards = item.programa_registros.length
    ? item.programa_registros.map(ref => renderProgramRecord(ref)).join('')
    : '<p class="muted-box">No hay registros de programas vinculados a esta unidad.</p>';
  const sourceCards = item.registros_principales.map((record, index) =>
    `<details class="source-details"${index === 0 ? ' open' : ''}><summary>Registro principal · fila ${formatNumber(record.source_row)}</summary>${renderFields(record.datos_principales)}</details>`
  ).join('');
  q('detailContent').innerHTML = `
    <div class="detail-tabs">
      <button class="tab-btn active" data-tab="general">General</button>
      <button class="tab-btn" data-tab="rm08">RM08</button>
      <button class="tab-btn" data-tab="programas">Programas <span class="tab-count">${item.programa_registros.length}</span></button>
      <button class="tab-btn" data-tab="territorio">Territorio</button>
      <button class="tab-btn" data-tab="fuente">Datos fuente</button>
    </div>
    <div class="tab-pane active" data-pane="general">
      <dl><dt>Unidad</dt><dd>${item.tipo === 'cct' ? 'CCT' : 'Inmueble'}</dd><dt>Código DGA</dt><dd>${escapeHtml(item.codigos_dga.join(', ') || 'Sin dato')}</dd><dt>CCT</dt><dd>${escapeHtml(item.ccts.join(', ') || 'Sin CCT')}</dd><dt>Alcaldía</dt><dd>${escapeHtml(item.alcaldia || 'Sin dato')}</dd><dt>Colonia</dt><dd>${escapeHtml(item.colonia || 'Sin dato')}</dd><dt>Domicilio</dt><dd>${escapeHtml(item.domicilio || 'Sin dato')}</dd><dt>Nivel</dt><dd>${escapeHtml(item.niveles.join(', ') || 'Sin dato')}</dd><dt>Coordenadas</dt><dd>${isMapped(item) ? `${item.lat.toFixed(6)}, ${item.lon.toFixed(6)}` : 'Sin coordenadas'}</dd></dl>
    </div>
    <div class="tab-pane" data-pane="rm08">
      <div class="priority-card priority-${clean(item.prioridad_rm08).toLowerCase()}"><span>Prioridad de atención según RM08</span><strong>${escapeHtml(item.prioridad_rm08 || 'Sin clasificación')}</strong><em>Índice ${item.indice_rm08 ?? '—'}</em></div>
      <dl><dt>1, 2, 3 2026</dt><dd>${item.prioridades_123_2026.length ? `Clasificación ${escapeHtml(item.prioridades_123_2026.join(', '))} de 464` : 'Sin clasificación'}</dd></dl>
      <p class="method-note">El índice RM08 traduce la prioridad categórica: Alta = 3, Media = 2 y Baja = 1. La clasificación de 1, 2, 3 2026 conserva literalmente su posición; no se suma ni se interpreta como cantidad.</p>
    </div>
    <div class="tab-pane" data-pane="programas">${programCards}</div>
    <div class="tab-pane" data-pane="territorio">
      <dl><dt>Resultado</dt><dd>${escapeHtml(item.observacion_territorial)}</dd><dt>Fracturamiento</dt><dd>${item.cercano_fracturamiento_250m ? 'Sí, dentro de 250 m' : 'No, fuera de 250 m'}</dd><dt>Distancia mínima</dt><dd>${item.distancia_fracturamiento_m === null ? 'Sin información' : `${formatNumber(item.distancia_fracturamiento_m)} m`}</dd><dt>Subsidencia</dt><dd>${escapeHtml(item.clase_subsidencia)}${item.nivel_subsidencia ? ` · nivel ${item.nivel_subsidencia}` : ''}</dd></dl>
      <p class="method-note">La clasificación territorial se recalculó con las coordenadas de esta base. Es una referencia para priorizar revisión técnica y no constituye un dictamen estructural.</p>
    </div>
    <div class="tab-pane" data-pane="fuente">${sourceCards}</div>`;
  q('detailPanel').classList.add('open');
  q('detailContent').querySelectorAll('.tab-btn').forEach(button => button.addEventListener('click', () => activateTab(button.dataset.tab)));
}

function activateTab(tab) {
  q('detailContent').querySelectorAll('.tab-btn').forEach(button => button.classList.toggle('active', button.dataset.tab === tab));
  q('detailContent').querySelectorAll('.tab-pane').forEach(pane => pane.classList.toggle('active', pane.dataset.pane === tab));
}

function renderProgramRecord(ref) {
  const meta = programMap.get(ref.programa);
  return `<details class="program-record" style="--program-color:${escapeHtml(meta?.color || '#174a72')}"><summary>${escapeHtml(meta?.label || ref.programa)} · fila ${formatNumber(ref.registro.source_row)}</summary>${renderFields(ref.registro.campos)}</details>`;
}

function renderFields(fields) {
  return `<div class="records-scroll"><table class="field-table"><tbody>${fields.map(field => `<tr><th>${escapeHtml(field.campo)}</th><td>${escapeHtml(field.valor)}</td></tr>`).join('')}</tbody></table></div>`;
}

function hideSidebar() {
  q('layout').classList.add('sidebar-collapsed');
  q('showSidebar').classList.remove('hidden');
  setTimeout(() => map.invalidateSize(), 220);
}

function showSidebar() {
  q('layout').classList.remove('sidebar-collapsed');
  q('showSidebar').classList.add('hidden');
  setTimeout(() => map.invalidateSize(), 220);
}

async function toggleFullscreen() {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    else await document.exitFullscreen();
  } catch (error) {
    console.warn('Pantalla completa no disponible.', error);
  }
}

function syncFullscreen() {
  const active = Boolean(document.fullscreenElement);
  q('fullscreenButton').textContent = active ? 'Salir de pantalla completa' : 'Pantalla completa';
  q('fullscreenButton').setAttribute('aria-pressed', String(active));
  document.body.classList.toggle('is-fullscreen', active);
  setTimeout(() => map.invalidateSize(), 100);
}
