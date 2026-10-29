// Búsqueda de personas en catástrofes: lo que hacen los bomberos con sesión iniciada
// (marcar eventos en el mapa, publicar personas halladas y atender los reportes del público).
const router = require('express').Router();
const db = require('../config/db');
const { ah, autenticar, requierePermiso } = require('../middleware/auth');
const { bad, nulo, numero, coordenadas } = require('../services/validar');
const { TIPOS } = require('../config/catastrofes');
const { buscarCoincidencias } = require('../services/coincidencias');

router.use(autenticar);
const ver = requierePermiso('desaparecidos', 'consulta');
const reg = requierePermiso('desaparecidos', 'registro');

const SEXOS = ['mujer', 'hombre', 'otro', 'no_se'];
const TIPOS_PERSONA = ['nino', 'adolescente', 'adulto', 'adulto_mayor'];
const CONDICIONES = ['ilesa', 'herida', 'hospitalizada'];

const coord = (v) => (v === null || v === undefined ? null : Number(v));
const conCoord = (f) => ({ ...f, latitud: coord(f.latitud), longitud: coord(f.longitud) });

router.get('/resumen', ver, ah(async (req, res) => {
  const [[r]] = await db.query(
    `SELECT (SELECT COUNT(*) FROM eventos_catastrofe WHERE estado = 'activo') AS eventos,
            (SELECT COUNT(*) FROM reportes_desaparecido WHERE estado = 'nuevo') AS nuevos,
            (SELECT COUNT(*) FROM reportes_desaparecido WHERE estado <> 'resuelto') AS abiertos,
            (SELECT COUNT(*) FROM personas_halladas WHERE estado = 'publicada') AS halladas`
  );
  res.json({ eventos_activos: Number(r.eventos), reportes_nuevos: Number(r.nuevos), reportes_abiertos: Number(r.abiertos), halladas_publicadas: Number(r.halladas) });
}));

// ---------- Eventos (zonas rojas del mapa) ----------
router.get('/eventos', ver, ah(async (req, res) => {
  const estado = ['activo', 'cerrado'].includes(req.query.estado) ? req.query.estado : null;
  const [filas] = await db.query(
    `SELECT e.id, e.tipo, e.titulo, e.descripcion, e.latitud, e.longitud, e.radio_m, e.estado, e.creado_en, e.fecha_cierre, u.nombre AS creado_por,
            (SELECT COUNT(*) FROM reportes_desaparecido r WHERE r.evento_id = e.id AND r.estado <> 'resuelto') AS reportes
       FROM eventos_catastrofe e LEFT JOIN usuarios u ON u.id = e.creado_por
      ${estado ? 'WHERE e.estado = ?' : ''} ORDER BY e.estado, e.creado_en DESC LIMIT 200`,
    estado ? [estado] : []
  );
  res.json(filas.map((f) => ({ ...conCoord(f), reportes: Number(f.reportes) })));
}));

function leerEvento(b, parcial = false) {
  const d = {};
  if (!parcial || b.tipo !== undefined) {
    if (!TIPOS[b.tipo]) throw bad('Elige el tipo de catástrofe.');
    d.tipo = b.tipo;
  }
  if (!parcial || b.titulo !== undefined) {
    const t = (b.titulo || '').trim();
    if (!t) throw bad('Escribe un título corto para el evento (por ejemplo, el barrio o la vereda).');
    d.titulo = t.slice(0, 120);
  }
  if (!parcial || b.descripcion !== undefined) d.descripcion = nulo((b.descripcion || '').trim().slice(0, 500));
  if (!parcial || b.latitud !== undefined || b.longitud !== undefined) {
    const { lat, lng } = coordenadas(b);
    if (lat === null) throw bad('Marca el lugar del evento en el mapa.');
    d.latitud = lat; d.longitud = lng;
  }
  if (!parcial || b.radio_m !== undefined) {
    const r = numero(b.radio_m, 'El radio', { entero: true, positivo: true });
    if (r === null || r < 50 || r > 100000) throw bad('El radio de la zona afectada debe estar entre 50 m y 100 km.');
    d.radio_m = r;
  }
  return d;
}

