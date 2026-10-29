const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const { ah, autenticar } = require('../middleware/auth');
const { cargarPermisos, turnoActivo } = require('../services/sesion');

// HU-1.1: inicio de sesión
router.post('/login', ah(async (req, res) => {
  const { usuario, password } = req.body || {};
  if (!usuario || !password) return res.status(400).json({ error: 'Escribe tu usuario y contraseña.' });

  const [[u]] = await db.query(
    `SELECT u.id, u.nombre, u.password_hash, u.rol_id, u.estado, r.nombre AS rol
       FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE u.usuario = ?`,
    [usuario]
  );
  const valido = u && u.estado === 'activo' && (await bcrypt.compare(password, u.password_hash));
  if (!valido) return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });

  const token = jwt.sign({ id: u.id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES || '8h' });
  res.json({
    token,
    usuario: { id: u.id, nombre: u.nombre, rol: u.rol },
    permisos: await cargarPermisos(u.rol_id),
    turnoActivo: await turnoActivo(),
  });
}));

// MODO DEMO: entra directo como el primer usuario Administrativo, sin pedir usuario ni contraseña.
// Solo responde si el .env tiene MODO_DEMO=1. No usar en producción.
router.get('/demo', ah(async (req, res) => {
  if (process.env.MODO_DEMO !== '1') return res.status(404).json({ error: 'No disponible.' });
  const [[u]] = await db.query(
    `SELECT u.id, u.nombre, u.rol_id, r.nombre AS rol FROM usuarios u JOIN roles r ON r.id = u.rol_id
      WHERE u.estado = 'activo' AND r.nombre = 'Administrativo' ORDER BY u.id LIMIT 1`
  );
  if (!u) return res.status(404).json({ error: 'No hay un usuario administrativo. Ejecuta npm run db:init.' });
  const token = jwt.sign({ id: u.id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES || '8h' });
  res.json({
    token,
    usuario: { id: u.id, nombre: u.nombre, rol: u.rol },
    permisos: await cargarPermisos(u.rol_id),
    turnoActivo: await turnoActivo(),
  });
}));

// Datos de la sesión actual: nombre, rol, permisos y turno activo.
router.get('/me', autenticar, ah(async (req, res) => {
  res.json({
    usuario: { id: req.user.id, nombre: req.user.nombre, rol: req.user.rol },
    permisos: await cargarPermisos(req.user.rolId),
    turnoActivo: await turnoActivo(),
  });
}));

module.exports = router;
