const router = require('express').Router();
const db = require('../config/db');
const { ah, autenticar, requierePermiso } = require('../middleware/auth');
const { aplicarRealizado } = require('../services/flota');
const { FECHA, HORA, bad, nulo, numero } = require('../services/validar');
const { registrar, motivoDe } = require('../services/bitacora');

router.use(autenticar);
const ver = requierePermiso('mantenimientos', 'consulta');
const reg = requierePermiso('mantenimientos', 'registro');

const TIPOS = ['preventivo', 'correctivo', 'inspeccion', 'danos'];
const ESTADOS = ['programado', 'realizado', 'cancelado'];

const SELECT = `SELECT m.id, m.vehiculo_id, v.codigo AS vehiculo, m.tipo, m.descripcion, m.fecha, TIME_FORMAT(m.hora, '%H:%i') AS hora,
    m.km, m.horas, m.estado, m.plan_id, u.nombre AS usuario
  FROM mantenimientos m JOIN vehiculos v ON v.id = m.vehiculo_id LEFT JOIN usuarios u ON u.id = m.usuario_id`;

// HU-3.2: calendario mensual. Reúne todo lo que pasa con los vehículos:
//  - mantenimientos realizados y programados,
//  - daños (el día en que ocurrieron y el día en que se repararon),
//  - cambios de llantas,
//  - recordatorios periódicos ("cada 60 días"): aparecen en cada fecha que toca; al marcarlos como hechos, la cuenta vuelve a empezar desde ese día.
const DIA_MS = 86400000;
const aMs = (iso) => Date.parse(`${iso}T00:00:00Z`);
const aIso = (ms) => new Date(ms).toISOString().slice(0, 10);

