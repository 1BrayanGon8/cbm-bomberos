const router = require('express').Router();
const db = require('../config/db');
const { NIVELES } = require('../config/permisos');
const { ah, autenticar, requierePermiso } = require('../middleware/auth');
const { cargarPermisos, cicloActual } = require('../services/sesion');

router.use(autenticar);

// Quién marca: uno mismo, o un administrativo a nombre de otro usuario.
async function resolverUsuario(req, res) {
  const objetivo = Number(req.body?.usuario_id) || req.user.id;
  if (objetivo !== req.user.id) {
    const permisos = await cargarPermisos(req.user.rolId);
    if (NIVELES.indexOf(permisos.configuracion || 'ninguno') < NIVELES.indexOf('total')) {
      res.status(403).json({ error: 'Solo un administrativo puede marcar por otro usuario.' });
      return null;
    }
  }
  const [[u]] = await db.query('SELECT id, turno_id, estado, situacion FROM usuarios WHERE id = ?', [objetivo]);
  if (!u || u.estado !== 'activo') { res.status(404).json({ error: 'Usuario no encontrado o inactivo.' }); return null; }
  return u;
}

// HU-1.5: registrar entrada
router.post('/entrada', ah(async (req, res) => {
  const u = await resolverUsuario(req, res);
  if (!u) return;
  if (u.situacion === 'licencia') return res.status(400).json({ error: 'El usuario está en licencia.' });

  const [[abierta]] = await db.query('SELECT id FROM asistencia WHERE usuario_id = ? AND salida IS NULL', [u.id]);
  if (abierta) return res.status(409).json({ error: 'Ya hay una entrada registrada sin salida.' });

  // Si hoy hace horas extras en otro turno, la entrada queda en ese turno.
  const [[extra]] = await db.query('SELECT turno_id FROM turno_refuerzos WHERE usuario_id = ? AND fecha = ? LIMIT 1', [u.id, await cicloActual()]);
  await db.query('INSERT INTO asistencia (usuario_id, turno_id, entrada) VALUES (?, ?, NOW())', [u.id, extra ? extra.turno_id : u.turno_id]);
  await db.query("UPDATE usuarios SET situacion = 'en_turno' WHERE id = ?", [u.id]);
  res.status(201).json({ ok: true });
}));

// HU-1.5: registrar salida
router.post('/salida', ah(async (req, res) => {
  const u = await resolverUsuario(req, res);
  if (!u) return;

  const [r] = await db.query('UPDATE asistencia SET salida = NOW() WHERE usuario_id = ? AND salida IS NULL', [u.id]);
  if (!r.affectedRows) return res.status(409).json({ error: 'No hay una entrada abierta para registrar la salida.' });
  await db.query("UPDATE usuarios SET situacion = 'fuera_de_turno' WHERE id = ?", [u.id]);
  res.json({ ok: true });
}));

// Estado de asistencia del usuario con sesión (para habilitar el botón correcto)
router.get('/mia', ah(async (req, res) => {
  const [[abierta]] = await db.query('SELECT id, entrada FROM asistencia WHERE usuario_id = ? AND salida IS NULL', [req.user.id]);
  res.json({ dentro: !!abierta, entrada: abierta ? abierta.entrada : null });
}));

// Control de entrada/salida por día (por defecto, hoy)
router.get('/', requierePermiso('configuracion', 'consulta'), ah(async (req, res) => {
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(req.query.fecha || '') ? req.query.fecha : null;
  const [filas] = await db.query(
    `SELECT a.id, a.usuario_id, u.nombre, t.nombre AS turno, a.entrada, a.salida
       FROM asistencia a JOIN usuarios u ON u.id = a.usuario_id LEFT JOIN turnos t ON t.id = a.turno_id
      WHERE DATE(a.entrada) = COALESCE(?, CURDATE()) ORDER BY a.entrada DESC`,
    [fecha]
  );
  res.json(filas);
}));

module.exports = router;