router.post('/eventos', reg, ah(async (req, res) => {
  const d = leerEvento(req.body || {});
  const [r] = await db.query(
    'INSERT INTO eventos_catastrofe (tipo, titulo, descripcion, latitud, longitud, radio_m, creado_por) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [d.tipo, d.titulo, d.descripcion, d.latitud, d.longitud, d.radio_m, req.user.id]
  );
  res.status(201).json({ id: r.insertId });
}));

router.patch('/eventos/:id', reg, ah(async (req, res) => {
  const d = leerEvento(req.body || {}, true);
  const claves = Object.keys(d);
  if (!claves.length) throw bad('No hay cambios para guardar.');
  const [r] = await db.query(`UPDATE eventos_catastrofe SET ${claves.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, [...claves.map((k) => d[k]), req.params.id]);
  if (!r.affectedRows) throw bad('Evento no encontrado.', 404);
  res.json({ ok: true });
}));

router.patch('/eventos/:id/estado', reg, ah(async (req, res) => {
  const estado = req.body?.estado;
  if (!['activo', 'cerrado'].includes(estado)) throw bad('Estado no válido.');
  const [r] = await db.query(`UPDATE eventos_catastrofe SET estado = ?, fecha_cierre = ${estado === 'cerrado' ? 'NOW()' : 'NULL'} WHERE id = ?`, [estado, req.params.id]);
  if (!r.affectedRows) throw bad('Evento no encontrado.', 404);
  res.json({ ok: true });
}));

// ---------- Personas halladas (lo que ve el público cuando coincide) ----------
const HALLADA = `SELECT h.id, h.evento_id, h.nombre, h.tipo_persona, h.edad_aprox, h.sexo, h.descripcion, h.condicion, h.ubicacion_actual,
    h.latitud, h.longitud, h.estado, h.creado_en, h.fecha_entrega, u.nombre AS publicada_por
  FROM personas_halladas h LEFT JOIN usuarios u ON u.id = h.creado_por`;

router.get('/halladas', ver, ah(async (req, res) => {
  const estado = ['publicada', 'entregada'].includes(req.query.estado) ? req.query.estado : 'publicada';
  const [filas] = await db.query(`${HALLADA} WHERE h.estado = ? ORDER BY h.creado_en DESC LIMIT 200`, [estado]);
  res.json(filas.map(conCoord));
}));

router.post('/halladas', reg, ah(async (req, res) => {
  const b = req.body || {};
  if (!TIPOS_PERSONA.includes(b.tipo_persona)) throw bad('Elige qué tipo de persona es.');
  const ubicacion = (b.ubicacion_actual || '').trim();
  if (!ubicacion) throw bad('Indica dónde se encuentra la persona (albergue, hospital, estación…).');
  const sexo = b.sexo || 'no_se';
  if (!SEXOS.includes(sexo)) throw bad('El sexo indicado no es válido.');
  const condicion = b.condicion || 'ilesa';
  if (!CONDICIONES.includes(condicion)) throw bad('La condición indicada no es válida.');
  const edad = numero(b.edad_aprox, 'La edad', { entero: true });
  if (edad !== null && edad > 120) throw bad('La edad no es válida.');
  const { lat, lng } = coordenadas(b);
  let evento = nulo(b.evento_id);
  if (evento !== null) {
    const [[ev]] = await db.query('SELECT id FROM eventos_catastrofe WHERE id = ?', [evento]);
    if (!ev) throw bad('El evento no existe.');
    evento = ev.id;
  }
  const [r] = await db.query(
    `INSERT INTO personas_halladas (evento_id, nombre, tipo_persona, edad_aprox, sexo, descripcion, condicion, ubicacion_actual, latitud, longitud, creado_por)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [evento, nulo((b.nombre || '').trim().slice(0, 100)), b.tipo_persona, edad, sexo, nulo((b.descripcion || '').trim().slice(0, 500)), condicion, ubicacion.slice(0, 160), lat, lng, req.user.id]
  );
  res.status(201).json({ id: r.insertId });
}));

