const router = require('express').Router();
const db = require('../config/db');
const { ah, autenticar, requierePermiso } = require('../middleware/auth');
const { HORA, bad, nulo } = require('../services/validar');
const { SELECT, mapear, codigo } = require('../services/emergencias');

router.use(autenticar);
const ver = requierePermiso('dashboard', 'consulta');
const reg = requierePermiso('dashboard', 'registro');

const TIPOS = ['Incendio estructural', 'Incendio forestal', 'Rescate', 'Accidente de tránsito', 'Emergencia médica', 'Materiales peligrosos', 'Otro'];
const CARGOS = { jefe_de_maquina: 'Jefe de máquina', conductor: 'Conductor', bombero: 'Bombero', paramedico: 'Paramédico' };
const ESTADO_TXT = { en_uso: 'En servicio', en_mantenimiento: 'En mantenimiento', baja: 'Dado de baja', prestado: 'Prestado', inactivo_temporal: 'Temporalmente inactivo' };
const FECHA_HORA = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}$/;

// Hora de salida: vacío = ahora; "HH:MM" = hoy a esa hora; "AAAA-MM-DD HH:MM" = fecha completa.
function salida(v) {
  if (v === undefined || v === null || v === '') return { sql: 'NOW()', params: [] };
  if (HORA.test(v)) return { sql: 'TIMESTAMP(CURDATE(), ?)', params: [`${v}:00`] };
  if (FECHA_HORA.test(v)) return { sql: '?', params: [`${v.replace('T', ' ')}:00`] };
  throw bad('La hora de salida no es válida.');
}

async function obtenerAbierta(id) {
  const [[e]] = await db.query('SELECT id, estado FROM emergencias WHERE id = ?', [id]);
  if (!e) throw bad('Emergencia no encontrada.', 404);
  if (e.estado !== 'abierta') throw bad('La emergencia ya está cerrada.', 409);
  return e;
}

router.get('/opciones', ver, ah(async (req, res) => {
  const [vehiculos] = await db.query("SELECT id, codigo, nombre FROM vehiculos WHERE estado = 'activo' AND activo = 1 ORDER BY codigo");
  const [usuarios] = await db.query("SELECT id, nombre, situacion FROM usuarios WHERE estado = 'activo' ORDER BY nombre");
  res.json({ tipos: TIPOS, cargos: Object.entries(CARGOS).map(([id, nombre]) => ({ id, nombre })), vehiculos, usuarios });
}));

router.get('/', ver, ah(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
  const filtro = ['abierta', 'cerrada'].includes(req.query.estado) ? 'WHERE e.estado = ?' : '';
  const [filas] = await db.query(`${SELECT} ${filtro} ORDER BY e.fecha_salida DESC LIMIT ?`, [...(filtro ? [req.query.estado] : []), limit]);
  res.json(filas.map(mapear));
}));

router.get('/:id', ver, ah(async (req, res) => {
  const [[e]] = await db.query(`${SELECT} WHERE e.id = ?`, [req.params.id]);
  if (!e) throw bad('Emergencia no encontrada.', 404);
  const [personal] = await db.query(
    `SELECT p.id AS asignacion_id, p.usuario_id, u.nombre, p.cargo, p.estado
       FROM emergencia_personal p JOIN usuarios u ON u.id = p.usuario_id WHERE p.emergencia_id = ? ORDER BY p.id`,
    [e.id]
  );
  res.json({ ...mapear(e), personal });
}));

// HU-4.1: registrar emergencia. Las unidades elegidas pasan a "En servicio".
router.post('/', reg, ah(async (req, res) => {
  const b = req.body || {};
  if (!TIPOS.includes(b.tipo)) throw bad('Elige el tipo de emergencia.');
  const ubicacion = (b.ubicacion || '').trim();
  if (!ubicacion) throw bad('Escribe la ubicación.');
  const ids = [...new Set((Array.isArray(b.vehiculo_ids) ? b.vehiculo_ids : []).map(Number).filter(Boolean))];
  if (!ids.length) throw bad('Elige al menos una unidad.');
  const hora = salida(b.fecha_salida);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [unidades] = await conn.query('SELECT id, codigo, estado FROM vehiculos WHERE id IN (?) FOR UPDATE', [ids]);
    if (unidades.length !== ids.length) throw bad('Una de las unidades no existe.');
    const noDisponible = unidades.find((u) => u.estado !== 'activo');
    if (noDisponible) throw bad(`${noDisponible.codigo} no está disponible (${ESTADO_TXT[noDisponible.estado]}).`, 409);

    const [r] = await conn.query(
      `INSERT INTO emergencias (tipo, ubicacion, descripcion, fecha_salida, creado_por) VALUES (?, ?, ?, ${hora.sql}, ?)`,
      [b.tipo, ubicacion.slice(0, 160), nulo((b.descripcion || '').trim().slice(0, 255)), ...hora.params, req.user.id]
    );
    for (const id of ids) await conn.query('INSERT INTO emergencia_unidades (emergencia_id, vehiculo_id) VALUES (?, ?)', [r.insertId, id]);
    await conn.query("UPDATE vehiculos SET estado = 'en_uso' WHERE id IN (?)", [ids]);
    await conn.commit();
    res.status(201).json({ id: r.insertId, codigo: codigo(r.insertId) });
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}));

