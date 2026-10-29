const router = require('express').Router();
const db = require('../config/db');
const { ah, autenticar, requierePermiso } = require('../middleware/auth');
const { bad, nulo } = require('../services/validar');

router.use(autenticar);
const ver = requierePermiso('desaparecidos', 'consulta');
const reg = requierePermiso('desaparecidos', 'registro');
const adm = requierePermiso('desaparecidos', 'total');

const URGENCIAS = ['alta', 'media', 'seguimiento'];
const FECHA_HORA = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}$/;
const CAMPOS = `d.id, d.nombre, d.edad, d.descripcion, d.urgencia, d.estado, d.ultima_ubicacion, d.latitud, d.longitud,
  d.ultima_vez, d.fecha_resolucion, (d.foto IS NOT NULL) AS tiene_foto`;

const mapear = (d) => ({
  ...d,
  latitud: d.latitud === null ? null : Number(d.latitud),
  longitud: d.longitud === null ? null : Number(d.longitud),
  tiene_foto: !!d.tiene_foto,
});

// Coordenadas con signo (la longitud de Colombia es negativa); van juntas o ninguna.
function coordenadas(b) {
  const leer = (v, nombre, min, max) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < min || n > max) throw bad(`${nombre} no es válida.`);
    return n;
  }
  const lat = leer(b.latitud, 'La latitud', -90, 90);
  const lng = leer(b.longitud, 'La longitud', -180, 180);
  if ((lat === null) !== (lng === null)) throw bad('Indica la latitud y la longitud juntas.');
  return { lat, lng };
}

// Fecha y hora de la última vez visto: vacío = ahora.
function ultimaVez(v) {
  if (v === undefined || v === null || v === '') return { sql: 'NOW()', params: [] };
  if (!FECHA_HORA.test(v)) throw bad('La fecha y hora no son válidas.');
  return { sql: '?', params: [`${v.replace('T', ' ')}:00`] };
}

// La foto llega como imagen en base64 (el navegador la reduce antes de enviarla).
function leerFoto(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || '');
  if (!m) throw bad('La foto debe ser una imagen JPG, PNG o WebP.');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 700 * 1024) throw bad('La foto es muy pesada (máximo 700 KB).');
  return { buf, tipo: m[1] };
}

function edad(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 120) throw bad('La edad no es válida.');
  return n;
}

async function obtener(id) {
  const [[d]] = await db.query(`SELECT ${CAMPOS} FROM desaparecidos d WHERE d.id = ?`, [id]);
  if (!d) throw bad('Caso no encontrado.', 404);
  return mapear(d);
}

// ---------- Mapa sin conexión: centro y alcance configurables ----------
async function configMapa() {
  const [filas] = await db.query("SELECT clave, valor FROM ajustes WHERE clave IN ('mapa_lat', 'mapa_lng', 'mapa_radio_km')");
  const m = Object.fromEntries(filas.map((f) => [f.clave, Number(f.valor)]));
  return { lat: m.mapa_lat ?? 4.8147, lng: m.mapa_lng ?? -74.3547, radio_km: m.mapa_radio_km ?? 12 };
}

router.get('/mapa', ver, ah(async (req, res) => res.json(await configMapa())));

router.put('/mapa', adm, ah(async (req, res) => {
  const { lat, lng } = coordenadas({ latitud: req.body?.lat, longitud: req.body?.lng });
  const radio = Number(req.body?.radio_km);
  if (lat === null || !Number.isFinite(radio) || radio < 1 || radio > 200) throw bad('Indica la latitud, la longitud y un alcance entre 1 y 200 km.');
  for (const [clave, valor] of [['mapa_lat', lat], ['mapa_lng', lng], ['mapa_radio_km', radio]]) {
    await db.query('INSERT INTO ajustes (clave, valor) VALUES (?, ?) ON DUPLICATE KEY UPDATE valor = VALUES(valor)', [clave, String(valor)]);
  }
  res.json(await configMapa());
}));

// ---------- Indicadores ----------
router.get('/resumen', ver, ah(async (req, res) => {
  const [[r]] = await db.query(
    `SELECT COALESCE(SUM(estado = 'activo'), 0) AS activos,
            COALESCE(SUM(estado = 'activo' AND urgencia = 'alta'), 0) AS alta,
            COALESCE(SUM(estado = 'resuelto' AND fecha_resolucion >= DATE_FORMAT(CURDATE(), '%Y-%m-01')), 0) AS resueltos_mes
       FROM desaparecidos`
  );
  res.json({ activos: Number(r.activos), alta: Number(r.alta), resueltos_mes: Number(r.resueltos_mes) });
}));

// HU-5.2: casos priorizados por urgencia (alta, media, en seguimiento) y por la última vez visto
router.get('/', ver, ah(async (req, res) => {
  const estado = ['activo', 'resuelto', 'todos'].includes(req.query.estado) ? req.query.estado : 'activo';
  const filtros = [];
  const valores = [];
  if (estado !== 'todos') { filtros.push('d.estado = ?'); valores.push(estado); }
  if (URGENCIAS.includes(req.query.urgencia)) { filtros.push('d.urgencia = ?'); valores.push(req.query.urgencia); }
  if (req.query.q) {
    filtros.push('(d.nombre LIKE ? OR d.descripcion LIKE ? OR d.ultima_ubicacion LIKE ?)');
    valores.push(...Array(3).fill(`%${req.query.q}%`));
  }
  const donde = filtros.length ? `WHERE ${filtros.join(' AND ')}` : '';
  const orden = estado === 'resuelto' ? 'ORDER BY d.fecha_resolucion DESC' : "ORDER BY FIELD(d.urgencia, 'alta', 'media', 'seguimiento'), d.ultima_vez DESC";
  const [filas] = await db.query(`SELECT ${CAMPOS} FROM desaparecidos d ${donde} ${orden} LIMIT 200`, valores);
  res.json(filas.map(mapear));
}));

