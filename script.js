'use strict';

const DATA = {
  main: 'data/rm08_infraestructura.json',
  supports: 'data/apoyos_detallados.json',
  alcaldias: 'data/alcaldias.json',
  subsidencias: 'data/subsidencias.json',
  fracturamiento: 'data/fracturamiento.json'
};

document.head.insertAdjacentHTML('beforeend', `<style id="support-detail-styles">
.support-detail-list{display:grid;gap:9px}.support-detail{padding:11px;border:1px solid #a7d8c9;border-left:4px solid #0f766e;border-radius:9px;background:#f7fffc}.support-detail-head{display:grid;grid-template-columns:26px 1fr;gap:9px;align-items:start}.support-check{display:grid;place-items:center;width:23px;height:23px;border-radius:50%;background:#0f766e;color:#fff;font-size:14px;font-weight:900;line-height:1}.support-detail-head small{display:block;color:#64748b;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.05em}.support-detail-head strong{display:block;margin-top:2px;color:#134e4a;font-size:12px;line-height:1.35}.support-detail-head em{display:block;margin-top:3px;color:#52677a;font-size:10px;font-style:normal;line-height:1.4}.support-detail>p{margin:9px 0 0 32px!important;color:#64748b;font-size:11px!important;line-height:1.45!important}.support-work-list{display:grid;gap:6px;margin:10px 0 0 32px;padding:0;list-style:none}.support-work-list li{display:grid;grid-template-columns:19px 1fr;gap:7px;align-items:start;padding:7px 8px;border:1px solid #d1fae5;border-radius:7px;background:#fff}.support-work-list li span{display:grid;place-items:center;width:18px;height:18px;border-radius:4px;background:#d1fae5;color:#047857;font-size:11px;font-weight:900}.support-work-list li strong{color:#334155;font-size:11px;line-height:1.4}@media(max-width:600px){.support-work-list,.support-detail>p{margin-left:0!important}}
</style>`);

const q = id => document.getElementById(id);
const clean = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]));
const formatNumber = value => Number(value || 0).toLocaleString('es-MX');
const isMapped = item => Number.isFinite(item.lat) && Number.isFinite(item.lon);

let dataset;
let programMap = new Map();
let maintenanceMap = new Map();
let currentItems = [];
let markersLayer;
let subsidyLayer;
let fractureLayer;
let alcaldiasLayer;
let hasFitResult = false;

const map = L.map('map', {zoomControl:false, preferCanvas:true, minZoom:9}).setView([19.35, -99.13], 10);
L.control.zoom({position:'topright'}).addTo(map);

const baseLayers = {
  'OpenStreetMap': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 20,
    attribution: 'Tiles © Esri'
  }),
  'Mapa claro': L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 20,
    attribution: '© OpenStreetMap © CARTO'
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
      loadMainData(), fetchJson(DATA.alcaldias), fetchJson(DATA.subsidencias), fetchJson(DATA.fracturamiento)
    ]);
    dataset = main;
    programMap = new Map(main.programas.map(program => [program.id, program]));
    maintenanceMap = new Map(main.mantenimiento_variables.map(variable => [variable.id, variable]));
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
    q('mapStatus').textContent = `No fue posible cargar la información del visor: ${error.message}`;
    q('mapStatus').classList.add('error');
  }
}