// Editar datos mientras la emergencia sigue abierta (por ejemplo, la hora de salida estimada)
router.patch('/:id', reg, ah(async (req, res) => {
  const e = await obtenerAbierta(req.params.id);
  const b = req.body || {};
  const sets = [];
  const valores = [];
  if (b.fecha_salida) { const h = salida(b.fecha_salida); sets.push(`fecha_salida = ${h.sql}`); valores.push(...h.params); }
  if (b.ubicacion) { sets.push('ubicacion = ?'); valores.push(b.ubicacion.trim().slice(0, 160)); }
  if (b.descripcion !== undefined) { sets.push('descripcion = ?'); valores.push(nulo((b.descripcion || '').trim().slice(0, 255))); }
  if (!sets.length) throw bad('No hay cambios para guardar.');
  await db.query(`UPDATE emergencias SET ${sets.join(', ')} WHERE id = ?`, [...valores, e.id]);
  res.json({ ok: true });
}));

// HU-4.2: asignar personal con su cargo
router.post('/:id/personal', reg, ah(async (req, res) => {
  const e = await obtenerAbierta(req.params.id);
  const { usuario_id, cargo } = req.body || {};
  if (!CARGOS[cargo]) throw bad('Elige el cargo.');
  const [[u]] = await db.query("SELECT id FROM usuarios WHERE id = ? AND estado = 'activo'", [usuario_id || 0]);
  if (!u) throw bad('Elige una persona activa.');
  try {
    const [r] = await db.query('INSERT INTO emergencia_personal (emergencia_id, usuario_id, cargo) VALUES (?, ?, ?)', [e.id, u.id, cargo]);
    res.status(201).json({ id: r.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw bad('Esa persona ya está asignada a esta emergencia.', 409);
    throw err;
  }
}));

router.patch('/:id/personal/:asignacion', reg, ah(async (req, res) => {
  const e = await obtenerAbierta(req.params.id);
  const { estado, cargo } = req.body || {};
  if (estado && !['confirmado', 'por_confirmar'].includes(estado)) throw bad('Estado no válido.');
  if (cargo && !CARGOS[cargo]) throw bad('Cargo no válido.');
  if (!estado && !cargo) throw bad('No hay cambios para guardar.');
  const [r] = await db.query(
    'UPDATE emergencia_personal SET estado = COALESCE(?, estado), cargo = COALESCE(?, cargo) WHERE id = ? AND emergencia_id = ?',
    [estado || null, cargo || null, req.params.asignacion, e.id]
  );
  if (!r.affectedRows) throw bad('Asignación no encontrada.', 404);
  res.json({ ok: true });
}));

router.delete('/:id/personal/:asignacion', reg, ah(async (req, res) => {
  const e = await obtenerAbierta(req.params.id);
  const [r] = await db.query('DELETE FROM emergencia_personal WHERE id = ? AND emergencia_id = ?', [req.params.asignacion, e.id]);
  if (!r.affectedRows) throw bad('Asignación no encontrada.', 404);
  res.json({ ok: true });
}));

// HU-4.1: cerrar la emergencia. Las unidades vuelven a estar disponibles si nada más las está usando.
router.patch('/:id/cerrar', reg, ah(async (req, res) => {
  const e = await obtenerAbierta(req.params.id);
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query("UPDATE emergencias SET estado = 'cerrada', fecha_cierre = NOW() WHERE id = ?", [e.id]);
    await conn.query(
      `UPDATE vehiculos v JOIN emergencia_unidades eu ON eu.vehiculo_id = v.id
          SET v.estado = 'activo'
        WHERE eu.emergencia_id = ? AND v.estado = 'en_uso'
          AND NOT EXISTS (SELECT 1 FROM emergencia_unidades eu2 JOIN emergencias e2 ON e2.id = eu2.emergencia_id
                           WHERE eu2.vehiculo_id = v.id AND e2.estado = 'abierta' AND e2.id <> ?)`,
      [e.id, e.id]
    );
    await conn.commit();
    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}));

module.exports = router;
