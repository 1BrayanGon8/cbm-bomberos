const router = require('express').Router();
const db = require('../config/db');
const { ah, autenticar, requierePermiso } = require('../middleware/auth');
const { bad, nulo, coordenadas, fechaHora } = require('../services/validar');
const { configMapa } = require('../services/mapa');
const { codigo } = require('../services/emergencias');

router.use(autenticar);
const ver = requierePermiso('vias', 'consulta');
const reg = requierePermiso('vias', 'registro');

const TIPOS = ['obstruccion', 'accidente'];

const SELECT = `SELECT r.id, r.tipo, r.ubicacion, r.latitud, r.longitud, r.descripcion, r.estado, r.ocurrido_en,
    r.emergencia_id, r.fecha_despeje, u.nombre AS autor, ud.nombre AS despejado_por
  FROM reportes_via r LEFT JOIN usuarios u ON u.id = r.usuario_id LEFT JOIN usuarios ud ON ud.id = r.despejado_por`;

const mapear = (r) => ({
  ...r,
  latitud: r.latitud === null ? null : Number(r.latitud),
  longitud: r.longitud === null ? null : Number(r.longitud),
  emergencia: r.emergencia_id ? codigo(r.emergencia_id) : null,
});

router.get('/mapa', ver, ah(async (req, res) => res.json(await configMapa())));

// Emergencias abiertas, para vincular un accidente
router.get('/opciones', ver, ah(async (req, res) => {
  const [abiertas] = await db.query("SELECT id, tipo, ubicacion FROM emergencias WHERE estado = 'abierta' ORDER BY fecha_salida DESC");
  res.json({ emergencias: abiertas.map((e) => ({ id: e.id, codigo: codigo(e.id), tipo: e.tipo, ubicacion: e.ubicacion })) });
}));

router.get('/resumen', ver, ah(async (req, res) => {
  const [[r]] = await db.query(
    `SELECT COALESCE(SUM(estado = 'activa'), 0) AS activas,
            COALESCE(SUM(estado = 'activa' AND tipo = 'obstruccion'), 0) AS obstrucciones,
            COALESCE(SUM(estado = 'activa' AND tipo = 'accidente'), 0) AS accidentes
       FROM reportes_via`
  );
  res.json({ activas: Number(r.activas), obstrucciones: Number(r.obstrucciones), accidentes: Number(r.accidentes) });
}));

router.get('/', ver, ah(async (req, res) => {
  const estado = ['activa', 'despejada', 'todas'].includes(req.query.estado) ? req.query.estado : 'activa';
  const filtros = [];
  const valores = [];
  if (estado !== 'todas') { filtros.push('r.estado = ?'); valores.push(estado); }
  if (TIPOS.includes(req.query.tipo)) { filtros.push('r.tipo = ?'); valores.push(req.query.tipo); }
  if (req.query.q) { filtros.push('(r.ubicacion LIKE ? OR r.descripcion LIKE ?)'); valores.push(`%${req.query.q}%`, `%${req.query.q}%`); }
  const donde = filtros.length ? `WHERE ${filtros.join(' AND ')}` : '';
  const [filas] = await db.query(`${SELECT} ${donde} ORDER BY r.ocurrido_en DESC LIMIT 200`, valores);
  res.json(filas.map(mapear));
}));

// HU-9.1 y 9.2: reportar una obstrucción o un accidente (queda "Activa")
router.post('/', reg, ah(async (req, res) => {
  const b = req.body || {};
  if (!TIPOS.includes(b.tipo)) throw bad('Indica si es una obstrucción o un accidente.');
  const ubicacion = (b.ubicacion || '').trim();
  if (!ubicacion) throw bad('Escribe la ubicación.');
  const descripcion = (b.descripcion || '').trim();
  if (!descripcion) throw bad('Escribe la descripción.');
  const { lat, lng } = coordenadas(b);
  const cuando = fechaHora(b.ocurrido_en);

  // Solo un accidente se puede vincular a una emergencia
  let emergencia = null;
  if (b.tipo === 'accidente' && b.emergencia_id) {
    const [[e]] = await db.query('SELECT id FROM emergencias WHERE id = ?', [b.emergencia_id]);
    if (!e) throw bad('La emergencia elegida no existe.');
    emergencia = e.id;
  }

  const [r] = await db.query(
    `INSERT INTO reportes_via (tipo, ubicacion, latitud, longitud, descripcion, ocurrido_en, emergencia_id, usuario_id)
     VALUES (?, ?, ?, ?, ?, ${cuando.sql}, ?, ?)`,
    [b.tipo, ubicacion.slice(0, 160), lat, lng, descripcion.slice(0, 255), ...cuando.params, emergencia, req.user.id]
  );
  res.status(201).json({ id: r.insertId });
}));

// HU-9.4: marcar como despejada (o volver a activar si fue un error). El reporte se conserva en el historial.
router.patch('/:id/estado', reg, ah(async (req, res) => {
  const { estado } = req.body || {};
  if (!['activa', 'despejada'].includes(estado)) throw bad('Estado no válido.');
  const [[r]] = await db.query('SELECT id, estado FROM reportes_via WHERE id = ?', [req.params.id]);
  if (!r) throw bad('Reporte no encontrado.', 404);
  if (r.estado === estado) throw bad('El reporte ya tiene ese estado.', 409);
  if (estado === 'despejada') {
    await db.query("UPDATE reportes_via SET estado = 'despejada', fecha_despeje = NOW(), despejado_por = ? WHERE id = ?", [req.user.id, r.id]);
  } else {
    await db.query("UPDATE reportes_via SET estado = 'activa', fecha_despeje = NULL, despejado_por = NULL WHERE id = ?", [r.id]);
  }
  res.json({ ok: true });
}));

module.exports = router;
