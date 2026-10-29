const router = require('express').Router();
const db = require('../config/db');
const { MODULOS, NIVELES } = require('../config/permisos');
const { ah, autenticar, requierePermiso } = require('../middleware/auth');
const { cargarPermisos } = require('../services/sesion');

router.use(autenticar);

router.get('/', requierePermiso('configuracion', 'consulta'), ah(async (req, res) => {
  const [roles] = await db.query('SELECT id, nombre, descripcion FROM roles ORDER BY id');
  res.json({ roles, modulos: MODULOS, niveles: NIVELES });
}));

router.get('/:id/permisos', requierePermiso('configuracion', 'consulta'), ah(async (req, res) => {
  res.json(await cargarPermisos(req.params.id));
}));

// HU-1.3: configurar permisos por rol y módulo
router.put('/:id/permisos', requierePermiso('configuracion', 'total'), ah(async (req, res) => {
  const { permisos } = req.body || {};
  if (!permisos || typeof permisos !== 'object') return res.status(400).json({ error: 'Envía los permisos por módulo.' });

  const [[rol]] = await db.query('SELECT id, nombre FROM roles WHERE id = ?', [req.params.id]);
  if (!rol) return res.status(404).json({ error: 'Rol no encontrado.' });

  for (const [modulo, nivel] of Object.entries(permisos)) {
    if (!MODULOS.includes(modulo) || !NIVELES.includes(nivel)) {
      return res.status(400).json({ error: `Permiso no válido: ${modulo} = ${nivel}.` });
    }
  }
  // El rol Administrativo siempre conserva acceso total a configuración (evita quedarse sin acceso).
  if (rol.nombre === 'Administrativo') permisos.configuracion = 'total';

  for (const [modulo, nivel] of Object.entries(permisos)) {
    await db.query(
      `INSERT INTO permisos (rol_id, modulo, nivel) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE nivel = VALUES(nivel)`,
      [rol.id, modulo, nivel]
    );
  }
  res.json(await cargarPermisos(rol.id));
}));

module.exports = router;