router.patch('/halladas/:id', reg, ah(async (req, res) => {
  const b = req.body || {};
  const sets = [];
  const valores = [];
  if (b.ubicacion_actual !== undefined) {
    if (!(b.ubicacion_actual || '').trim()) throw bad('La ubicación no puede quedar vacía.');
    sets.push('ubicacion_actual = ?'); valores.push(b.ubicacion_actual.trim().slice(0, 160));
  }
  if (b.condicion !== undefined) {
    if (!CONDICIONES.includes(b.condicion)) throw bad('La condición indicada no es válida.');
    sets.push('condicion = ?'); valores.push(b.condicion);
  }
  if (b.estado !== undefined) {
    if (!['publicada', 'entregada'].includes(b.estado)) throw bad('Estado no válido.');
    sets.push('estado = ?', `fecha_entrega = ${b.estado === 'entregada' ? 'NOW()' : 'NULL'}`); valores.push(b.estado);
  }
  if (!sets.length) throw bad('No hay cambios para guardar.');
  const [r] = await db.query(`UPDATE personas_halladas SET ${sets.join(', ')} WHERE id = ?`, [...valores, req.params.id]);
  if (!r.affectedRows) throw bad('Registro no encontrado.', 404);
  res.json({ ok: true });
}));

// ---------- Reportes del público ----------
async function halladasPublicadas() {
  const [filas] = await db.query("SELECT * FROM personas_halladas WHERE estado = 'publicada' ORDER BY creado_en DESC LIMIT 500");
  return filas;
}

router.get('/reportes', ver, ah(async (req, res) => {
  const estado = ['nuevo', 'en_revision', 'resuelto', 'abiertos'].includes(req.query.estado) ? req.query.estado : 'abiertos';
  const donde = estado === 'abiertos' ? "r.estado <> 'resuelto'" : 'r.estado = ?';
  const [filas] = await db.query(
    `SELECT r.id, r.codigo, r.evento_id, e.titulo AS evento, e.tipo AS evento_tipo, r.nombre, r.edad, r.sexo, r.descripcion, r.ultima_ubicacion,
            r.contacto_nombre, r.contacto_telefono, r.contacto_correo, r.estado, r.notas_bomberos, r.creado_en, r.fecha_resolucion, u.nombre AS atendido_por
       FROM reportes_desaparecido r LEFT JOIN eventos_catastrofe e ON e.id = r.evento_id LEFT JOIN usuarios u ON u.id = r.atendido_por
      WHERE ${donde} ORDER BY FIELD(r.estado, 'nuevo', 'en_revision', 'resuelto'), r.creado_en DESC LIMIT 200`,
    estado === 'abiertos' ? [] : [estado]
  );
  const halladas = await halladasPublicadas();
  res.json(filas.map((r) => ({ ...r, coincidencias: buscarCoincidencias(r, halladas).length })));
}));

router.get('/reportes/:id/coincidencias', ver, ah(async (req, res) => {
  const [[r]] = await db.query('SELECT evento_id, nombre, edad, sexo, descripcion FROM reportes_desaparecido WHERE id = ?', [req.params.id]);
  if (!r) throw bad('Reporte no encontrado.', 404);
  res.json(buscarCoincidencias(r, await halladasPublicadas()).map(conCoord));
}));

router.patch('/reportes/:id', reg, ah(async (req, res) => {
  const b = req.body || {};
  const sets = [];
  const valores = [];
  if (b.estado !== undefined) {
    if (!['nuevo', 'en_revision', 'resuelto'].includes(b.estado)) throw bad('Estado no válido.');
    sets.push('estado = ?', `fecha_resolucion = ${b.estado === 'resuelto' ? 'NOW()' : 'NULL'}`, 'atendido_por = ?');
    valores.push(b.estado, req.user.id);
  }
  if (b.notas_bomberos !== undefined) { sets.push('notas_bomberos = ?'); valores.push(nulo((b.notas_bomberos || '').trim().slice(0, 500))); }
  if (!sets.length) throw bad('No hay cambios para guardar.');
  const [r] = await db.query(`UPDATE reportes_desaparecido SET ${sets.join(', ')} WHERE id = ?`, [...valores, req.params.id]);
  if (!r.affectedRows) throw bad('Reporte no encontrado.', 404);
  res.json({ ok: true });
}));

module.exports = router;
