const jwt = require('jsonwebtoken');
const db = require('../config/db');
const { NIVELES } = require('../config/permisos');
const { cargarPermisos } = require('../services/sesion');

// Envuelve handlers async para que los errores lleguen al manejador de errores.
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// HU-1.1: valida el token y verifica que el usuario siga activo.
const autenticar = ah(async (req, res, next) => {
  const cabecera = req.headers.authorization || '';
  const token = cabecera.startsWith('Bearer ') ? cabecera.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Inicia sesión para continuar.' });

  let datos;
  try {
    datos = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'La sesión expiró. Inicia sesión de nuevo.' });
  }

  const [[usuario]] = await db.query(
    `SELECT u.id, u.nombre, u.rol_id, u.estado, r.nombre AS rol
       FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE u.id = ?`,
    [datos.id]
  );
  if (!usuario || usuario.estado !== 'activo') {
    return res.status(401).json({ error: 'Tu usuario está inactivo.' });
  }
  req.user = { id: usuario.id, nombre: usuario.nombre, rolId: usuario.rol_id, rol: usuario.rol };
  next();
});

// HU-1.3: exige al menos cierto nivel de acceso en un módulo.
const requierePermiso = (modulo, minimo) =>
  ah(async (req, res, next) => {
    const permisos = await cargarPermisos(req.user.rolId);
    const nivel = permisos[modulo] || 'ninguno';
    if (NIVELES.indexOf(nivel) < NIVELES.indexOf(minimo)) {
      return res.status(403).json({ error: 'No tienes permiso para esta acción.' });
    }
    next();
  });

module.exports = { ah, autenticar, requierePermiso };
