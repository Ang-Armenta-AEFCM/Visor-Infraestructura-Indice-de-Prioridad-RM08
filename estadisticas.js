'use strict';

const q = id => document.getElementById(id);
const clean = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]));
const fmt = value => Number(value || 0).toLocaleString('es-MX');
const pct = (value, total) => total ? `${(value * 100 / total).toFixed(1)}%` : '0.0%';

let dataset;
let programMap = new Map();
let filtered = [];

init();

async function init() {
  try {
    const response = await fetch('data/rm08_infraestructura.json');
    if (!response.ok) throw new Error(`Error ${response.status}`);
    dataset = await response.json();
    programMap = new Map(dataset.programas.map(program => [program.id, program]));
    buildFilters();
    bindEvents();
    restoreState();
    render();
  } catch (error) {
    console.error(error);
    q('statsContext').textContent = 'No fue posible cargar la información.';
  }
}

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort((a,b) => String(a).localeCompare(String(b), 'es'));
}

function fillSelect(select, values) {
  values.forEach(value => select.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`));
}

function buildFilters() {
  const all = [...dataset.inmuebles, ...dataset.ccts];
  fillSelect(q('stAlcaldia'), unique(all.map(item => item.alcaldia)));
  fillSelect(q('stNivel'), unique(all.flatMap(item => item.niveles)));
  q('stPrograms').innerHTML = dataset.programas.map(program =>
    `<label><input type="checkbox" value="${escapeHtml(program.id)}"><span><i class="program-dot" style="--program-color:${escapeHtml(program.color)}"></i>${escapeHtml(program.label)}</span></label>`
  ).join('');
}

function bindEvents() {
  ['stViewMode','stAlcaldia','stNivel','stPrioridad','stCCT','stNombre','stRankMin','stRankMax'].forEach(id => {
    q(id).addEventListener(id === 'stViewMode' || id.startsWith('stA') || id === 'stNivel' || id === 'stPrioridad' ? 'change' : 'input', render);
  });
  q('stPrograms').addEventListener('change', render);
  document.querySelectorAll('input[name="stRisk"]').forEach(input => input.addEventListener('change', render));
  q('stAllPrograms').onclick = () => setPrograms(true);
  q('stClearPrograms').onclick = () => setPrograms(false);
  q('stClearRisk').onclick = () => {
    document.querySelectorAll('input[name="stRisk"]').forEach(input => input.checked = false);
    render();
  };
  q('stLimpiar').onclick = clearFilters;
}

function setPrograms(checked) {
  document.querySelectorAll('#stPrograms input').forEach(input => input.checked = checked);
  render();
}

function getState() {
  return {
    mode:q('stViewMode').value,
    alcaldia:q('stAlcaldia').value,
    nivel:q('stNivel').value,
    prioridad:q('stPrioridad').value,
    cct:q('stCCT').value,
    nombre:q('stNombre').value,
    rankMin:q('stRankMin').value,
    rankMax:q('stRankMax').value,
    programas:[...document.querySelectorAll('#stPrograms input:checked')].map(input => input.value),
    risk:document.querySelector('input[name="stRisk"]:checked')?.value || ''
  };
}

function restoreState() {
  try {
    const state = JSON.parse(localStorage.getItem('rm08_visor_state') || 'null');
    if (!state) return;
    q('stViewMode').value = state.mode || 'inmueble';
    ['alcaldia','nivel','prioridad'].forEach(field => {
      const id = `st${field.charAt(0).toUpperCase() + field.slice(1)}`;
      if ([...q(id).options].some(option => option.value === state[field])) q(id).value = state[field] || '';
    });
    q('stCCT').value = state.cct || '';
    q('stNombre').value = state.nombre || '';
    q('stRankMin').value = state.rankMin || '';
    q('stRankMax').value = state.rankMax || '';
    document.querySelectorAll('#stPrograms input').forEach(input => input.checked = (state.programas || []).includes(input.value));
    const risk = document.querySelector(`input[name="stRisk"][value="${state.risk}"]`);
    if (risk) risk.checked = true;
  } catch (_) {}
}

function render() {
  if (!dataset) return;
  const state = getState();
  try { localStorage.setItem('rm08_visor_state', JSON.stringify(state)); } catch (_) {}
  const programSet = new Set(state.programas);
  const rankMin = state.rankMin === '' ? null : Number(state.rankMin);
  const rankMax = state.rankMax === '' ? null : Number(state.rankMax);
  const source = state.mode === 'cct' ? dataset.ccts : dataset.inmuebles;
  filtered = source.filter(item => {
    if (state.alcaldia && item.alcaldia !== state.alcaldia) return false;
    if (state.nivel && !item.niveles.includes(state.nivel)) return false;
    if (state.prioridad && item.prioridad_rm08 !== state.prioridad) return false;
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
  updateContext(state);
  updateCards(state);
  updatePriorityTable();
  updateLevelTable();
  updateProgramTable();
  updateRiskTable();
  updateAlcaldiaTable();
  updateRanking(state);
}

function updateContext(state) {
  const tags = [];
  if (state.alcaldia) tags.push(state.alcaldia);
  if (state.nivel) tags.push(state.nivel);
  if (state.prioridad) tags.push(`RM08 ${state.prioridad}`);
  if (state.cct) tags.push(`CCT: ${state.cct}`);
  if (state.nombre) tags.push(`Escuela: ${state.nombre}`);
  if (state.rankMin || state.rankMax) tags.push(`Clasificación ${state.rankMin || 1}–${state.rankMax || 464}`);
  if (state.programas.length) tags.push(`${state.programas.length} programa(s)`);
  if (state.risk) tags.push('Observación territorial');
  q('statsContext').textContent = tags.length ? `Se aplican ${tags.length} criterio(s) de manera simultánea.` : 'Sin filtros: se muestra la base completa.';
  q('statsTags').innerHTML = tags.map(tag => `<span class="mini-tag blue">${escapeHtml(tag)}</span>`).join('');
}

function updateCards(state) {
  const unit = state.mode === 'cct' ? 'CCT' : 'Inmuebles';
  q('stTotalLabel').textContent = `${unit} del resultado`;
  q('stTotal').textContent = fmt(filtered.length);
  q('stMapped').textContent = fmt(filtered.filter(item => Number.isFinite(item.lat) && Number.isFinite(item.lon)).length);
  q('stHigh').textContent = fmt(filtered.filter(item => item.prioridad_rm08 === 'ALTA').length);
  q('stTerritorial').textContent = fmt(filtered.filter(item => item.observacion_territorial !== 'Sin observación').length);
  ['stDistributionUnit','stLevelUnit','stProgramUnit','stRiskUnit','stAlcaldiaUnit'].forEach(id => q(id).textContent = unit);
}

function updatePriorityTable() {
  const labels = ['ALTA','MEDIA','BAJA',''];
  q('tablaDistribucion').innerHTML = labels.map(label => {
    const count = filtered.filter(item => item.prioridad_rm08 === label).length;
    return `<tr><td>${escapeHtml(label || 'Sin clasificación')}</td><td>${fmt(count)}</td><td>${barCell(count, filtered.length)}</td></tr>`;
  }).join('');
}

function updateLevelTable() {
  const rows = groupBy(filtered, item => item.nivel || 'Sin nivel').map(([label, items]) => ({
    label, count:items.length, high:items.filter(item => item.prioridad_rm08 === 'ALTA').length
  })).sort((a,b) => b.count - a.count);
  q('tablaNivel').innerHTML = rows.length ? rows.map(row => `<tr><td>${escapeHtml(row.label)}</td><td>${fmt(row.count)}</td><td>${fmt(row.high)}</td></tr>`).join('') : emptyRow(3);
}

function updateProgramTable() {
  q('tablaProgramas').innerHTML = dataset.programas.map(program => {
    const count = filtered.filter(item => item.programas.includes(program.id)).length;
    return `<tr><td><i class="program-dot" style="--program-color:${escapeHtml(program.color)}"></i>${escapeHtml(program.label)}</td><td>${fmt(count)}</td><td>${barCell(count, filtered.length)}</td></tr>`;
  }).join('');
}

function updateRiskTable() {
  const labels = ['Observación combinada','Cercanía a fracturamiento','Subsidencia alta','Sin observación','Información territorial incompleta'];
  q('tablaRiesgos').innerHTML = labels.map(label => {
    const count = filtered.filter(item => item.observacion_territorial === label).length;
    return `<tr><td>${escapeHtml(label)}</td><td>${fmt(count)}</td><td>${barCell(count, filtered.length)}</td></tr>`;
  }).join('');
}

function updateAlcaldiaTable() {
  const rows = groupBy(filtered, item => item.alcaldia || 'Sin alcaldía').map(([label, items]) => ({
    label, count:items.length,
    high:items.filter(item => item.prioridad_rm08 === 'ALTA').length,
    program:items.filter(item => item.programas.length).length
  })).sort((a,b) => b.count - a.count);
  q('tablaAlcaldia').innerHTML = rows.length ? rows.map(row => `<tr><td>${escapeHtml(row.label)}</td><td>${fmt(row.count)}</td><td>${fmt(row.high)}</td><td>${fmt(row.program)}</td><td>${barCell(row.count, filtered.length)}</td></tr>`).join('') : emptyRow(5);
}

function updateRanking(state) {
  const rows = [...filtered].sort((a,b) =>
    (b.indice_rm08 || 0) - (a.indice_rm08 || 0) ||
    (a.prioridad_123_2026 ?? 9999) - (b.prioridad_123_2026 ?? 9999) ||
    a.nombre.localeCompare(b.nombre, 'es')
  ).slice(0, 500);
  q('stRankingTitle').textContent = `${state.mode === 'cct' ? 'CCT' : 'Inmuebles'} del resultado`;
  q('tablaRanking').innerHTML = rows.length ? rows.map((item,index) => `<tr><td>${index + 1}</td><td>${escapeHtml(item.nombre)}</td><td>${escapeHtml(item.ccts.join(', ') || '—')}</td><td>${escapeHtml(item.alcaldia || '—')}</td><td>${escapeHtml(item.niveles.join(', ') || '—')}</td><td><span class="priority-pill p-${clean(item.prioridad_rm08).toLowerCase()}">${escapeHtml(item.prioridad_rm08 || '—')} · ${item.indice_rm08 ?? '—'}</span></td><td>${item.prioridad_123_2026 ?? '—'}</td><td>${escapeHtml(item.programas.map(id => programMap.get(id)?.label || id).join('; ') || '—')}</td><td>${escapeHtml(item.observacion_territorial)}</td></tr>`).join('') : emptyRow(9);
}

function groupBy(items, getter) {
  const map = new Map();
  items.forEach(item => {
    const key = getter(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  });
  return [...map.entries()];
}

function barCell(value, total) {
  const width = total ? value * 100 / total : 0;
  return `<div class="bar"><span style="width:${width.toFixed(2)}%"></span></div><small>${pct(value,total)}</small>`;
}

function emptyRow(cols) {
  return `<tr><td colspan="${cols}" class="empty-row">No hay resultados para este cruce.</td></tr>`;
}

function clearFilters() {
  ['stAlcaldia','stNivel','stPrioridad','stCCT','stNombre','stRankMin','stRankMax'].forEach(id => q(id).value = '');
  q('stViewMode').value = 'inmueble';
  document.querySelectorAll('#stPrograms input, input[name="stRisk"]').forEach(input => input.checked = false);
  render();
}
