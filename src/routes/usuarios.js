const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { ah, autenticar, requierePermiso } = require('../middleware/auth');

router.use(autenticar);

const CAMPOS = `u.id, u.nombre, u.usuario, u.estado, u.situacion, u.rol_id, r.nombre AS rol,
                u.turno_id, t.nombre AS turno, u.creado_en`;
const SITUACIONES = ['en_turno', 'fuera_de_turno', 'licencia'];

// HU-1.2: listado con búsqueda
router.get('/', requierePermiso('configuracion', 'consulta'), ah(async (req, res) => {
  const { q, situacion } = req.query;
  const filtros = [];
  const valores = [];
  if (q) { filtros.push('(u.nombre LIKE ? OR u.usuario LIKE ?)'); valores.push(`%${q}%`, `%${q}%`); }
  if (situacion) { filtros.push('u.situacion = ?'); valores.push(situacion); }
  const donde = filtros.length ? `WHERE ${filtros.join(' AND ')}` : '';
  const [filas] = await db.query(
    `SELECT ${CAMPOS} FROM usuarios u
       JOIN roles r ON r.id = u.rol_id LEFT JOIN turnos t ON t.id = u.turno_id
       ${donde} ORDER BY u.nombre`,
    valores
  );
  res.json(filas);
}));

// Tarjetas de resumen: usuarios activos, en turno y roles configurados
router.get('/resumen', requierePermiso('configuracion', 'consulta'), ah(async (req, res) => {
  const [[r]] = await db.query(
    `SELECT SUM(estado = 'activo') AS activos,
            SUM(estado = 'activo' AND situacion = 'en_turno') AS en_turno
       FROM usuarios`
  );
  const [[roles]] = await db.query('SELECT COUNT(*) AS total FROM roles');
  res.json({ activos: Number(r.activos) || 0, enTurno: Number(r.en_turno) || 0, roles: roles.total });
}));

router.post('/', requierePermiso('configuracion', 'total'), ah(async (req, res) => {
  const { nombre, usuario, password, rol_id, turno_id = null } = req.body || {};
  if (!nombre || !usuario || !rol_id) return res.status(400).json({ error: 'Nombre, usuario y rol son obligatorios.' });
  if (!password || password.length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres.' });

  try {
    const hash = await bcrypt.hash(password, 10);
    const [r] = await db.query(
      'INSERT INTO usuarios (nombre, usuario, password_hash, rol_id, turno_id) VALUES (?, ?, ?, ?, ?)',
      [nombre.trim(), usuario.trim(), hash, rol_id, turno_id]
    );
    res.status(201).json({ id: r.insertId });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ese nombre de usuario ya existe.' });
    if (e.code === 'ER_NO_REFERENCED_ROW_2') return res.status(400).json({ error: 'El rol o el turno no existe.' });
    throw e;
  }
}));

router.put('/:id', requierePermiso('configuracion', 'total'), ah(async (req, res) => {
  const { nombre, rol_id, turno_id, situacion, password } = req.body || {};
  if (situacion && !SITUACIONES.includes(situacion)) return res.status(400).json({ error: 'Situación no válida.' });
  if (password && password.length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres.' });

  const sets = [];
  const valores = [];
  if (nombre) { sets.push('nombre = ?'); valores.push(nombre.trim()); }
  if (rol_id) { sets.push('rol_id = ?'); valores.push(rol_id); }
  if (turno_id !== undefined) { sets.push('turno_id = ?'); valores.push(turno_id || null); }
  if (situacion) { sets.push('situacion = ?'); valores.push(situacion); }
  if (password) { sets.push('password_hash = ?'); valores.push(await bcrypt.hash(password, 10)); }
  if (!sets.length) return res.status(400).json({ error: 'No hay cambios para guardar.' });

  const [r] = await db.query(`UPDATE usuarios SET ${sets.join(', ')} WHERE id = ?`, [...valores, req.params.id]);
  if (!r.affectedRows) return res.status(404).json({ error: 'Usuario no encontrado.' });
  res.json({ ok: true });
}));

// Activar o desactivar (no se borra: se conserva el historial)
router.patch('/:id/estado', requierePermiso('configuracion', 'total'), ah(async (req, res) => {
  const { estado } = req.body || {};
  if (!['activo', 'inactivo'].includes(estado)) return res.status(400).json({ error: 'Estado no válido.' });
  if (Number(req.params.id) === req.user.id && estado === 'inactivo') {
    return res.status(400).json({ error: 'No puedes desactivar tu propio usuario.' });
  }
  const [r] = await db.query('UPDATE usuarios SET estado = ? WHERE id = ?', [estado, req.params.id]);
  if (!r.affectedRows) return res.status(404).json({ error: 'Usuario no encontrado.' });
  res.json({ ok: true });
}));

module.exports = router;
