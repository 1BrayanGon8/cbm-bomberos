const router = require('express').Router();
const db = require('../config/db');
const { ah, autenticar, requierePermiso } = require('../middleware/auth');
const { turnoActivo, cicloActual } = require('../services/sesion');
const { FECHA, bad, nulo, numero } = require('../services/validar');

router.use(autenticar);

// HU-1.4: turno activo (lo ve cualquier usuario con sesión)
router.get('/activo', ah(async (req, res) => res.json(await turnoActivo())));

router.get('/', requierePermiso('configuracion', 'consulta'), ah(async (req, res) => {
  const [filas] = await db.query(
    `SELECT t.id, t.nombre, t.hora_inicio, t.hora_fin, t.activo,
            (SELECT COUNT(*) FROM usuarios u WHERE u.turno_id = t.id AND u.estado = 'activo') AS usuarios,
            (SELECT COUNT(*) FROM turno_refuerzos r WHERE r.turno_id = t.id AND r.fecha = ?) AS refuerzos
       FROM turnos t ORDER BY t.id`,
    [await cicloActual()]
  );
  res.json(filas);
}));

// Integrantes de cada turno (fijos) y refuerzos del ciclo (personas de otros turnos que hacen horas extras).
router.get('/integrantes', requierePermiso('configuracion', 'consulta'), ah(async (req, res) => {
  const fecha = FECHA.test(req.query.fecha || '') ? req.query.fecha : await cicloActual();
  const [turnos] = await db.query('SELECT id, nombre, hora_inicio, hora_fin, activo FROM turnos ORDER BY id');
  const [fijos] = await db.query(
    `SELECT u.id, u.nombre, u.turno_id, u.situacion, r.nombre AS rol FROM usuarios u JOIN roles r ON r.id = u.rol_id
      WHERE u.estado = 'activo' ORDER BY u.nombre`
  );
  const [refuerzos] = await db.query(
    `SELECT f.id, f.turno_id, f.usuario_id, u.nombre, f.horas, f.notas, f.fecha, tb.nombre AS turno_base
       FROM turno_refuerzos f JOIN usuarios u ON u.id = f.usuario_id LEFT JOIN turnos tb ON tb.id = u.turno_id
      WHERE f.fecha = ? ORDER BY u.nombre`,
    [fecha]
  );
  res.json({
    fecha,
    sin_turno: fijos.filter((u) => !u.turno_id),
    turnos: turnos.map((t) => ({
      ...t,
      integrantes: fijos.filter((u) => u.turno_id === t.id),
      refuerzos: refuerzos.filter((f) => f.turno_id === t.id),
    })),
  });
}));

// Agregar a un turno a alguien de otro turno que hace horas extras ese ciclo.
router.post('/refuerzos', requierePermiso('configuracion', 'total'), ah(async (req, res) => {
  const b = req.body || {};
  const [[t]] = await db.query('SELECT id FROM turnos WHERE id = ?', [b.turno_id || 0]);
  if (!t) throw bad('Elige el turno al que se suma la persona.');
  const [[u]] = await db.query("SELECT id, turno_id FROM usuarios WHERE id = ? AND estado = 'activo'", [b.usuario_id || 0]);
  if (!u) throw bad('Elige una persona activa.');
  if (u.turno_id === t.id) throw bad('Esa persona ya pertenece a este turno.');
  const fecha = b.fecha ? b.fecha : await cicloActual();
  if (!FECHA.test(fecha)) throw bad('La fecha no es válida.');
  const horas = numero(b.horas, 'Las horas extras', { positivo: true });
  if (horas !== null && horas > 24) throw bad('Las horas extras no pueden pasar de 24.');
  try {
    const [r] = await db.query(
      'INSERT INTO turno_refuerzos (turno_id, usuario_id, fecha, horas, notas, creado_por) VALUES (?, ?, ?, ?, ?, ?)',
      [t.id, u.id, fecha, horas, nulo((b.notas || '').trim().slice(0, 160)), req.user.id]
    );
    res.status(201).json({ id: r.insertId });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') throw bad('Esa persona ya está como refuerzo en este turno para esa fecha.', 409);
    throw e;
  }
}));

router.delete('/refuerzos/:id', requierePermiso('configuracion', 'total'), ah(async (req, res) => {
  const [r] = await db.query('DELETE FROM turno_refuerzos WHERE id = ?', [req.params.id]);
  if (!r.affectedRows) throw bad('Refuerzo no encontrado.', 404);
  res.json({ ok: true });
}));

router.post('/', requierePermiso('configuracion', 'total'), ah(async (req, res) => {
  const { nombre, hora_inicio, hora_fin } = req.body || {};
  if (!nombre || !hora_inicio || !hora_fin) return res.status(400).json({ error: 'Nombre, hora de inicio y hora de fin son obligatorios.' });
  try {
    const [r] = await db.query('INSERT INTO turnos (nombre, hora_inicio, hora_fin) VALUES (?, ?, ?)', [nombre.trim(), hora_inicio, hora_fin]);
    res.status(201).json({ id: r.insertId });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ya existe un turno con ese nombre.' });
    throw e;
  }
}));

router.put('/:id', requierePermiso('configuracion', 'total'), ah(async (req, res) => {
  const { nombre, hora_inicio, hora_fin } = req.body || {};
  const [r] = await db.query(
    'UPDATE turnos SET nombre = COALESCE(?, nombre), hora_inicio = COALESCE(?, hora_inicio), hora_fin = COALESCE(?, hora_fin) WHERE id = ?',
    [nombre || null, hora_inicio || null, hora_fin || null, req.params.id]
  );
  if (!r.affectedRows) return res.status(404).json({ error: 'Turno no encontrado.' });
  res.json({ ok: true });
}));

// Solo un turno está activo a la vez
router.post('/:id/activar', requierePermiso('configuracion', 'total'), ah(async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[t]] = await conn.query('SELECT id FROM turnos WHERE id = ?', [req.params.id]);
    if (!t) { await conn.rollback(); return res.status(404).json({ error: 'Turno no encontrado.' }); }
    await conn.query('UPDATE turnos SET activo = 0');
    await conn.query('UPDATE turnos SET activo = 1 WHERE id = ?', [t.id]);
    await conn.commit();
    res.json(await turnoActivo());
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}));

module.exports = router;
