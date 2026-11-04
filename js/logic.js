// Lógica pura del control de TDC: fechas de corte, quincenas y deuda encadenada.
// Sin dependencias del DOM ni de Firebase, para poder probarla aparte.

// Días de quincena (un día antes del 15 y del fin de mes): el 14 y el penúltimo día del mes
// (30 en meses de 31 días, 29 en meses de 30, 27/28 en febrero).
export const DIA_QUINCENA_1 = 14;
export const diaQuincena2 = (y, m) => lastDay(y, m) - 1;

export const pad = (n) => String(n).padStart(2, '0');
export const lastDay = (y, m) => new Date(y, m, 0).getDate(); // m: 1-12
export const ym = (y, m) => `${y}-${pad(m)}`;
export const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
export const parseYM = (k) => { const [y, m] = k.split('-').map(Number); return { y, m }; };

export function addMonths(k, n) {
  const { y, m } = parseYM(k);
  const t = y * 12 + (m - 1) + n;
  return ym(Math.floor(t / 12), (t % 12) + 1);
}

export function todayISO(now = new Date()) {
  return iso(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function daysBetween(a, b) {
  const p = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((p(b) - p(a)) / 86400000);
}

export const round2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
export const hasNum = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
export const num = (v) => (hasNum(v) ? Number(v) : 0);

/** Fecha de corte del mes `mes` (YYYY-MM) y su fecha límite de pago. */
export function cycleDates(card, mes) {
  const { y, m } = parseYM(mes);
  const corte = iso(y, m, Math.min(card.diaCorte, lastDay(y, m)));
  // Si el día de pago es menor o igual al de corte, el pago cae el mes siguiente.
  const mesPago = card.diaPago > card.diaCorte ? mes : addMonths(mes, 1);
  const p = parseYM(mesPago);
  const limite = iso(p.y, p.m, Math.min(card.diaPago, lastDay(p.y, p.m)));
  return { corte, limite };
}

export function paydaysOfMonth(mes) {
  const { y, m } = parseYM(mes);
  return [iso(y, m, DIA_QUINCENA_1), iso(y, m, diaQuincena2(y, m))];
}

/** Días de pago de nómina dentro de [desde, hasta], ambos incluidos. */
export function paydaysBetween(desde, hasta) {
  const out = [];
  let k = desde.slice(0, 7);
  const end = hasta.slice(0, 7);
  while (k <= end) {
    for (const d of paydaysOfMonth(k)) if (d >= desde && d <= hasta) out.push(d);
    k = addMonths(k, 1);
  }
  return out;
}

export function previousPayday(fecha) {
  let k = fecha.slice(0, 7);
  for (let i = 0; i < 3; i++) {
    const c = paydaysOfMonth(k).filter((d) => d < fecha);
    if (c.length) return c[c.length - 1];
    k = addMonths(k, -1);
  }
  return null;
}

/** Quincenas en las que se separa el pago de un corte. */
export function quincenasFor(card, mes) {
  const { corte, limite } = cycleDates(card, mes);
  const dentro = paydaysBetween(corte, limite);
  if (dentro.length >= 2) return { fechas: dentro.slice(0, 2), aviso: null };
  // Si solo cae una quincena (o ninguna) en el rango, se completa con la(s) quincena(s)
  // anteriores al corte para que el pago siempre se divida entre dos.
  const fechas = dentro.slice();
  let ref = fechas.length ? fechas[0] : corte;
  while (fechas.length < 2) {
    const prev = previousPayday(ref);
    if (!prev) break;
    fechas.unshift(prev);
    ref = prev;
  }
  return {
    fechas,
    aviso: dentro.length === 1
      ? 'Solo una quincena cae entre el corte y la fecha límite: la 1ª parte se separa en la quincena anterior al corte.'
      : 'Ninguna quincena cae entre el corte y la fecha límite: se usan las dos quincenas anteriores al corte.',
  };
}

export function splitPago(pago, n) {
  if (n >= 2) { const a = round2(pago / 2); return [a, round2(pago - a)]; }
  return n === 1 ? [round2(pago)] : [];
}

/**
 * Calcula todos los meses de una tarjeta desde su mes inicial hasta `hastaMes`.
 * Deuda actual (mes 1) = deuda inicial + ajuste
 * Deuda actual (mes n) = deuda final (mes n-1) + ajuste (intereses / cargos del mes)
 * Deuda final          = deuda actual − monto depositado (si el pago está marcado)
 */
export function computeCard(card, periodos, hastaMes, hoy = todayISO()) {
  const rows = [];
  let prevFinal = null;
  let k = card.mesInicial;
  while (k <= hastaMes) {
    const p = periodos[`${card.id}_${k}`] || {};
    const ajuste = num(p.ajuste);
    const base = k === card.mesInicial ? num(card.deudaInicial) : prevFinal;
    const deudaActual = round2(base + ajuste);
    const { corte, limite } = cycleDates(card, k);
    const q = quincenasFor(card, k);
    const capturado = hasNum(p.pagoMes);
    const pagoMes = capturado ? Number(p.pagoMes) : null;
    // Monto por quincena: la mitad del pago, salvo que el usuario escriba otro.
    // Si solo escribe uno, el otro es lo que falta para completar el pago del corte.
    const o = q.fechas.map((_, i) => (hasNum(p[`q${i + 1}Monto`]) ? Number(p[`q${i + 1}Monto`]) : null));
    let montos = capturado ? splitPago(pagoMes, q.fechas.length) : q.fechas.map(() => null);
    if (q.fechas.length === 2) {
      if (o[0] !== null && o[1] !== null) montos = [o[0], o[1]];
      else if (o[0] !== null) montos = [o[0], capturado ? round2(pagoMes - o[0]) : null];
      else if (o[1] !== null) montos = [capturado ? round2(pagoMes - o[1]) : null, o[1]];
    } else if (o[0] !== null) montos = [o[0]];
    const pagado = !!p.pagado;
    const montoPagado = hasNum(p.montoPagado) ? Number(p.montoPagado) : (pagoMes ?? 0);
    const depositado = pagado ? montoPagado : 0;
    const deudaFinal = round2(deudaActual - depositado);

    let estado;
    if (pagado) {
      const atraso = daysBetween(limite, p.fechaReal || hoy);
      estado = atraso > 0 ? { tipo: 'tarde', dias: atraso } : { tipo: 'ok' };
    } else if (deudaActual <= 0 && !capturado) {
      estado = { tipo: 'saldada' };
    } else {
      const d = daysBetween(hoy, limite);
      if (d < 0) estado = { tipo: 'vencido', dias: -d };
      else if (!capturado) estado = { tipo: 'captura' };
      else estado = { tipo: 'pendiente', dias: d };
    }

    rows.push({
      mes: k, ajuste, deudaActual, corte, limite, aviso: q.aviso,
      quincenas: q.fechas.map((fecha, i) => ({
        n: i + 1, fecha, monto: montos[i], editado: o[i] !== null, separada: !!p[`q${i + 1}`], fechaSep: p[`q${i + 1}Fecha`] || null,
      })),
      pagoMes, capturado, pagado, montoPagado, depositado, deudaFinal, estado,
      fechaReal: p.fechaReal || '', montoPagadoRaw: hasNum(p.montoPagado) ? Number(p.montoPagado) : null,
      ajusteRaw: hasNum(p.ajuste) ? Number(p.ajuste) : null,
    });
    prevFinal = deudaFinal;
    k = addMonths(k, 1);
  }
  return rows;
}

/** Primer día de quincena >= fecha. */
export function nextPayday(fecha) {
  let k = fecha.slice(0, 7);
  for (let i = 0; i < 3; i++) {
    const c = paydaysOfMonth(k).filter((d) => d >= fecha);
    if (c.length) return c[0];
    k = addMonths(k, 1);
  }
  return null;
}

/** Quincena anterior (-1) o siguiente (+1) a una fecha de quincena. */
export function shiftPayday(fecha, delta) {
  return delta < 0 ? previousPayday(fecha) : nextPayday(addDayISO(fecha, 1));
}

export function addDayISO(fecha, n) {
  const [y, m, d] = fecha.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return iso(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
}

/** Todo lo que toca separar en la quincena `fecha`, de todas las tarjetas y cortes. */
export function asignacionesDe(cards, periodos, fecha, hoy = todayISO()) {
  const out = [];
  const meses = [-2, -1, 0, 1].map((n) => addMonths(fecha.slice(0, 7), n));
  for (const card of cards) {
    const hasta = meses[meses.length - 1];
    if (card.mesInicial > hasta) continue;
    const rows = computeCard(card, periodos, hasta, hoy);
    for (const r of rows) {
      if (!meses.includes(r.mes)) continue;
      for (const q of r.quincenas) if (q.fecha === fecha) out.push({ card, r, q });
    }
  }
  return out;
}