async function loadMainData() {
  const manifest = await fetchJson(DATA.main);
  if (!Array.isArray(manifest.partes_datos) || !manifest.partes_datos.length) return manifest;
  const [parts, supports] = await Promise.all([
    Promise.all(manifest.partes_datos.map(file => fetchJson(`data/${file}`))),
    fetchJson(DATA.supports)
  ]);
  const updates = Array.isArray(supports.actualizaciones_programas) ? supports.actualizaciones_programas : [];
  const attachSupportDetails = (items, collection) => items.map(item => {
    const details = [...(supports[collection]?.[item.uid] || [])];
    const matchingUpdates = updates.filter(update => item.ccts.includes(update.cct));
    matchingUpdates.forEach(update => {
      if (!details.some(detail => detail.programa === update.programa_nombre && detail.ejecutor === update.ejecutor)) {
        details.push({programa:update.programa_nombre, ejecutor:update.ejecutor});
      }
    });
    const updatedItem = matchingUpdates.reduce((updated, update) => ({
      ...updated,
      programas: [...new Set([...updated.programas, update.programa_id])],
      mejoras_previas: [...new Set([...updated.mejoras_previas, update.programa_label])],
      mejoras_previas_ids: [...new Set([...updated.mejoras_previas_ids, update.programa_id])],
      tuvo_apoyo_previo: true,
      apoyos_recibidos_detalle: details
    }), {...item});
    if (updatedItem.programas.includes('ilife_180_2026')) {
      updatedItem.mejoras_previas = updatedItem.mejoras_previas.map(label => label === '180 ILIFE · 2026' ? '181 ILIFE · 2026' : label);
    }
    return {...updatedItem, apoyos_recibidos_detalle:details};
  });
  const inmuebles = attachSupportDetails(parts.flatMap(part => part.inmuebles || []), 'inmuebles');
  const ccts = attachSupportDetails(parts.flatMap(part => part.ccts || []), 'ccts');
  const programas = manifest.programas.map(program => ({
    ...program,
    label: program.id === 'ilife_180_2026' ? '181 ILIFE · 2026' : program.label,
    count: program.id === 'ilife_180_2026' ? 181 : program.count
  }));
  return {
    ...manifest,
    programas,
    inmuebles,
    ccts
  };
}

async function fetchJson(url) {
  const response = await fetch(url, {cache:'no-store'});
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
  q('maintenanceFilters').innerHTML = dataset.mantenimiento_variables.map(variable =>
    `<label class="inline-check" title="${escapeHtml(variable.nombre_completo)}"><input type="checkbox" value="${escapeHtml(variable.id)}"><span>${escapeHtml(variable.nombre)} <small>· ${variable.peso} pts</small></span></label>`
  ).join('');
  refreshDatalists();
  q('coverageNote').textContent = `${formatNumber(dataset.metadata.inmuebles_con_indice_final)} de ${formatNumber(dataset.metadata.total_inmuebles)} inmuebles tienen índice final completo · ${formatNumber(dataset.metadata.registros_sin_coordenadas)} registros fuente sin coordenadas no se dibujan.`;
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
  bindSearchFocus(q('buscarCCT'), 'cct');
  bindSearchFocus(q('buscarNombre'), 'nombre');
  q('priorityFilters').addEventListener('change', () => render(false));
  document.querySelectorAll('input[name="riskMode"]').forEach(input => input.addEventListener('change', () => render(false)));
  q('programFilters').addEventListener('change', () => render(false));
  q('maintenanceFilters').addEventListener('change', () => render(false));
  q('selectAllProgramas').onclick = () => setChecks('#programFilters input', true);
  q('clearProgramas').onclick = () => setChecks('#programFilters input', false);
  q('selectAllMantenimiento').onclick = () => setChecks('#maintenanceFilters input', true);
  q('clearMantenimiento').onclick = () => setChecks('#maintenanceFilters input', false);
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
  q('toggleMantenimiento').onclick = () => toggleMenu('mantenimientoBody','mantenimientoArrow','toggleMantenimiento');
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

function selectedMaintenance() {
  return [...document.querySelectorAll('#maintenanceFilters input:checked')].map(input => input.value);
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
    mantenimiento: selectedMaintenance(),
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
    document.querySelectorAll('#maintenanceFilters input').forEach(input => input.checked = (state.mantenimiento || []).includes(input.value));
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
  const maintenanceSet = new Set(state.mantenimiento);
  const prioritySet = new Set(state.prioridades);
  const rankMin = state.rankMin === '' ? null : Number(state.rankMin);
  const rankMax = state.rankMax === '' ? null : Number(state.rankMax);
  currentItems = activeItems().filter(item => {
    if (state.alcaldia && item.alcaldia !== state.alcaldia) return false;
    if (state.nivel && !item.niveles.includes(state.nivel)) return false;
    if (prioritySet.size && !prioritySet.has(item.clase_prioridad_final)) return false;
    if (state.cct && !clean(item.ccts.join(' ')).includes(clean(state.cct))) return false;
    if (state.nombre && !clean(item.nombres.join(' ')).includes(clean(state.nombre))) return false;
    if (rankMin !== null && (item.prioridad_123_2026 === null || item.prioridad_123_2026 < rankMin)) return false;
    if (rankMax !== null && (item.prioridad_123_2026 === null || item.prioridad_123_2026 > rankMax)) return false;
    if (programSet.size && !item.programas.some(program => programSet.has(program))) return false;
    if (maintenanceSet.size && !item.mantenimiento_pendientes.some(variable => maintenanceSet.has(variable))) return false;
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
      fillColor:priorityColor(item.clase_prioridad_final),
      fillOpacity:.9
    });
    marker.bindTooltip(`<div class="popup-title">${escapeHtml(item.nombre)}</div><div class="popup-meta">${escapeHtml(item.ccts.join(', ') || 'Sin CCT')} · ${escapeHtml(item.clase_prioridad_final)}${item.indice_prioridad_final === null ? '' : ` · IPA ${item.indice_prioridad_final.toFixed(1)}`}</div>`, {sticky:true});
    marker.on('click', () => showDetail(item));
    marker.addTo(markersLayer);
  });
}

