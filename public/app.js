const API = (window.API_URL || '').replace(/\/$/, '');
const $ = (sel) => document.querySelector(sel);

let catalogo = [];
let estudiantes = [];

async function api(path, options) {
  const res = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- Pestañas ---------- */
document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.panel').forEach((p) => (p.hidden = p.id !== `tab-${btn.dataset.tab}`));
  });
});

/* ---------- Tablero ---------- */
async function cargarTablero() {
  $('#lista').innerHTML = '<p class="muted">Cargando…</p>';
  const [m, e] = await Promise.all([api('/api/misiones'), api('/api/estudiantes')]);
  if (!m.ok || !e.ok) {
    $('#lista').innerHTML = '<p class="muted">No se pudo conectar con la API.</p>';
    return;
  }
  catalogo = m.data;
  estudiantes = e.data;
  renderCatalogo();
  renderMisionesForm();
  renderTablero();
}

function renderTablero() {
  const q = $('#buscar').value.trim().toLowerCase();
  const filtro = $('#filtro').value;
  const total = catalogo.length;

  const totalCompletadas = estudiantes.reduce((a, e) => a + e.resumen.completadas, 0);
  const completos = estudiantes.filter((e) => total && e.resumen.completadas === total).length;
  const promedio = estudiantes.length ? Math.round(estudiantes.reduce((a, e) => a + e.resumen.porcentaje, 0) / estudiantes.length) : 0;
  $('#stats').innerHTML = `
    <div class="stat"><b>${estudiantes.length}</b><span>Estudiantes</span></div>
    <div class="stat"><b>${total}</b><span>Misiones en catálogo</span></div>
    <div class="stat"><b>${totalCompletadas}</b><span>Misiones completadas</span></div>
    <div class="stat"><b>${completos}</b><span>Estudiantes al 100%</span></div>
    <div class="stat"><b>${promedio}%</b><span>Avance promedio</span></div>`;

  const visibles = estudiantes.filter((e) => {
    const texto = `${e.nombre} ${e.carnet} ${e.correo}`.toLowerCase();
    if (q && !texto.includes(q)) return false;
    if (filtro === 'completos') return e.resumen.completadas === total;
    if (filtro === 'pendientes') return e.resumen.completadas < total;
    return true;
  });

  if (!visibles.length) {
    $('#lista').innerHTML = '<p class="muted">No hay estudiantes que coincidan.</p>';
    return;
  }

  $('#lista').innerHTML = visibles
    .map((e) => {
      const porId = new Map(e.misiones.map((m) => [m.misionId, m]));
      const chips = catalogo
        .map((c) => {
          const m = porId.get(c.misionId);
          const cls = !m ? 'none' : m.estado ? 'done' : 'todo';
          const tip = !m ? 'Sin registrar' : m.estado ? 'Completada' : 'Pendiente';
          return `<span class="${cls}" title="${tip}">${esc(c.nombre)}</span>`;
        })
        .join('');
      return `
        <article class="est">
          <div>
            <h3>${esc(e.nombre)}</h3>
            <div class="meta">${esc(e.carnet)} · ${esc(e.correo)}</div>
          </div>
          <div class="pct">${e.resumen.completadas}/${e.resumen.totalMisiones}<div class="meta">${e.resumen.porcentaje}%</div></div>
          <div class="bar"><div style="width:${e.resumen.porcentaje}%"></div></div>
          <div class="mis">${chips}</div>
        </article>`;
    })
    .join('');
}

$('#buscar').addEventListener('input', renderTablero);
$('#filtro').addEventListener('change', renderTablero);
$('#recargar').addEventListener('click', cargarTablero);

/* ---------- Catálogo ---------- */
function renderCatalogo() {
  $('#catalogo').innerHTML = catalogo
    .map((m) => `<div class="card"><b>#${m.misionId}</b><strong>${esc(m.nombre)}</strong><span class="muted">${esc(m.descripcion)}</span></div>`)
    .join('');
}

/* ---------- Registro ---------- */
const form = $('#form-registro');

function renderMisionesForm() {
  const previos = leerEstadosForm();
  $('#misiones-form').innerHTML = catalogo
    .map(
      (m) => `
      <div class="m">
        <span>#${m.misionId} ${esc(m.nombre)}</span>
        <select data-mision="${m.misionId}">
          <option value="">No enviar</option>
          <option value="true">Completada (true)</option>
          <option value="false">Pendiente (false)</option>
        </select>
      </div>`
    )
    .join('');
  for (const [id, v] of Object.entries(previos)) {
    const sel = form.querySelector(`select[data-mision="${id}"]`);
    if (sel) sel.value = v;
  }
  actualizarJson();
}

function leerEstadosForm() {
  const out = {};
  form.querySelectorAll('select[data-mision]').forEach((s) => (out[s.dataset.mision] = s.value));
  return out;
}

function construirPayload() {
  const f = new FormData(form);
  return {
    maestro: {
      carnet: (f.get('carnet') || '').trim(),
      nombre: (f.get('nombre') || '').trim(),
      correo: (f.get('correo') || '').trim(),
    },
    detalle: [...form.querySelectorAll('select[data-mision]')]
      .filter((s) => s.value !== '')
      .map((s) => ({ misionId: Number(s.dataset.mision), estado: s.value === 'true' })),
  };
}

function actualizarJson() {
  $('#json').value = JSON.stringify(construirPayload(), null, 2);
}

form.addEventListener('input', actualizarJson);
form.addEventListener('change', actualizarJson);

function mostrarRespuesta(r) {
  const el = $('#respuesta');
  el.className = `respuesta ${r.ok ? 'ok' : 'err'}`;
  el.textContent = `HTTP ${r.status}\n` + JSON.stringify(r.data, null, 2);
}

async function enviar(body, boton) {
  boton.disabled = true;
  try {
    const r = await api('/api/registro', { method: 'POST', body });
    mostrarRespuesta(r);
    if (r.ok) cargarTablero();
  } catch (err) {
    mostrarRespuesta({ ok: false, status: 0, data: { error: err.message } });
  } finally {
    boton.disabled = false;
  }
}

form.addEventListener('submit', (ev) => {
  ev.preventDefault();
  enviar(JSON.stringify(construirPayload()), ev.submitter || form.querySelector('button[type=submit]'));
});

$('#enviar-json').addEventListener('click', (ev) => {
  enviar($('#json').value, ev.currentTarget);
});

$('#cargar-carnet').addEventListener('click', async () => {
  const carnet = form.carnet.value.trim();
  if (!carnet) return mostrarRespuesta({ ok: false, status: 0, data: { error: 'Escribe un carnet primero.' } });
  const r = await api(`/api/estudiantes/${encodeURIComponent(carnet)}`);
  if (!r.ok) return mostrarRespuesta(r);
  form.nombre.value = r.data.nombre;
  form.correo.value = r.data.correo;
  form.querySelectorAll('select[data-mision]').forEach((s) => (s.value = ''));
  for (const m of r.data.misiones) {
    const sel = form.querySelector(`select[data-mision="${m.misionId}"]`);
    if (sel) sel.value = String(m.estado);
  }
  actualizarJson();
});

cargarTablero();
