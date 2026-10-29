const router = require('express').Router();
const db = require('../config/db');

// HU-1.6: estado del servidor local (no requiere sesión ni internet).
router.get('/', async (req, res) => {
  let baseDatos = 'ok';
  try {
    await db.query('SELECT 1');
  } catch {
    baseDatos = 'error';
  }
  res.status(baseDatos === 'ok' ? 200 : 503).json({
    servidor: 'activo',
    baseDatos,
    hora: new Date().toISOString(),
    ultimaCopia: null, // se completa en HU-1.7 (copias de seguridad)
  });
});

module.exports = router;
