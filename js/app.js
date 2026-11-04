import {
  addMonths, computeCard, parseYM, todayISO, round2, hasNum, cycleDates,
  nextPayday, shiftPayday, asignacionesDe, addDayISO,
} from './logic.js';
import { createStore } from './store.js';

/* ---------- utilidades ---------- */
const $ = (s, el = document) => el.querySelector(s);
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const COLORES = ['#006847', '#111411', '#5DAA2E', '#2E5E8C', '#A8432B', '#8A6D1F'];
const TIENDAS = ['Walmart', 'Aurrera', '3B', 'Supercito', 'Otros'];
const moneyFmt = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
const money = (n) => (n === null || n === undefined || Number.isNaN(n) ? '—' : moneyFmt.format(n));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const toDate = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
const fechaCorta = (iso) => (iso ? toDate(iso).toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/\./g, '') : '—');
const fechaLarga = (iso) => toDate(iso).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
const mesLargo = (k) => { const { y, m } = parseYM(k); return `${MESES[m - 1]} ${y}`; };
const ahora = () => new Date().toTimeString().slice(0, 5);
const plural = (n, s, p) => `${n} ${n === 1 ? s : p}`;
// Acepta "1,250.50", "1250.5" y también coma decimal "125,50".
function parseMonto(raw) {
  let s = String(raw ?? '').trim().replace(/\s/g, '').replace(/\$/g, '');
  if (!s) return NaN;
  if (/,\d{1,2}$/.test(s) && !/\.\d/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = Number(s.replace(/[^\d.\-]/g, ''));
  return Number.isFinite(n) ? n : NaN;
}

/* ---------- estado ---------- */
const D = { cards: {}, periodos: {}, movs: {}, super: {} };
const hoy0 = todayISO();
const ui = {
  tab: leer('cg-tab') || 'tarjetas',
  mes: hoy0.slice(0, 7),
  payday: nextPayday(hoy0),
  movPasados: false,
  tienda: TIENDAS.includes(leer('cg-tienda')) ? leer('cg-tienda') : 'Walmart',
  draft: nuevoDraft(),
  editMov: null,
  sheet: null,
  cardEdit: null,
  armed: null,
  tips: new Set(),
  contraidas: new Set((() => { try { return JSON.parse(leer('cg-contraidas') || '[]'); } catch { return []; } })()),
  cargado: false,
  error: '',
};
let store = null, user = null, unwatch = null, toastT = null;

function leer(k) { try { return localStorage.getItem(k); } catch { return null; } }
function guardar(k, v) { try { localStorage.setItem(k, v); } catch { /* nada */ } }
function nuevoDraft(extra = {}) {
  return { tipo: 'gasto', monto: '', concepto: '', metodo: '', cardId: null, fecha: todayISO(), hora: ahora(), ...extra };
}
const cards = () => Object.values(D.cards).sort((a, b) => a.diaCorte - b.diaCorte || a.nombre.localeCompare(b.nombre));

function toast(msg, accion) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>${accion ? `<button data-act="toast">${esc(accion.label)}</button>` : ''}`;
  t.hidden = false;
  toast.fn = accion?.fn || null;
  clearTimeout(toastT);
  toastT = setTimeout(() => { t.hidden = true; }, accion ? 6000 : 2600);
}

async function put(c, id, patch) {
  try { return await store.put(c, id, patch); } catch (e) { toast('No se pudo guardar. Revisa tu conexión.'); throw e; }
}
async function del(c, id) {
  try { await store.del(c, id); } catch (e) { toast('No se pudo borrar. Revisa tu conexión.'); }
}

/* ---------- render principal ---------- */
function render() {
  const foco = document.activeElement?.id;
  document.querySelectorAll('#tabs button').forEach((b) => {
    if (b.dataset.tab === ui.tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  $('#who').innerHTML = !user ? '' : store.mode === 'firebase'
    ? `<span>${esc(user.name)}</span><button class="link" data-act="signOut">Salir</button>`
    : '<span class="tag neutro">Modo demo</span>';

  const v = $('#view');
  const fab = $('#fab');
  if (store?.mode === 'firebase' && !user) { v.innerHTML = vLogin(); fab.hidden = true; return; }
  if (!ui.cargado) { v.innerHTML = '<div class="empty"><b>Cargando…</b>Trayendo tus datos.</div>'; fab.hidden = true; return; }

  fab.hidden = ui.tab !== 'tarjetas';
  fab.textContent = '+ Tarjeta';
  fab.dataset.act = 'addCard';
  const pendQ = asignacionesDe(cards(), D.periodos, nextPayday(todayISO()), todayISO(), movsList()).some((a) => a.q.monto && !a.q.separada);
  $('#qDot').hidden = !pendQ;

  v.innerHTML = (store.mode === 'local' ? demoNote() : '') + (ui.error ? `<div class="note err">${esc(ui.error)}</div>` : '') +
    ({ tarjetas: vTarjetas, quincenas: vQuincenas, movimientos: vMovimientos, super: vSuper })[ui.tab]();
  if (ui.sheet && !$('#sheet .panel')) renderSheet();
  if (foco) document.getElementById(foco)?.focus({ preventScroll: true });
}

function vLogin() {
  return `<div class="login"><h1>Control de gastos</h1>
    <p>Tus tarjetas, quincenas, movimientos y lista del súper en un solo lugar. Inicia sesión con Google para guardarlos en tu cuenta.</p>
    <button class="btn primary" data-act="signIn">Iniciar sesión con Google</button>
    ${ui.error ? `<p class="msg" style="color:var(--bad)">${esc(ui.error)}</p>` : ''}</div>`;
}
function demoNote() {
  return `<div class="note"><span><b>Modo demo:</b> se guarda solo en este navegador. Configura Firebase para sincronizar.</span>
    <span class="row"><button data-act="seed">Cargar ejemplo</button><button data-act="reset">${ui.armed === 'reset' ? 'Confirmar borrar todo' : 'Borrar todo'}</button></span></div>`;
}

/* ---------- Tarjetas ---------- */
function filasMes() {
  return cards().filter((c) => c.mesInicial <= ui.mes).map((card) => {
    const rows = computeCard(card, D.periodos, ui.mes, todayISO(), movsList());
    return { card, r: rows[rows.length - 1] };
  });
}
const movsList = () => Object.values(D.movs);
function estadoTag(e) {
  switch (e.tipo) {
    case 'ok': return '<span class="tag ok">Pagado a tiempo</span>';
    case 'tarde': return `<span class="tag mal">Pagado con ${plural(e.dias, 'día', 'días')} de atraso</span>`;
    case 'vencido': return `<span class="tag mal">Vencido hace ${plural(e.dias, 'día', 'días')}</span>`;
    case 'captura': return '<span class="tag neutro">Captura el pago</span>';
    case 'saldada': return '<span class="tag ok">Sin deuda</span>';
    default: return e.dias <= 3 ? `<span class="tag alerta">Vence en ${plural(e.dias, 'día', 'días')}</span>` : `<span class="tag">Vence en ${e.dias} días</span>`;
  }
}

/* Tarjetas pendientes de pagar: el corte más reciente (ya ocurrido) de cada tarjeta que no está marcado como pagado. */
function pendientesDePago() {
  const hoy = todayISO(), mesHoy = hoy.slice(0, 7);
  const out = [];
  for (const card of cards()) {
    if (card.mesInicial > mesHoy) continue;
    const rows = computeCard(card, D.periodos, mesHoy, hoy, movsList()).filter((r) => r.corte <= hoy);
    const sinPagar = rows.filter((r) => !r.pagado && r.estado.tipo !== 'saldada');
    if (!sinPagar.length) continue;
    const r = sinPagar[sinPagar.length - 1];
    if (rows[rows.length - 1] !== r) continue; // el corte más reciente ya está pagado
    out.push({ card, r, anteriores: sinPagar.length - 1 });
  }
  return out.sort((a, b) => a.r.limite.localeCompare(b.r.limite));
}

function vPendientes() {
  const lista = pendientesDePago();
  if (!cards().length) return '';
  if (!lista.length) return '<div class="pend ok"><span class="label">Pendientes de pago</span><p>Todas tus tarjetas están pagadas según sus cortes más recientes.</p></div>';
  const total = round2(lista.reduce((t, { r }) => t + (r.capturado ? r.pagoMes : 0), 0));
  return `<section class="pend"><div class="row spread"><span class="label">Pendientes de pago · ${lista.length}</span>${total ? `<span class="num">${money(total)}</span>` : ''}</div>
    <ul>${lista.map(({ card, r, anteriores }) => `<li><button class="pend-it" data-act="irPend" data-mes="${r.mes}" data-card="${esc(card.id)}">
      <span class="plastic sm" style="background:${esc(card.color || COLORES[0])}"></span>
      <span class="pend-t"><b>${esc(card.nombre)}</b><small>Corte ${esc(fechaCorta(r.corte))} · paga el ${esc(fechaCorta(r.limite))}${anteriores ? ` · ${plural(anteriores, 'corte anterior', 'cortes anteriores')} sin pagar` : ''}</small></span>
      <span class="pend-r"><span class="num">${r.capturado ? money(r.pagoMes) : 'Sin capturar'}</span>${estadoTag(r.estado)}</span></button></li>`).join('')}</ul></section>`;
}

function vTarjetas() {
  const filas = filasMes();
  let h = `<h1>Tarjetas</h1>${vPendientes()}
    <div class="nav"><button class="round" data-act="mesPrev" aria-label="Mes anterior">‹</button>
      <div class="center"><span class="label">Corte de</span><b>${esc(mesLargo(ui.mes))}</b></div>
      <button class="round" data-act="mesNext" aria-label="Mes siguiente">›</button></div>`;
  if (ui.mes !== todayISO().slice(0, 7)) h += `<p class="sub" style="text-align:center;margin-top:-8px"><button class="link" data-act="mesHoy">Ir al mes actual</button></p>`;
  if (!filas.length) {
    return h + (cards().length
      ? '<div class="empty"><b>Ninguna tarjeta en este mes</b>Tus tarjetas empiezan en un mes posterior.</div>'
      : '<div class="empty"><b>Agrega tu primera tarjeta</b>Necesitas el nombre, el día de corte, el día límite de pago y la deuda actual. Toca “+ Tarjeta”.</div>');
  }
  let deuda = 0, pagos = 0, sep = 0, fin = 0;
  filas.forEach(({ r }) => {
    deuda += r.deudaActual; fin += r.deudaFinal; if (r.capturado) pagos += r.pagoMes;
    r.quincenas.forEach((q) => { if (q.monto && q.separada) sep += q.monto; });
  });
  const pct = pagos ? Math.min(100, Math.round((sep / pagos) * 100)) : 0;
  h += `<div class="kpis">
    <div class="kpi"><span class="label">Deuda actual</span><b>${money(round2(deuda))}</b></div>
    <div class="kpi"><span class="label">Pagos del corte</span><b>${money(round2(pagos))}</b></div>
    <div class="kpi"><span class="label">Separado</span><b>${money(round2(sep))}</b><div class="bar"><i style="width:${pct}%"></i></div></div>
    <div class="kpi dark"><span class="label">Deuda final</span><b>${money(round2(fin))}</b></div></div>`;
  h += `<div class="stack">${filas.map(tarjetaTC).join('')}</div>`;
  h += `<p class="sub" style="margin-top:14px">Deuda actual = deuda final del mes anterior + compras anotadas con la tarjeta en ese corte + intereses del mes. Deuda final = deuda actual − monto pagado. Escribe en cada quincena el monto que separaste y márcala cuando lo tengas apartado.</p>`;
  return h;
}

function attrs(card, r) { return `data-card="${esc(card.id)}" data-mes="${r.mes}"`; }
function ckQ(card, r, q, pre) {
  const id = `${pre}-${card.id}-${r.mes}-${q.n}`;
  const mid = `qm-${card.id}-${r.mes}-${q.n}`;
  return `<div class="ck"><input type="checkbox" id="${id}" data-ch="q" data-n="${q.n}" ${attrs(card, r)} ${q.separada ? 'checked' : ''}>
    <label class="box" for="${id}"></label><label class="t" for="${id}">${q.n}ª quincena · ${esc(fechaCorta(q.fecha))}${q.separada && q.fechaSep ? `<small>Separado el ${esc(fechaCorta(q.fechaSep))}</small>` : ''}</label>
    <input class="qm" id="${mid}" inputmode="decimal" data-ch="qMonto" data-n="${q.n}" ${attrs(card, r)} value="${q.monto ?? ''}" placeholder="0.00" aria-label="Monto a separar en la ${q.n}ª quincena"></div>`;
}

// Nota de cuánto conviene separar por quincena. Solo informa: no llena ni cambia ningún campo.
function tipQuincenas(card, r) {
  const key = `${card.id}_${r.mes}`, abierto = ui.tips.has(key);
  const fechas = r.quincenas.map((q) => fechaCorta(q.fecha)).join(' y ');
  let txt;
  if (!r.capturado) txt = `Captura el pago del corte para ver cuánto separar. Te tocan las quincenas del ${fechas}.`;
  else {
    const mitad = round2(r.pagoMes / 2);
    const escrito = round2(r.quincenas.reduce((t, q) => t + (q.monto || 0), 0));
    const falta = round2(r.pagoMes - escrito);
    txt = `Sugerido: ${money(mitad)} en cada quincena (${money(r.pagoMes)} ÷ 2), el ${fechas}.` +
      (escrito ? ` Llevas escrito ${money(escrito)}; ${falta > 0 ? `faltan ${money(falta)}` : falta < 0 ? `te pasaste por ${money(-falta)}` : 'ya cubre el pago'}.` : '');
  }
  if (r.aviso) txt += ` ${r.aviso}`;
  return `<div class="tip"><button type="button" class="tipbtn" data-act="tip" data-k="${esc(key)}" aria-expanded="${abierto}" title="${esc(txt)}">
    <span class="i" aria-hidden="true">i</span>¿Cuánto separar por quincena?</button>${abierto ? `<p class="bubble" role="note">${esc(txt)}</p>` : ''}</div>`;
}

function tarjetaTC({ card, r }) {
  const a = attrs(card, r);
  const id = esc(card.id);
  // Sin adeudo: verde agua pastel. Pagada (con deuda restante): verde pastel.
  const cero = r.deudaFinal <= 0 ? ' tc--cero' : r.pagado ? ' tc--pagada' : '';
  const btnC = (c) => `<button type="button" class="fold" data-act="fold" data-card="${id}" aria-expanded="${!c}" aria-label="${c ? 'Mostrar' : 'Contraer'} ${esc(card.nombre)}">${c ? '+' : '−'}</button>`;
  if (ui.contraidas.has(card.id)) {
    return `<article class="card tc tc--min${cero}"><div class="row">${btnC(true)}
      <span class="plastic sm" style="background:${esc(card.color || COLORES[0])}"></span>
      <button class="tc-name" style="flex:1;text-align:left" data-act="fold" data-card="${id}">${esc(card.nombre)}</button></div></article>`;
  }
  return `<article class="card tc${cero}">
    <div class="row spread" style="align-items:flex-start;flex-wrap:wrap">
      <div class="row" style="flex:1 1 240px;align-items:center">${btnC(false)}<button class="tc-head" data-act="editCard" data-card="${esc(card.id)}" aria-label="Editar ${esc(card.nombre)}">
        <span class="plastic" style="background:${esc(card.color || COLORES[0])}"></span>
        <span style="min-width:0"><span class="tc-name">${esc(card.nombre)}</span><br><span class="tc-dates">Corte ${esc(fechaCorta(r.corte))} → límite ${esc(fechaCorta(r.limite))}</span></span>
      </button></div>${estadoTag(r.estado)}
    </div>
    <div class="cells">
      <div class="cell"><span class="label">Deuda actual</span><span class="v">${money(r.deudaActual)}</span></div>
      <label class="cell" for="aj-${card.id}-${r.mes}"><span class="label">Intereses del mes</span><small class="meta">Se suma a la deuda de este mes</small>
        <input id="aj-${card.id}-${r.mes}" inputmode="decimal" data-ch="ajuste" ${a} value="${r.ajusteRaw ?? ''}" placeholder="0.00"></label>
      <label class="cell" for="pm-${card.id}-${r.mes}"><span class="label">Pago del corte</span>
        <input id="pm-${card.id}-${r.mes}" inputmode="decimal" data-ch="pagoMes" ${a} value="${r.capturado ? r.pagoMes : ''}" placeholder="Captura"></label>
      <div class="cell"><span class="label">Separado</span><span class="v">${money(round2(r.quincenas.reduce((t, q) => t + (q.separada && q.monto ? q.monto : 0), 0)))}</span></div>
    </div>
    ${tipQuincenas(card, r)}
    <div class="checks">
      ${r.quincenas.map((q) => ckQ(card, r, q, 'q')).join('')}
      <label class="ck" for="pg-${card.id}-${r.mes}"><input type="checkbox" id="pg-${card.id}-${r.mes}" data-ch="pagado" ${a} ${r.pagado ? 'checked' : ''}>
        <span class="box"></span><span class="t"><b>Ya pagué la tarjeta</b></span></label>
    </div>
    <div class="pagorow">
      <label class="field" for="fr-${card.id}-${r.mes}"><span class="label">Fecha real de pago</span>
        <input id="fr-${card.id}-${r.mes}" type="date" data-ch="fechaReal" ${a} value="${esc(r.fechaReal)}"></label>
      <label class="field" for="mp-${card.id}-${r.mes}"><span class="label">Monto pagado</span>
        <input id="mp-${card.id}-${r.mes}" inputmode="decimal" data-ch="montoPagado" ${a} value="${r.montoPagadoRaw ?? ''}" placeholder="${r.capturado ? r.pagoMes.toFixed(2) : '0.00'}"></label>
    </div>
    <div class="cells" style="grid-template-columns:minmax(0,1fr)"><div class="cell final"><span class="label">Deuda final</span><span class="v">${money(r.deudaFinal)}</span></div></div>
    <div class="tc-foot"><span class="meta">${!r.compras.n ? 'Sin compras anotadas con esta tarjeta en este corte' : r.inicial ? `Compras anotadas en este corte: ${money(r.compras.total)} (${r.compras.n}). No se suman: la deuda inicial ya las incluye.` : `Compras de este corte sumadas a la deuda: ${money(r.compras.total)} (${r.compras.n})`}</span>
      <button class="link" data-act="history" data-card="${esc(card.id)}">Historial</button></div>
  </article>`;
}

/* ---------- Quincenas ---------- */
function vQuincenas() {
  const P = ui.payday;
  // Solo las tarjetas que de verdad requieren apartar algo en esta quincena:
  // ya tiene un monto escrito, o el corte sigue por pagar con deuda y un pago distinto de $0.
  const requiere = ({ r, q }) => (q.monto > 0) ||
    (!r.pagado && r.estado.tipo !== 'saldada' && r.deudaActual > 0 && (!r.capturado || r.pagoMes > 0));
  const lista = asignacionesDe(cards(), D.periodos, P, todayISO(), movsList()).filter(requiere);
  const total = round2(lista.reduce((s, a) => s + (a.q.monto || 0), 0));
  const hecho = round2(lista.reduce((s, a) => s + (a.q.separada ? a.q.monto || 0 : 0), 0));
  const pct = total ? Math.round((hecho / total) * 100) : 0;
  const prox = nextPayday(todayISO());
  let h = `<h1>Quincenas</h1>
    <div class="nav"><button class="round" data-act="qPrev" aria-label="Quincena anterior">‹</button>
      <div class="center"><span class="label">${P === prox ? 'Próxima quincena' : P < prox ? 'Quincena pasada' : 'Quincena'}</span><b>${esc(fechaLarga(P))}</b></div>
      <button class="round" data-act="qNext" aria-label="Quincena siguiente">›</button></div>`;
  if (P !== prox) h += `<p class="sub" style="text-align:center;margin-top:-8px"><button class="link" data-act="qHoy">Ir a la próxima quincena</button></p>`;
  h += `<div class="qtotal"><span class="label">Separar de esta quincena para tarjetas</span><b>${money(total)}</b>
    <div class="row spread meta" style="color:#B9C4BC;margin-top:4px"><span>Separado ${money(hecho)}</span><span>Falta ${money(round2(total - hecho))}</span></div>
    <div class="bar"><i style="width:${pct}%"></i></div></div>`;
  if (!lista.length) return h + '<div class="empty"><b>Nada que separar</b>Ninguna tarjeta requiere apartar dinero en esta quincena.</div>';
  h += '<div class="card checks" style="border-top:1px solid var(--line);padding-top:6px">' + lista.map(({ card, r, q }) => {
    const id = `qq-${card.id}-${r.mes}-${q.n}`;
    return `<label class="ck" for="${id}"><input type="checkbox" id="${id}" data-ch="q" data-n="${q.n}" ${attrs(card, r)} ${q.separada ? 'checked' : ''}>
      <span class="box"></span><span class="t"><b>${esc(card.nombre)}</b><small>${q.n}ª parte del corte de ${esc(mesLargo(r.mes))} · paga el ${esc(fechaCorta(r.limite))}</small></span>
      <span class="amt">${q.monto === null ? '<span class="meta">Sin monto</span>' : money(q.monto)}</span></label>`;
  }).join('') + '</div>';
  return h;
}

/* ---------- Movimientos (Libreta) ---------- */
function vMovimientos() {
  const d = ui.draft;
  const metodos = ['Efectivo', 'Débito', ...cards().map((c) => c.nombre)];
  let h = `<h1>Movimientos</h1>
    <form class="card stack" id="movForm" autocomplete="off">
      ${ui.editMov ? '<div class="editing"><span>Editando apunte</span><button type="button" class="link" data-act="movCancel">Cancelar</button></div>' : ''}
      <div class="seg" role="group" aria-label="Tipo de movimiento" style="margin:0">
        <button type="button" class="out" data-act="movTipo" data-t="gasto" aria-pressed="${d.tipo !== 'ingreso'}">Salida</button>
        <button type="button" class="in" data-act="movTipo" data-t="ingreso" aria-pressed="${d.tipo === 'ingreso'}">Entrada</button></div>
      <label class="field" for="m-monto"><span class="label">Monto</span><input id="m-monto" class="amount" inputmode="decimal" data-draft="monto" value="${esc(d.monto)}" placeholder="0.00"></label>
      <label class="field" for="m-concepto"><span class="label">¿En qué?</span><input id="m-concepto" data-draft="concepto" maxlength="80" value="${esc(d.concepto)}" placeholder="Ej. almuerzo, gasolina, farmacia"></label>
      <div class="field"><label class="label" for="m-metodo">¿De dónde lo pagaste?</label>
        <div class="metodos">${metodos.map((m) => `<button type="button" class="chip" data-act="metodo" data-m="${esc(m)}" aria-pressed="${d.metodo === m}">${esc(m)}</button>`).join('')}</div>
        <input id="m-metodo" data-draft="metodo" maxlength="40" value="${esc(d.metodo)}" placeholder="O escribe otro: Nu, vales, transferencia"></div>
      <div class="grid2"><label class="field" for="m-fecha"><span class="label">Fecha</span><input id="m-fecha" type="date" data-draft="fecha" value="${esc(d.fecha)}"></label>
        <label class="field" for="m-hora"><span class="label">Hora</span><input id="m-hora" type="time" data-draft="hora" value="${esc(d.hora)}"></label></div>
      <button class="btn primary block" type="submit">${ui.editMov ? 'Guardar cambios' : d.tipo === 'ingreso' ? 'Anotar entrada' : 'Anotar salida'}</button>
      <p class="msg" id="movMsg" role="status"></p>
    </form>`;
  const movs = Object.values(D.movs);
  const vis = movs.filter((m) => (ui.movPasados ? m.anotado : !m.anotado))
    .sort((a, b) => (b.fecha + (b.hora || '')).localeCompare(a.fecha + (a.hora || '')) || (b.creado || 0) - (a.creado || 0));
  h += `<div class="row spread" style="margin:22px 0 10px"><h2 style="margin:0">${ui.movPasados ? 'Flujos pasados' : 'Por pasar a la libreta'}</h2>
    <button class="chip" data-act="movVer" aria-pressed="${ui.movPasados}">${ui.movPasados ? 'Ver pendientes' : 'Flujos pasados'}</button></div>`;
  if (!vis.length) {
    return h + `<div class="empty">${ui.movPasados ? '<b>Sin flujos pasados</b>Aquí aparecen los apuntes que marques como copiados.'
      : movs.length ? '<b>Todo al día</b>No hay apuntes pendientes de pasar a la libreta.' : '<b>Aún no hay apuntes</b>Escribe el monto, de dónde lo pagaste y toca Anotar.'}</div>`;
  }
  const dias = {};
  vis.forEach((m) => { (dias[m.fecha] = dias[m.fecha] || []).push(m); });
  h += '<div class="stack">' + Object.keys(dias).sort().reverse().map((f) => {
    const out = dias[f].filter((m) => m.tipo !== 'ingreso').reduce((s, m) => s + m.monto, 0);
    const inn = dias[f].filter((m) => m.tipo === 'ingreso').reduce((s, m) => s + m.monto, 0);
    return `<section class="day"><div class="day-head"><b>${f === todayISO() ? 'Hoy' : esc(fechaLarga(f))}</b>
      <span class="day-tot">${out ? `<span>−${money(round2(out))}</span>` : ''}${inn ? `<span>+${money(round2(inn))}</span>` : ''}</span></div>
      <ul class="items">${dias[f].map((m) => `<li class="it ${m.anotado ? 'done' : ''}">
        <button class="tick" data-act="movTick" data-id="${esc(m.id)}" aria-label="${m.anotado ? 'Regresar a pendientes' : 'Marcar como pasado a la libreta'}">${m.anotado ? '✓' : ''}</button>
        <button class="what" ${m.anotado ? 'disabled' : `data-act="movEdit" data-id="${esc(m.id)}"`}><b>${esc(m.concepto || (m.tipo === 'ingreso' ? 'Entrada' : 'Gasto'))}</b>
          <span>${esc([m.metodo, m.hora].filter(Boolean).join(' · '))}</span></button>
        <span class="right"><span class="amt ${m.tipo === 'ingreso' ? 'in' : 'out'}">${m.tipo === 'ingreso' ? '+' : '−'}${money(m.monto)}</span>
          <button class="x ${ui.armed === 'm' + m.id ? 'armed' : ''}" data-act="movDel" data-id="${esc(m.id)}" aria-label="Borrar">${ui.armed === 'm' + m.id ? '¿Borrar?' : '×'}</button></span>
      </li>`).join('')}</ul></section>`;
  }).join('') + '</div><p class="sub" style="margin-top:12px">Toca un apunte pendiente para editarlo. Marca la casilla cuando ya lo copiaste en tu cuaderno.</p>';
  return h;
}

/* ---------- Súper ---------- */
function vSuper() {
  const items = Object.values(D.super);
  const deTienda = (t) => items.filter((i) => (TIENDAS.includes(i.tienda) ? i.tienda : 'Otros') === t);
  const lista = deTienda(ui.tienda).sort((a, b) => (a.comprado - b.comprado) || (a.creado || 0) - (b.creado || 0));
  let h = `<h1>Súper</h1><div class="chips">${TIENDAS.map((t) => {
    const n = deTienda(t).filter((i) => !i.comprado).length;
    return `<button class="chip" data-act="tienda" data-t="${esc(t)}" aria-pressed="${ui.tienda === t}">${esc(t)}${n ? `<span class="n">${n}</span>` : ''}</button>`;
  }).join('')}</div>
    <form class="card stack" id="superForm" autocomplete="off">
      <div class="grid2" style="grid-template-columns:minmax(0,2fr) minmax(0,1fr)">
        <label class="field" for="s-prod"><span class="label">Se me acabó…</span><input id="s-prod" maxlength="60" placeholder="Ej. leche, huevo, café"></label>
        <label class="field" for="s-cant"><span class="label">Cantidad</span><input id="s-cant" maxlength="12" placeholder="Opcional"></label></div>
      <button class="btn primary block" type="submit">Agregar a ${esc(ui.tienda)}</button>
      <p class="msg" id="superMsg" role="status"></p></form>
    <div class="row spread" style="margin:22px 0 10px"><h2 style="margin:0">Lista de ${esc(ui.tienda)}</h2>
      <button class="chip" data-act="superLimpiar">${ui.armed === 'limpiar' ? `¿Quitar ${lista.filter((i) => i.comprado).length}?` : 'Quitar lo comprado'}</button></div>`;
  if (!lista.length) return h + `<div class="empty"><b>Nada pendiente</b>Anota arriba lo que se te vaya acabando para ${esc(ui.tienda)}.</div>`;
  const falt = lista.filter((i) => !i.comprado).length;
  h += `<section class="day"><ul class="items">${lista.map((i) => `<li class="it ${i.comprado ? 'done' : ''}">
    <button class="tick" data-act="superTick" data-id="${esc(i.id)}" aria-label="${i.comprado ? 'Marcar como pendiente' : 'Marcar como comprado'}">${i.comprado ? '✓' : ''}</button>
    <span class="what"><b>${esc(i.nombre)}</b>${i.cant ? `<span>Cantidad: ${esc(i.cant)}</span>` : ''}</span>
    <span class="right"><button class="x ${ui.armed === 's' + i.id ? 'armed' : ''}" data-act="superDel" data-id="${esc(i.id)}" aria-label="Borrar">${ui.armed === 's' + i.id ? '¿Borrar?' : '×'}</button></span></li>`).join('')}</ul>
    <div class="day-head" style="border-top:1px solid var(--line);border-bottom:0"><span class="meta">Te faltan</span><span class="day-tot">${falt} de ${lista.length}</span></div></section>`;
  if (lista.some((i) => i.comprado)) h += `<button class="btn dark block" style="margin-top:12px" data-act="superPagar">Ya pagué: anotar el gasto de esta compra</button>`;
  return h;
}

/* ---------- hojas ---------- */
function renderSheet() {
  const s = $('#sheet');
  if (!ui.sheet) { s.hidden = true; s.innerHTML = ''; return; }
  s.hidden = false;
  if (ui.sheet === 'card') s.innerHTML = `<div class="panel" role="dialog" aria-modal="true" aria-label="Tarjeta"><div class="grab"></div>${sheetCard()}</div>`;
  if (ui.sheet.startsWith('hist:')) s.innerHTML = `<div class="panel" role="dialog" aria-modal="true" aria-label="Historial"><div class="grab"></div>${sheetHist(ui.sheet.slice(5))}</div>`;
}
function sheetCard() {
  const c = ui.cardEdit;
  return `<form id="cardForm" class="stack" autocomplete="off">
    <div class="row spread"><h2 style="margin:0">${c.id ? 'Editar tarjeta' : 'Nueva tarjeta'}</h2><button type="button" class="x" data-act="closeSheet" aria-label="Cerrar">×</button></div>
    <label class="field" for="f-nombre"><span class="label">Nombre</span><input id="f-nombre" data-cf="nombre" value="${esc(c.nombre)}" placeholder="Ej. BBVA Oro" maxlength="40"></label>
    <div class="grid2">
      <label class="field" for="f-corte"><span class="label">Día de corte</span><input id="f-corte" data-cf="diaCorte" type="number" min="1" max="31" value="${esc(c.diaCorte)}"></label>
      <label class="field" for="f-pago"><span class="label">Día límite de pago</span><input id="f-pago" data-cf="diaPago" type="number" min="1" max="31" value="${esc(c.diaPago)}"></label></div>
      <label class="field" for="f-mes"><span class="label">Mes del primer corte</span><input id="f-mes" data-cf="mesInicial" type="month" value="${esc(c.mesInicial)}"></label>
      <label class="field" for="f-deuda"><span class="label">Deuda en ese corte</span><input id="f-deuda" data-cf="deudaInicial" inputmode="decimal" value="${esc(c.deudaInicial)}" placeholder="0.00"></label>
    <div class="field"><span class="label">Color</span><div class="swatches">${COLORES.map((col) => `<button type="button" class="sw" style="background:${col}" data-act="color" data-c="${col}" aria-pressed="${c.color === col}" aria-label="Color ${col}"></button>`).join('')}</div></div>
    <p class="hint" id="cardPreview">${esc(previewCard(c))}</p>
    <p class="msg" id="cardMsg" role="alert" style="color:var(--bad)"></p>
    <button class="btn primary block" type="submit">Guardar</button>
    ${c.id ? `<button type="button" class="btn danger block" data-act="delCard">${ui.armed === 'card' ? 'Confirmar: borrar tarjeta y su historial' : 'Eliminar tarjeta'}</button>` : ''}
  </form>`;
}
function previewCard(c) {
  const dc = Number(c.diaCorte), dp = Number(c.diaPago);
  if (!(dc >= 1 && dc <= 31 && dp >= 1 && dp <= 31) || dc === dp) return 'Escribe los días de corte y de pago para ver en qué quincenas separas.';
  const mes = c.mesInicial || ui.mes;
  const r = computeCard({ id: '_', diaCorte: dc, diaPago: dp, mesInicial: mes, deudaInicial: 0 }, {}, mes)[0];
  return `Corte ${fechaCorta(r.corte)} → pago ${fechaCorta(r.limite)}. Separas en: ${r.quincenas.map((q) => fechaCorta(q.fecha)).join(' y ')}.`;
}
function sheetHist(id) {
  const card = D.cards[id];
  if (!card) return '';
  const hasta = [ui.mes, todayISO().slice(0, 7)].sort().pop();
  const rows = computeCard(card, D.periodos, hasta, todayISO(), movsList()).reverse();
  return `<div class="row spread"><h2 style="margin:0">${esc(card.nombre)}</h2><button type="button" class="x" data-act="closeSheet" aria-label="Cerrar">×</button></div>
    <p class="sub">Historial por corte. Toca un mes para abrirlo.</p>
    <div class="hist"><div class="hrow h"><span>Corte</span><span class="r">Deuda actual</span><span class="r">Pagado</span><span class="r">Deuda final</span></div>
    ${rows.map((r) => `<div class="hrow"><button class="link" style="text-align:left;padding:0" data-act="irMes" data-mes="${r.mes}">${esc(mesLargo(r.mes))}</button>
      <span class="r">${money(r.deudaActual)}${r.comprasSumadas ? `<br><small class="meta">+${money(r.comprasSumadas)} compras</small>` : ''}${r.ajuste ? `<br><small class="meta">+${money(r.ajuste)} int.</small>` : ''}</span>
      <span class="r">${r.pagado ? money(r.depositado) : '—'}</span><span class="r"><b>${money(r.deudaFinal)}</b></span></div>`).join('')}</div>`;
}

/* ---------- ejemplo ---------- */
function ejemplo() {
  const actual = todayISO().slice(0, 7), prev = addMonths(actual, -1);
  const c = {
    ej1: { id: 'ej1', nombre: 'Ejemplo Oro', diaCorte: 3, diaPago: 23, deudaInicial: 18450, mesInicial: prev, color: COLORES[0] },
    ej2: { id: 'ej2', nombre: 'Ejemplo Negra', diaCorte: 10, diaPago: 30, deudaInicial: 9200, mesInicial: prev, color: COLORES[1] },
    ej3: { id: 'ej3', nombre: 'Ejemplo Departamental', diaCorte: 22, diaPago: 12, deudaInicial: 4300, mesInicial: prev, color: COLORES[2] },
  };
  const lim = (id, m) => cycleDates(c[id], m).limite;
  const p = (id, mes, x) => ({ [`${id}_${mes}`]: { id: `${id}_${mes}`, cardId: id, mes, ...x } });
  const periodos = {
    ...p('ej1', prev, { pagoMes: 3200, q1Monto: 1600, q2Monto: 1600, q1: true, q2: true, pagado: true, fechaReal: lim('ej1', prev) }),
    ...p('ej2', prev, { pagoMes: 1800, q1Monto: 900, q2Monto: 900, q1: true, q2: true, pagado: true, fechaReal: addDayISO(lim('ej2', prev), 2) }),
    ...p('ej3', prev, { pagoMes: 900, q1Monto: 450, q2Monto: 450, q1: true, q2: true, pagado: true, fechaReal: lim('ej3', prev) }),
    ...p('ej1', actual, { pagoMes: 2950, q1Monto: 1500, q1: true }),
    ...p('ej2', actual, { ajuste: 145.3, pagoMes: 1750 }),
  };
  const h = todayISO(), ayer = addDayISO(h, -1);
  const mv = (id, x) => ({ [id]: { id, anotado: false, creado: Date.now(), hora: '', ...x } });
  const movs = {
    ...mv('em1', { tipo: 'gasto', monto: 189.5, concepto: 'Ejemplo: farmacia', metodo: 'Ejemplo Oro', cardId: 'ej1', fecha: h, hora: '09:40' }),
    ...mv('em2', { tipo: 'gasto', monto: 650, concepto: 'Ejemplo: gasolina', metodo: 'Ejemplo Negra', cardId: 'ej2', fecha: ayer, hora: '18:15' }),
    ...mv('em3', { tipo: 'ingreso', monto: 1200, concepto: 'Ejemplo: venta', metodo: 'Efectivo', cardId: null, fecha: ayer, hora: '12:00' }),
  };
  const sp = (id, x) => ({ [id]: { id, tienda: 'Walmart', comprado: false, creado: Date.now(), cant: '', ...x } });
  const sup = { ...sp('es1', { nombre: 'Ejemplo: leche', cant: '2' }), ...sp('es2', { nombre: 'Ejemplo: café', comprado: true }), ...sp('es3', { nombre: 'Ejemplo: tortillas', tienda: 'Aurrera' }) };
  return { cards: c, periodos, movs, super: sup };
}

/* ---------- eventos ---------- */
document.addEventListener('input', (ev) => {
  const el = ev.target;
  if (el.dataset.draft) {
    ui.draft[el.dataset.draft] = el.value;
    if (el.dataset.draft === 'metodo') {
      const c = cards().find((x) => x.nombre.toLowerCase() === el.value.trim().toLowerCase());
      ui.draft.cardId = c ? c.id : null;
      document.querySelectorAll('[data-act="metodo"]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.m === el.value));
    }
  }
  if (el.dataset.cf && ui.cardEdit) {
    ui.cardEdit[el.dataset.cf] = el.value;
    const pv = $('#cardPreview'); if (pv) pv.textContent = previewCard(ui.cardEdit);
  }
});

/* Toques en el celular: si la pantalla se redibuja (o se recorre al cerrarse el teclado) entre que
   pones el dedo y lo levantas, el toque puede caer en otra casilla. Por eso:
   1) los datos que llegan mientras tocas esperan a que termine el toque para redibujar, y
   2) una casilla solo cambia si el toque empezó sobre esa misma casilla. */
const toque = { activo: false, fin: 0, inicio: 0, casilla: null };
document.addEventListener('pointerdown', (ev) => {
  toque.activo = true; toque.inicio = Date.now();
  toque.casilla = ev.target.closest?.('.ck')?.querySelector('input[type="checkbox"]')?.id || null;
}, true);
['pointerup', 'pointercancel'].forEach((t) => document.addEventListener(t, () => { toque.activo = false; toque.fin = Date.now(); }, true));
function pedirRender() {
  clearTimeout(pedirRender.t);
  if (toque.activo || Date.now() - toque.fin < 400) { pedirRender.t = setTimeout(pedirRender, 120); return; }
  render();
}

document.addEventListener('change', async (ev) => {
  const el = ev.target, k = el.dataset.ch;
  if (!k) return;
  if (el.type === 'checkbox' && Date.now() - toque.inicio < 1500 && toque.casilla !== el.id) {
    el.checked = !el.checked; // toque que empezó en otro lugar: no cambiar esta casilla
    return;
  }
  const { card, mes } = el.dataset;
  const p = D.periodos[`${card}_${mes}`] || {};
  let patch;
  if (k === 'q') patch = { [`q${el.dataset.n}`]: el.checked, [`q${el.dataset.n}Fecha`]: el.checked ? todayISO() : null };
  else if (k === 'pagado') { patch = { pagado: el.checked }; if (el.checked && !p.fechaReal) patch.fechaReal = todayISO(); }
  else if (k === 'fechaReal') { patch = { fechaReal: el.value || null }; if (el.value) patch.pagado = true; }
  else if (k === 'qMonto') {
    const v = parseMonto(el.value);
    patch = { [`q${el.dataset.n}Monto`]: Number.isFinite(v) && v >= 0 ? round2(v) : null };
  } else {
    const v = parseMonto(el.value);
    if (el.value.trim() && !Number.isFinite(v)) { toast('Escribe solo números, por ejemplo 1250.50'); return; }
    patch = { [k]: Number.isFinite(v) ? round2(v) : null };
  }
  await put('periodos', `${card}_${mes}`, { cardId: card, mes, ...patch }).catch(() => {});
});

document.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = ev.target;
  if (f.id === 'movForm') {
    const d = ui.draft, monto = parseMonto(d.monto);
    if (!(monto > 0)) { $('#movMsg').textContent = 'Escribe un monto mayor que cero, por ejemplo 125.50.'; $('#m-monto').focus(); return; }
    const mov = { tipo: d.tipo, monto: round2(monto), concepto: d.concepto.trim(), metodo: d.metodo.trim(), cardId: d.cardId || null, pagoTarjeta: d.pagoTarjeta || null, fecha: d.fecha || todayISO(), hora: d.hora || '' };
    try {
      if (ui.editMov) await put('movs', ui.editMov, mov);
      else await put('movs', null, { ...mov, anotado: false, creado: Date.now() });
      const txt = ui.editMov ? 'Cambios guardados.' : `${d.tipo === 'ingreso' ? 'Entrada' : 'Salida'} de ${money(mov.monto)} anotada.`;
      ui.editMov = null; ui.draft = nuevoDraft({ tipo: d.tipo }); render();
      $('#movMsg').textContent = txt; $('#m-monto')?.focus();
    } catch { /* toast ya avisó */ }
  }
  if (f.id === 'superForm') {
    const nombre = $('#s-prod').value.trim();
    if (!nombre) { $('#superMsg').textContent = 'Escribe qué necesitas comprar.'; $('#s-prod').focus(); return; }
    try {
      await put('super', null, { tienda: ui.tienda, nombre, cant: $('#s-cant').value.trim(), comprado: false, creado: Date.now() });
      render(); $('#superMsg').textContent = `${nombre} agregado a ${ui.tienda}.`; $('#s-prod').focus();
    } catch { /* toast ya avisó */ }
  }
  if (f.id === 'cardForm') guardarCard();
});

async function guardarCard() {
  const c = ui.cardEdit, msg = $('#cardMsg');
  const card = {
    nombre: String(c.nombre).trim(), diaCorte: Number(c.diaCorte), diaPago: Number(c.diaPago),
    deudaInicial: round2(Number.isFinite(parseMonto(c.deudaInicial)) ? parseMonto(c.deudaInicial) : 0), mesInicial: c.mesInicial, color: c.color || COLORES[0],
  };
  if (!card.nombre) { msg.textContent = 'Escribe el nombre de la tarjeta.'; return; }
  if (!(card.diaCorte >= 1 && card.diaCorte <= 31 && card.diaPago >= 1 && card.diaPago <= 31)) { msg.textContent = 'Los días de corte y de pago van del 1 al 31.'; return; }
  if (card.diaCorte === card.diaPago) { msg.textContent = 'El día de pago debe ser distinto al día de corte.'; return; }
  if (!/^\d{4}-\d{2}$/.test(card.mesInicial || '')) { msg.textContent = 'Elige el mes del primer corte que vas a registrar.'; return; }
  if (ui.guardando) return;
  ui.guardando = true;
  const btn = $('#cardForm button[type="submit"]');
  if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }
  // El id se fija al abrir el formulario: si se toca Guardar dos veces, se actualiza la misma tarjeta.
  const pendiente = put('cards', c.id || c.nuevoId, card).catch(() => null);
  cerrarSheet(); toast('Tarjeta guardada');
  await pendiente;
  ui.guardando = false;
}

function irTab(t) { ui.tab = t; ui.armed = null; guardar('cg-tab', t); render(); window.scrollTo(0, 0); }
function cerrarSheet() { ui.sheet = null; ui.cardEdit = null; ui.armed = null; renderSheet(); }
function armar(key) {
  ui.armed = key; render();
  clearTimeout(armar.t); armar.t = setTimeout(() => { if (ui.armed === key) { ui.armed = null; render(); } }, 3500);
}

document.addEventListener('click', async (ev) => {
  if (ev.target.id === 'sheet') { cerrarSheet(); return; }
  const el = ev.target.closest('[data-act],[data-tab]');
  if (!el) return;
  if (el.dataset.tab) { irTab(el.dataset.tab); return; }
  const a = el.dataset.act, id = el.dataset.id;
  switch (a) {
    case 'toast': $('#toast').hidden = true; toast.fn?.(); break;
    case 'signIn': try { await store.signIn(); } catch (e) { ui.error = `No se pudo iniciar sesión: ${e.message || e}`; render(); } break;
    case 'signOut': store.signOut(); break;
    case 'seed': await store.seed(ejemplo()); break;
    case 'reset': if (ui.armed === 'reset') { await store.reset(); ui.armed = null; } else armar('reset'); break;
    case 'mesPrev': ui.mes = addMonths(ui.mes, -1); render(); break;
    case 'mesNext': ui.mes = addMonths(ui.mes, 1); render(); break;
    case 'mesHoy': ui.mes = todayISO().slice(0, 7); render(); break;
    case 'irPend': {
      ui.mes = el.dataset.mes; ui.contraidas.delete(el.dataset.card); guardar('cg-contraidas', JSON.stringify([...ui.contraidas])); render();
      document.querySelector(`[data-act="fold"][data-card="${el.dataset.card}"]`)?.closest('.tc')?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      break;
    }
    case 'irMes': ui.mes = el.dataset.mes; ui.tab = 'tarjetas'; cerrarSheet(); render(); break;
    case 'qPrev': ui.payday = shiftPayday(ui.payday, -1); render(); break;
    case 'qNext': ui.payday = shiftPayday(ui.payday, 1); render(); break;
    case 'qHoy': ui.payday = nextPayday(todayISO()); render(); break;
    case 'addCard':
      ui.cardEdit = { id: null, nuevoId: 'tc' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), nombre: '', diaCorte: '', diaPago: '', deudaInicial: '', mesInicial: ui.mes, color: COLORES[cards().length % COLORES.length] };
      ui.sheet = 'card'; ui.armed = null; renderSheet(); $('#f-nombre')?.focus(); break;
    case 'editCard': ui.cardEdit = { ...D.cards[el.dataset.card] }; ui.sheet = 'card'; ui.armed = null; renderSheet(); break;
    case 'color': ui.cardEdit.color = el.dataset.c; renderSheet(); break;
    case 'delCard':
      if (ui.armed !== 'card') { ui.armed = 'card'; renderSheet(); break; }
      try {
        const cid = ui.cardEdit.id;
        await store.delMany([...Object.values(D.periodos).filter((p) => p.cardId === cid).map((p) => ['periodos', p.id]), ['cards', cid]]);
        cerrarSheet(); toast('Tarjeta eliminada');
      } catch { toast('No se pudo eliminar. Revisa tu conexión.'); }
      break;
    case 'history': ui.sheet = 'hist:' + el.dataset.card; renderSheet(); break;
    case 'closeSheet': cerrarSheet(); break;
    case 'fold': {
      const k = el.dataset.card;
      if (ui.contraidas.has(k)) ui.contraidas.delete(k); else ui.contraidas.add(k);
      guardar('cg-contraidas', JSON.stringify([...ui.contraidas])); render(); break;
    }
    case 'tip': { const k = el.dataset.k; if (ui.tips.has(k)) ui.tips.delete(k); else ui.tips.add(k); render(); break; }
    case 'movTipo': ui.draft.tipo = el.dataset.t; render(); break;
    case 'metodo': {
      const m = el.dataset.m; const c = cards().find((x) => x.nombre === m);
      ui.draft.metodo = ui.draft.metodo === m ? '' : m; ui.draft.cardId = ui.draft.metodo && c ? c.id : null; render(); break;
    }
    case 'movVer': ui.movPasados = !ui.movPasados; render(); break;
    case 'movTick': await put('movs', id, { anotado: !D.movs[id].anotado }).catch(() => {}); break;
    case 'movEdit': {
      const m = D.movs[id];
      ui.editMov = id; ui.draft = { tipo: m.tipo, monto: String(m.monto), concepto: m.concepto || '', metodo: m.metodo || '', cardId: m.cardId || null, pagoTarjeta: m.pagoTarjeta || null, fecha: m.fecha, hora: m.hora || '' };
      render(); window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); $('#m-monto')?.focus({ preventScroll: true }); break;
    }
    case 'movCancel': ui.editMov = null; ui.draft = nuevoDraft(); render(); break;
    case 'movDel': if (ui.armed === 'm' + id) { ui.armed = null; await del('movs', id); } else armar('m' + id); break;
    case 'tienda': ui.tienda = el.dataset.t; guardar('cg-tienda', ui.tienda); ui.armed = null; render(); break;
    case 'superTick': await put('super', id, { comprado: !D.super[id].comprado }).catch(() => {}); break;
    case 'superDel': if (ui.armed === 's' + id) { ui.armed = null; await del('super', id); } else armar('s' + id); break;
    case 'superLimpiar': {
      const hechos = Object.values(D.super).filter((i) => i.comprado && (TIENDAS.includes(i.tienda) ? i.tienda : 'Otros') === ui.tienda);
      if (!hechos.length) { toast('No hay productos marcados como comprados.'); break; }
      if (ui.armed !== 'limpiar') { armar('limpiar'); break; }
      ui.armed = null;
      try { await store.delMany(hechos.map((i) => ['super', i.id])); } catch { toast('No se pudo quitar. Revisa tu conexión.'); }
      break;
    }
    case 'superPagar':
      ui.editMov = null; ui.draft = nuevoDraft({ concepto: ui.tienda === 'Otros' ? 'Súper' : `Súper ${ui.tienda}` });
      irTab('movimientos'); $('#m-monto')?.focus(); $('#movMsg').textContent = `Escribe el total que pagaste en ${ui.tienda} y de dónde lo pagaste.`; break;
    default: break;
  }
});
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && ui.sheet) cerrarSheet(); });

/* ---------- arranque ---------- */
(async function init() {
  try { store = await createStore(); } catch (e) {
    $('#view').innerHTML = `<div class="note err">No se pudo cargar Firebase (${esc(e.message || e)}). Revisa tu conexión y js/firebase-config.js.</div>`;
    return;
  }
  store.onAuth((u) => {
    user = u; unwatch?.(); unwatch = null; ui.cargado = false;
    Object.keys(D).forEach((k) => { D[k] = {}; });
    if (u) {
      unwatch = store.watch((d) => { Object.assign(D, d); ui.cargado = true; ui.error = ''; pedirRender(); },
        (e) => { ui.error = `No se pudieron leer tus datos: ${e.message || e}`; ui.cargado = true; render(); });
      if (store.mode === 'local' && store.isEmpty()) store.seed(ejemplo());
    }
    render();
  });
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