router.get('/:id/foto', ver, ah(async (req, res) => {
  const [[d]] = await db.query('SELECT foto, foto_tipo FROM desaparecidos WHERE id = ?', [req.params.id]);
  if (!d || !d.foto) throw bad('Sin foto.', 404);
  res.set('Content-Type', d.foto_tipo);
  res.set('Cache-Control', 'private, max-age=300');
  res.send(d.foto);
}));

router.get('/:id', ver, ah(async (req, res) => res.json(await obtener(req.params.id))));

// HU-5.1: registrar caso
router.post('/', reg, ah(async (req, res) => {
  const b = req.body || {};
  const nombre = (b.nombre || '').trim();
  if (!nombre) throw bad('Escribe el nombre de la persona.');
  const ubicacion = (b.ultima_ubicacion || '').trim();
  if (!ubicacion) throw bad('Escribe la última ubicación conocida.');
  const urgencia = b.urgencia || 'media';
  if (!URGENCIAS.includes(urgencia)) throw bad('Nivel de urgencia no válido.');
  const { lat, lng } = coordenadas(b);
  const cuando = ultimaVez(b.ultima_vez);
  const foto = b.foto ? leerFoto(b.foto) : null;

  const [r] = await db.query(
    `INSERT INTO desaparecidos (nombre, edad, descripcion, urgencia, ultima_ubicacion, latitud, longitud, ultima_vez, foto, foto_tipo, creado_por)
     VALUES (?, ?, ?, ?, ?, ?, ?, ${cuando.sql}, ?, ?, ?)`,
    [nombre.slice(0, 100), edad(b.edad), nulo((b.descripcion || '').trim().slice(0, 255)), urgencia, ubicacion.slice(0, 160), lat, lng,
      ...cuando.params, foto ? foto.buf : null, foto ? foto.tipo : null, req.user.id]
  );
  res.status(201).json({ id: r.insertId });
}));

// HU-5.4: actualizar el caso (urgencia, última ubicación, datos o foto) mientras siga activo
router.patch('/:id', reg, ah(async (req, res) => {
  const d = await obtener(req.params.id);
  if (d.estado === 'resuelto') throw bad('El caso está resuelto. Reábrelo para editarlo.', 409);
  const b = req.body || {};
  const sets = [];
  const valores = [];

  if (b.nombre !== undefined) {
    if (!(b.nombre || '').trim()) throw bad('El nombre no puede quedar vacío.');
    sets.push('nombre = ?'); valores.push(b.nombre.trim().slice(0, 100));
  }
  if (b.edad !== undefined) { sets.push('edad = ?'); valores.push(edad(b.edad)); }
  if (b.descripcion !== undefined) { sets.push('descripcion = ?'); valores.push(nulo((b.descripcion || '').trim().slice(0, 255))); }
  if (b.urgencia !== undefined) {
    if (!URGENCIAS.includes(b.urgencia)) throw bad('Nivel de urgencia no válido.');
    sets.push('urgencia = ?'); valores.push(b.urgencia);
  }
  if (b.ultima_ubicacion !== undefined) {
    if (!(b.ultima_ubicacion || '').trim()) throw bad('La ubicación no puede quedar vacía.');
    sets.push('ultima_ubicacion = ?'); valores.push(b.ultima_ubicacion.trim().slice(0, 160));
  }
  if (b.latitud !== undefined || b.longitud !== undefined) {
    const { lat, lng } = coordenadas(b);
    sets.push('latitud = ?', 'longitud = ?'); valores.push(lat, lng);
  }
  if (b.ultima_vez) { const c = ultimaVez(b.ultima_vez); sets.push(`ultima_vez = ${c.sql}`); valores.push(...c.params); }
  if (b.foto) { const f = leerFoto(b.foto); sets.push('foto = ?', 'foto_tipo = ?'); valores.push(f.buf, f.tipo); }
  if (!sets.length) throw bad('No hay cambios para guardar.');

  await db.query(`UPDATE desaparecidos SET ${sets.join(', ')} WHERE id = ?`, [...valores, d.id]);
  res.json({ ok: true });
}));

// HU-5.4: cerrar el caso como resuelto (o reabrirlo)
router.patch('/:id/estado', reg, ah(async (req, res) => {
  const { estado } = req.body || {};
  if (!['activo', 'resuelto'].includes(estado)) throw bad('Estado no válido.');
  const d = await obtener(req.params.id);
  if (d.estado === estado) throw bad('El caso ya tiene ese estado.');
  await db.query(`UPDATE desaparecidos SET estado = ?, fecha_resolucion = ${estado === 'resuelto' ? 'NOW()' : 'NULL'} WHERE id = ?`, [estado, d.id]);
  res.json({ ok: true });
}));

module.exports = router;