function priorityColor(priority) {
  return ({'Muy alta':'#991b1b', 'Alta':'#dc2626', 'Media':'#f59e0b', 'Baja':'#65a30d', 'Muy baja':'#16a34a'})[priority] || '#64748b';
}

function updateSummary(state) {
  q('kpi1').textContent = formatNumber(currentItems.length);
  q('kpiLabel1').textContent = activeMode() === 'cct' ? 'CCT' : 'Inmuebles';
  q('kpi2').textContent = formatNumber(currentItems.filter(item => ['Alta','Muy alta'].includes(item.clase_prioridad_final)).length);
  q('kpi3').textContent = formatNumber(currentItems.filter(item => item.programas.length).length);
  q('kpi4').textContent = formatNumber(currentItems.filter(item => item.observacion_territorial !== 'Sin observación').length);
  q('kpi5').textContent = formatNumber(currentItems.filter(item => item.tuvo_apoyo_previo).length);
  q('kpi6').textContent = formatNumber(currentItems.filter(item => item.mantenimiento_pendientes.length).length);
  const parts = [];
  if (state.prioridades.length) parts.push(`IPA: ${state.prioridades.map(value => value.toLowerCase()).join(', ')}`);
  if (state.programas.length) parts.push(`${state.programas.length} mejora(s)`);
  if (state.mantenimiento.length) parts.push(`${state.mantenimiento.length} necesidad(es) de mantenimiento`);
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

function bindSearchFocus(input, type) {
  const focus = () => focusSearchResult(type, input.value);
  input.addEventListener('change', focus);
  input.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    focus();
  });
}

function focusSearchResult(type, rawValue) {
  const value = clean(rawValue);
  if (!value) return;
  const items = activeItems();
  const values = item => type === 'cct' ? item.ccts : item.nombres;
  const item = items.find(candidate => values(candidate).some(entry => clean(entry) === value))
    || items.find(candidate => values(candidate).some(entry => clean(entry).includes(value)));
  if (!item) return;
  if (isMapped(item)) map.setView([item.lat, item.lon], 17, {animate:true});
  showDetail(item);
}

function clearFilters() {
  ['filtroAlcaldia','filtroNivel','buscarCCT','buscarNombre','rankMin','rankMax'].forEach(id => q(id).value = '');
  document.querySelectorAll('#priorityFilters input, #programFilters input, #maintenanceFilters input, input[name="riskMode"]').forEach(input => input.checked = false);
  hasFitResult = false;
  render(true);
}