router.get('/calendario', ver, ah(async (req, res) => {
  const [[{ hoy, mesActual }]] = await db.query("SELECT CURDATE() AS hoy, DATE_FORMAT(CURDATE(), '%Y-%m') AS mesActual");
  const mes = /^\d{4}-(0[1-9]|1[0-2])$/.test(req.query.mes || '') ? req.query.mes : mesActual;
  const inicio = `${mes}-01`;
  const [[{ fin }]] = await db.query('SELECT LAST_DAY(?) AS fin', [inicio]);
  const eventos = [];

  const [mants] = await db.query(
    `${SELECT} WHERE m.fecha BETWEEN ? AND ? AND m.estado <> 'cancelado' ORDER BY m.fecha, m.hora`, [inicio, fin]
  );
  for (const m of mants) {
    eventos.push({ clase: 'mantenimiento', id: m.id, fecha: m.fecha, vehiculo: m.vehiculo, vehiculo_id: m.vehiculo_id, tipo: m.tipo,
      titulo: m.descripcion, estado: m.estado, hora: m.hora, plan_id: m.plan_id });
  }

  const [danos] = await db.query(
    `SELECT d.id, d.vehiculo_id, v.codigo AS vehiculo, d.descripcion, d.estado, DATE(d.creado_en) AS fecha, DATE(d.atendido_en) AS reparado
       FROM danos_vehiculo d JOIN vehiculos v ON v.id = d.vehiculo_id
      WHERE DATE(d.creado_en) BETWEEN ? AND ? OR DATE(d.atendido_en) BETWEEN ? AND ?`,
    [inicio, fin, inicio, fin]
  );
  for (const d of danos) {
    if (d.fecha >= inicio && d.fecha <= fin) {
      eventos.push({ clase: 'dano', id: d.id, fecha: d.fecha, vehiculo: d.vehiculo, vehiculo_id: d.vehiculo_id, titulo: d.descripcion,
        estado: d.estado, reparado: d.reparado || null });
    }
    if (d.reparado && d.reparado >= inicio && d.reparado <= fin) {
      eventos.push({ clase: 'reparado', id: d.id, fecha: d.reparado, vehiculo: d.vehiculo, vehiculo_id: d.vehiculo_id, titulo: d.descripcion,
        estado: 'atendido', ocurrio: d.fecha });
    }
  }

  const [llantas] = await db.query(
    `SELECT l.id, l.vehiculo_id, v.codigo AS vehiculo, l.posicion, l.marca, l.fecha
       FROM llantas_cambios l JOIN vehiculos v ON v.id = l.vehiculo_id WHERE l.fecha BETWEEN ? AND ?`, [inicio, fin]
  );
  for (const l of llantas) {
    eventos.push({ clase: 'llantas', id: l.id, fecha: l.fecha, vehiculo: l.vehiculo, vehiculo_id: l.vehiculo_id,
      titulo: `Cambio de llanta: ${l.posicion}${l.marca ? ' · ' + l.marca : ''}`, estado: 'realizado' });
  }

  // Recordatorios periódicos por días: se repiten cada "cada_dias" desde la última vez que se hizo.
  // El primero que toca se muestra aunque ya haya pasado (queda como vencido hasta que se marque hecho);
  // los siguientes se proyectan hacia adelante y se corren solos cuando se informa que se hizo.
  const [planes] = await db.query(
    `SELECT p.id, p.vehiculo_id, v.codigo AS vehiculo, p.nombre, p.tipo, p.cada_dias, p.ultima_fecha
       FROM planes_mantenimiento p JOIN vehiculos v ON v.id = p.vehiculo_id
      WHERE p.activo = 1 AND p.cada_dias IS NOT NULL AND p.ultima_fecha IS NOT NULL AND v.estado <> 'baja'`
  );
  for (const p of planes) {
    const base = aMs(p.ultima_fecha);
    const paso = Number(p.cada_dias) * DIA_MS;
    // Si ya venció y nadie informó que se hizo, sigue apareciendo en el día de hoy como vencido.
    const primera = aIso(base + paso);
    if (primera < hoy && hoy >= inicio && hoy <= fin) {
      eventos.push({ clase: 'recordatorio', id: p.id, plan_id: p.id, fecha: hoy, vehiculo: p.vehiculo, vehiculo_id: p.vehiculo_id, tipo: p.tipo,
        titulo: p.nombre, cada_dias: Number(p.cada_dias), ultima: p.ultima_fecha, proyectado: false, estado: 'vencido', vencio_el: primera });
    }
    for (let k = Math.max(1, Math.ceil((aMs(inicio) - base) / paso)); ; k += 1) {
      const f = aIso(base + k * paso);
      if (f > fin) break;
      if (f < inicio || (k > 1 && f < hoy)) continue;
      eventos.push({ clase: 'recordatorio', id: p.id, plan_id: p.id, fecha: f, vehiculo: p.vehiculo, vehiculo_id: p.vehiculo_id, tipo: p.tipo,
        titulo: p.nombre, cada_dias: Number(p.cada_dias), ultima: p.ultima_fecha, proyectado: k > 1,
        estado: f < hoy ? 'vencido' : f === hoy ? 'hoy' : 'proximo' });
    }
  }
  eventos.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));

  const [proximos] = await db.query(
    `${SELECT} WHERE m.estado = 'programado' AND m.fecha >= CURDATE() ORDER BY m.fecha, m.hora LIMIT 8`
  );
  const [recordatorios] = await db.query(
    `SELECT p.id AS plan_id, v.codigo AS vehiculo, p.nombre, p.cada_dias, DATE_ADD(p.ultima_fecha, INTERVAL p.cada_dias DAY) AS fecha,
            DATEDIFF(DATE_ADD(p.ultima_fecha, INTERVAL p.cada_dias DAY), CURDATE()) AS dias
       FROM planes_mantenimiento p JOIN vehiculos v ON v.id = p.vehiculo_id
      WHERE p.activo = 1 AND p.cada_dias IS NOT NULL AND p.ultima_fecha IS NOT NULL AND v.estado <> 'baja' ORDER BY fecha LIMIT 10`
  );
  res.json({ mes, hoy, eventos, proximos, recordatorios: recordatorios.map((r) => ({ ...r, dias: Number(r.dias) })) });
}));

router.get('/', ver, ah(async (req, res) => {
  const { vehiculo_id, tipo, estado, desde, hasta } = req.query;
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const filtros = [];
  const valores = [];
  if (vehiculo_id) { filtros.push('m.vehiculo_id = ?'); valores.push(vehiculo_id); }
  if (TIPOS.includes(tipo)) { filtros.push('m.tipo = ?'); valores.push(tipo); }
  if (ESTADOS.includes(estado)) { filtros.push('m.estado = ?'); valores.push(estado); }
  if (FECHA.test(desde || '')) { filtros.push('m.fecha >= ?'); valores.push(desde); }
  if (FECHA.test(hasta || '')) { filtros.push('m.fecha <= ?'); valores.push(hasta); }
  const donde = filtros.length ? `WHERE ${filtros.join(' AND ')}` : '';
  const [filas] = await db.query(`${SELECT} ${donde} ORDER BY m.fecha DESC, m.hora DESC LIMIT ?`, [...valores, limit]);
  res.json(filas);
}));