function showDetail(item) {
  q('detailTitle').textContent = item.nombre;
  const prioritySlug = clean(item.clase_prioridad_final).toLowerCase().replace(/\s+/g, '-');
  const programCards = item.programa_registros.length
    ? item.programa_registros.map(ref => renderProgramRecord(ref)).join('')
    : '<p class="muted-box">No hay registros de mejoras vinculados a esta unidad.</p>';
  const supportDetails = renderSupportDetails(item);
  const maintenanceCards = item.mantenimiento_disponible
    ? (item.mantenimiento_pendientes.length
      ? item.mantenimiento_pendientes.map(renderMaintenanceNeed).join('')
      : '<p class="status-box status-ok">El diagnóstico no reporta necesidades pendientes en las variables evaluadas.</p>')
    : '<p class="status-box status-missing">Este inmueble no cuenta con diagnóstico de mantenimiento en la nueva base. No se interpreta como ausencia de necesidades.</p>';
  const sourceCards = item.registros_principales.map((record, index) =>
    `<details class="source-details"${index === 0 ? ' open' : ''}><summary>Registro principal · fila ${formatNumber(record.source_row)}</summary>${renderFields(record.datos_principales)}</details>`
  ).join('');
  q('detailContent').innerHTML = `
    <div class="detail-tabs">
      <button class="tab-btn active" data-tab="general">General</button>
      <button class="tab-btn" data-tab="prioridad">Prioridad</button>
      <button class="tab-btn" data-tab="mantenimiento">Mantenimiento <span class="tab-count">${item.mantenimiento_pendientes.length}</span></button>
      <button class="tab-btn" data-tab="programas">Mejoras <span class="tab-count">${item.programa_registros.length}</span></button>
      <button class="tab-btn" data-tab="territorio">Territorio</button>
      <button class="tab-btn" data-tab="fuente">Datos fuente</button>
    </div>
    <div class="tab-pane active" data-pane="general">
      <dl><dt>Unidad</dt><dd>${item.tipo === 'cct' ? 'CCT' : 'Inmueble'}</dd><dt>Código DGA</dt><dd>${escapeHtml(item.codigos_dga.join(', ') || 'Sin dato')}</dd><dt>CCT</dt><dd>${escapeHtml(item.ccts.join(', ') || 'Sin CCT')}</dd><dt>Alcaldía</dt><dd>${escapeHtml(item.alcaldia || 'Sin dato')}</dd><dt>Colonia</dt><dd>${escapeHtml(item.colonia || 'Sin dato')}</dd><dt>Domicilio</dt><dd>${escapeHtml(item.domicilio || 'Sin dato')}</dd><dt>Nivel</dt><dd>${escapeHtml(item.niveles.join(', ') || 'Sin dato')}</dd><dt>Coordenadas</dt><dd>${isMapped(item) ? `${item.lat.toFixed(6)}, ${item.lon.toFixed(6)}` : 'Sin coordenadas'}</dd></dl>
      <div class="support-summary ${item.tuvo_apoyo_previo ? 'has-support' : ''}"><span>Apoyo previo identificado</span><strong>${item.tuvo_apoyo_previo ? 'Sí' : 'No'}</strong></div>
      ${item.tuvo_apoyo_previo ? `<h3 class="section-subtitle">Apoyos y trabajos recibidos</h3>${supportDetails}` : ''}
    </div>
    <div class="tab-pane" data-pane="prioridad">
      <div class="priority-card priority-${prioritySlug}"><span>Índice de Prioridad de Atención</span><strong>${escapeHtml(item.clase_prioridad_final)}</strong><em>${item.indice_prioridad_final === null ? 'Sin índice completo' : `${item.indice_prioridad_final.toFixed(1)} / 100`}</em></div>
      <dl><dt>Condición de mantenimiento</dt><dd>${item.indice_mantenimiento === null ? 'Sin información' : `${item.indice_mantenimiento.toFixed(1)} / 100 · ${escapeHtml(item.clase_mantenimiento)}`}</dd><dt>Peligro territorial</dt><dd>${item.indice_peligro_territorial === null ? 'Sin información' : `${item.indice_peligro_territorial.toFixed(1)} / 100 · ${escapeHtml(item.clase_peligro_territorial)}`}</dd><dt>Calidad del índice</dt><dd>${escapeHtml(item.calidad_indice_final)}</dd><dt>Alerta</dt><dd>${escapeHtml(item.alerta_prioridad)}</dd><dt>Prioridad RM08 original</dt><dd>${escapeHtml(item.prioridad_rm08_original || 'Sin clasificación')} · índice ${item.indice_rm08_original ?? '—'}</dd><dt>1, 2, 3 2026</dt><dd>${item.prioridades_123_2026.length ? `Clasificación ${escapeHtml(item.prioridades_123_2026.join(', '))} de 464` : 'Sin clasificación'}</dd></dl>
      <p class="method-note">Índice final = 60% condición de mantenimiento + 40% peligro territorial. El peligro territorial combina 70% subsidencia/hundimiento y 30% cercanía a fracturas. Los faltantes no se convierten en cero.</p>
    </div>
    <div class="tab-pane" data-pane="mantenimiento">
      <div class="maintenance-score"><span>Condición de mantenimiento</span><strong>${item.indice_mantenimiento === null ? 'Sin diagnóstico' : `${item.indice_mantenimiento.toFixed(1)} / 100`}</strong><small>${escapeHtml(item.clase_mantenimiento)} · ${escapeHtml(item.alerta_mantenimiento)}</small></div>
      ${item.mantenimiento_transformador ? '<p class="context-note">El inmueble reporta subestación o transformador. Este dato no suma puntos, pero especializa la revisión eléctrica.</p>' : ''}
      <div class="maintenance-detail-list">${maintenanceCards}</div>
    </div>
    <div class="tab-pane" data-pane="programas">
      <div class="support-summary ${item.tuvo_apoyo_previo ? 'has-support' : ''}"><span>Apoyo previo identificado</span><strong>${item.tuvo_apoyo_previo ? 'Sí' : 'No'}</strong></div>
      <h3 class="section-subtitle">Apoyos y trabajos recibidos</h3>${supportDetails}
      <h3 class="section-subtitle">Registros de mejoras</h3>${programCards}
    </div>
    <div class="tab-pane" data-pane="territorio">
      <dl><dt>Índice territorial</dt><dd>${item.indice_peligro_territorial === null ? 'Sin información' : `${item.indice_peligro_territorial.toFixed(1)} / 100 · ${escapeHtml(item.clase_peligro_territorial)}`}</dd><dt>Calidad territorial</dt><dd>${escapeHtml(item.calidad_peligro_territorial)}</dd><dt>Resultado de observación</dt><dd>${escapeHtml(item.observacion_territorial)}</dd><dt>Fracturamiento</dt><dd>${item.cercano_fracturamiento_250m ? 'Sí, dentro de 250 m' : item.distancia_fracturamiento_m === null ? 'Sin información' : 'No, fuera de 250 m'}</dd><dt>Distancia mínima</dt><dd>${item.distancia_fracturamiento_m === null ? 'Sin información' : `${formatNumber(item.distancia_fracturamiento_m)} m · nivel ${item.nivel_fracturamiento}`}</dd><dt>Subsidencia/hundimiento</dt><dd>${escapeHtml(item.clase_subsidencia)}${item.nivel_subsidencia ? ` · nivel ${item.nivel_subsidencia}` : ''}</dd></dl>
      <p class="method-note">La proximidad a fracturas y la clasificación de subsidencia son referencias territoriales para ordenar revisiones; no constituyen un dictamen estructural.</p>
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

function renderMaintenanceNeed(variableId) {
  const variable = maintenanceMap.get(variableId);
  if (!variable) return '';
  return `<article class="maintenance-need"><div><span>${escapeHtml(variable.grupo)}</span><strong>${escapeHtml(variable.nombre_completo)}</strong></div><b>${variable.peso} pts</b><p>${escapeHtml(variable.descripcion)}</p></article>`;
}

function renderSupportDetails(item) {
  const supports = Array.isArray(item.apoyos_recibidos_detalle) ? item.apoyos_recibidos_detalle : [];
  if (!item.tuvo_apoyo_previo) return '<p class="muted-box">No se identificaron apoyos previos vinculados.</p>';
  if (!supports.length) {
    return item.mejoras_previas.length
      ? `<div class="support-detail-list">${item.mejoras_previas.map(programa => `<article class="support-detail"><div class="support-detail-head"><span class="support-check" aria-hidden="true">✓</span><div><small>Programa de apoyo</small><strong>${escapeHtml(programa)}</strong></div></div><p>El padrón confirma el apoyo, pero la base no incluye el desglose de los trabajos.</p></article>`).join('')}</div>`
      : '<p class="muted-box">El padrón confirma apoyo previo, pero no incluye su desglose.</p>';
  }
  return `<div class="support-detail-list">${supports.map(support => {
    const metadata = [
      support.ejecutor ? `Ejecutor: ${support.ejecutor}` : '',
      support.etapa || '',
      support.estado || '',
      support.contrato ? `Contrato: ${support.contrato}` : ''
    ].filter(Boolean);
    const works = Array.isArray(support.trabajos) ? support.trabajos : [];
    return `<article class="support-detail">
      <div class="support-detail-head"><span class="support-check" aria-hidden="true">✓</span><div><small>Programa de apoyo</small><strong>${escapeHtml(support.programa || 'Apoyo registrado')}</strong>${metadata.length ? `<em>${metadata.map(escapeHtml).join(' · ')}</em>` : ''}</div></div>
      ${works.length ? `<ul class="support-work-list">${works.map(work => `<li><span aria-hidden="true">✓</span><strong>${escapeHtml(work)}</strong></li>`).join('')}</ul>` : '<p>El padrón confirma el apoyo, pero la base no incluye el desglose de los trabajos.</p>'}
    </article>`;
  }).join('')}</div>`;
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