// HU-3.1: registrar mantenimiento (si la fecha es futura queda programado)
router.post('/', reg, ah(async (req, res) => {
  const b = req.body || {};
  const [[v]] = await db.query('SELECT id, estado, km_actual, horas_actuales FROM vehiculos WHERE id = ?', [b.vehiculo_id || 0]);
  if (!v) throw bad('Elige un vehículo.');
  if (v.estado === 'baja') throw bad('El vehículo está dado de baja.', 409);
  if (!TIPOS.includes(b.tipo)) throw bad('Elige el tipo de mantenimiento.');
  const descripcion = (b.descripcion || '').trim();
  if (!descripcion) throw bad('Escribe la descripción.');
  if (!FECHA.test(b.fecha || '')) throw bad('La fecha debe tener formato AAAA-MM-DD.');
  if (b.hora && !HORA.test(b.hora)) throw bad('La hora debe tener formato HH:MM.');
  const km = numero(b.km, 'El kilometraje', { entero: true });
  const horas = numero(b.horas, 'Las horas de uso');
  if (b.plan_id) {
    const [[p]] = await db.query('SELECT id FROM planes_mantenimiento WHERE id = ? AND vehiculo_id = ?', [b.plan_id, v.id]);
    if (!p) throw bad('El plan no corresponde a ese vehículo.');
  }

  const [[{ futuro }]] = await db.query('SELECT ? > CURDATE() AS futuro', [b.fecha]);
  const estado = b.estado && ESTADOS.includes(b.estado) ? b.estado : futuro ? 'programado' : 'realizado';
  const [r] = await db.query(
    `INSERT INTO mantenimientos (vehiculo_id, tipo, descripcion, fecha, hora, km, horas, estado, plan_id, usuario_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [v.id, b.tipo, descripcion.slice(0, 255), b.fecha, nulo(b.hora), km, horas, estado, nulo(b.plan_id), req.user.id]
  );
  if (estado === 'realizado') await aplicarRealizado({ id: r.insertId, vehiculo_id: v.id, fecha: b.fecha, km, horas, plan_id: nulo(b.plan_id) });
  res.status(201).json({ id: r.insertId, estado });
}));

router.put('/:id', reg, ah(async (req, res) => {
  const b = req.body || {};
  if (b.tipo && !TIPOS.includes(b.tipo)) throw bad('Tipo no válido.');
  if (b.fecha && !FECHA.test(b.fecha)) throw bad('La fecha debe tener formato AAAA-MM-DD.');
  if (b.hora && !HORA.test(b.hora)) throw bad('La hora debe tener formato HH:MM.');
  const sets = [];
  const valores = [];
  if (b.tipo) { sets.push('tipo = ?'); valores.push(b.tipo); }
  if (b.descripcion) { sets.push('descripcion = ?'); valores.push(b.descripcion.trim().slice(0, 255)); }
  if (b.fecha) { sets.push('fecha = ?'); valores.push(b.fecha); }
  if (b.hora !== undefined) { sets.push('hora = ?'); valores.push(nulo(b.hora)); }
  if (b.km !== undefined) { sets.push('km = ?'); valores.push(numero(b.km, 'El kilometraje', { entero: true })); }
  if (b.horas !== undefined) { sets.push('horas = ?'); valores.push(numero(b.horas, 'Las horas de uso')); }
  if (!sets.length) throw bad('No hay cambios para guardar.');
  const [r] = await db.query(`UPDATE mantenimientos SET ${sets.join(', ')} WHERE id = ?`, [...valores, req.params.id]);
  if (!r.affectedRows) throw bad('Mantenimiento no encontrado.', 404);
  res.json({ ok: true });
}));

router.patch('/:id/estado', reg, ah(async (req, res) => {
  const { estado } = req.body || {};
  if (!ESTADOS.includes(estado)) throw bad('Estado no válido.');
  const [[m]] = await db.query('SELECT id, vehiculo_id, fecha, km, horas, plan_id, estado FROM mantenimientos WHERE id = ?', [req.params.id]);
  if (!m) throw bad('Mantenimiento no encontrado.', 404);
  if (m.estado === estado) throw bad('El mantenimiento ya tiene ese estado.');
  // Cancelar equivale a eliminarlo del calendario: pide motivo y queda en el registro
  let motivo = null;
  if (estado === 'cancelado') motivo = motivoDe(req.body);
  await db.query('UPDATE mantenimientos SET estado = ? WHERE id = ?', [estado, m.id]);
  if (estado === 'cancelado') {
    const [[v]] = await db.query('SELECT codigo, nombre FROM vehiculos WHERE id = ?', [m.vehiculo_id]);
    const [[d]] = await db.query('SELECT descripcion FROM mantenimientos WHERE id = ?', [m.id]);
    await registrar({ vehiculo: v, accion: 'cancelar_mantenimiento', detalle: `Mantenimiento «${d.descripcion}» del ${m.fecha}`, motivo, usuario: req.user });
  }
  if (estado === 'realizado') {
    await aplicarRealizado({ ...m, km: m.km === null ? null : Number(m.km), horas: m.horas === null ? null : Number(m.horas) });
  }
  res.json({ ok: true });
}));

module.exports = router;
