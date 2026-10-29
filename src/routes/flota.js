const router = require('express').Router();
const db = require('../config/db');
const { ah, autenticar, requierePermiso } = require('../middleware/auth');
const { cargarAjustes, listarPlanes, listarFlota, aplicarRealizado } = require('../services/flota');
const { FECHA, bad, nulo, numero } = require('../services/validar');
const { registrar, motivoDe, verificarClave } = require('../services/bitacora');

router.use(autenticar);
const ver = requierePermiso('mantenimientos', 'consulta');
const reg = requierePermiso('mantenimientos', 'registro');
const adm = requierePermiso('mantenimientos', 'total');

const TIPOS_VEHICULO = ['maquina', 'ambulancia', 'rescate', 'otro'];
const ESTADOS_VEHICULO = ['activo', 'en_uso', 'en_mantenimiento', 'baja', 'inactivo_temporal'];
const TIPOS_PLAN = ['preventivo', 'inspeccion', 'chequeo'];
const TIPOS_CAMPO = ['texto', 'numero', 'fecha'];

async function obtenerVehiculo(id, { permitirBaja = false } = {}) {
  const [[v]] = await db.query('SELECT * FROM vehiculos WHERE id = ?', [id]);
  if (!v) throw bad('Vehículo no encontrado.', 404);
  if (v.estado === 'baja' && !permitirBaja) throw bad('El vehículo está eliminado.', 409);
  return v;
}

// HU-3.7: guarda los valores de los campos personalizables de un vehículo
async function guardarCampos(conn, vehiculoId, campos) {
  const [defs] = await conn.query('SELECT id, nombre, tipo FROM vehiculo_campos WHERE activo = 1');
  const mapa = new Map(defs.map((d) => [String(d.id), d]));
  for (const [id, valor] of Object.entries(campos || {})) {
    const def = mapa.get(String(id));
    if (!def) throw bad('Uno de los campos personalizados no existe.');
    const v = typeof valor === 'string' ? valor.trim() : valor;
    if (v === '' || v === null || v === undefined) {
      await conn.query('DELETE FROM vehiculo_campo_valores WHERE vehiculo_id = ? AND campo_id = ?', [vehiculoId, def.id]);
      continue;
    }
    if (def.tipo === 'numero' && !Number.isFinite(Number(v))) throw bad(`El campo "${def.nombre}" debe ser un número.`);
    if (def.tipo === 'fecha' && !FECHA.test(v)) throw bad(`El campo "${def.nombre}" debe ser una fecha (AAAA-MM-DD).`);
    await conn.query(
      'INSERT INTO vehiculo_campo_valores (vehiculo_id, campo_id, valor) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE valor = VALUES(valor)',
      [vehiculoId, def.id, String(v).slice(0, 255)]
    );
  }
}

const errorDuplicado = (e) => {
  if (e.code === 'ER_DUP_ENTRY') throw bad('Ya existe un vehículo con ese código o esa placa.', 409);
  throw e;
};

// ---------- Avisos (HU-3.4) ----------
router.get('/config', ver, ah(async (req, res) => res.json(await cargarAjustes())));

router.put('/config', adm, ah(async (req, res) => {
  const claves = { aviso_dias: 'dias', aviso_km: 'km', aviso_horas: 'horas' };
  for (const clave of Object.keys(claves)) {
    const v = numero(req.body?.[clave], 'El aviso', { entero: true, positivo: true });
    if (v !== null) await db.query('INSERT INTO ajustes (clave, valor) VALUES (?, ?) ON DUPLICATE KEY UPDATE valor = VALUES(valor)', [clave, String(v)]);
  }
  res.json(await cargarAjustes());
}));

// ---------- Campos personalizables (HU-3.7) ----------
router.get('/campos', ver, ah(async (req, res) => {
  const [filas] = await db.query('SELECT id, nombre, tipo FROM vehiculo_campos WHERE activo = 1 ORDER BY id');
  res.json(filas);
}));

router.post('/campos', adm, ah(async (req, res) => {
  const nombre = (req.body?.nombre || '').trim();
  const tipo = req.body?.tipo || 'texto';
  if (!nombre) throw bad('Escribe el nombre del campo.');
  if (!TIPOS_CAMPO.includes(tipo)) throw bad('Tipo de campo no válido.');
  try {
    const [r] = await db.query('INSERT INTO vehiculo_campos (nombre, tipo) VALUES (?, ?)', [nombre.slice(0, 60), tipo]);
    res.status(201).json({ id: r.insertId });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') {
      // Si el campo existía y se había desactivado, se reactiva.
      const [r] = await db.query('UPDATE vehiculo_campos SET activo = 1, tipo = ? WHERE nombre = ? AND activo = 0', [tipo, nombre]);
      if (r.affectedRows) return res.status(201).json({ reactivado: true });
      throw bad('Ya existe un campo con ese nombre.', 409);
    }
    throw e;
  }
}));

router.delete('/campos/:id', adm, ah(async (req, res) => {
  // Se desactiva (no se borra) para conservar los valores ya guardados.
  const [r] = await db.query('UPDATE vehiculo_campos SET activo = 0 WHERE id = ?', [req.params.id]);
  if (!r.affectedRows) throw bad('Campo no encontrado.', 404);
  res.json({ ok: true });
}));

// ---------- Vehículos (HU-3.7, 3.8) y alistamiento (HU-3.3) ----------
router.get('/vehiculos', ver, ah(async (req, res) => res.json(await listarFlota({ incluirBajas: req.query.incluir_bajas === '1' }))));

router.get('/vehiculos/:id', ver, ah(async (req, res) => {
  const v = await obtenerVehiculo(req.params.id, { permitirBaja: true });
  const [campos] = await db.query(
    `SELECT c.id, c.nombre, c.tipo, vv.valor FROM vehiculo_campos c
       LEFT JOIN vehiculo_campo_valores vv ON vv.campo_id = c.id AND vv.vehiculo_id = ?
      WHERE c.activo = 1 ORDER BY c.id`,
    [v.id]
  );
  res.json({ id: v.id, codigo: v.codigo, nombre: v.nombre, placa: v.placa, tipo: v.tipo, estado: v.estado,
    km_actual: Number(v.km_actual), horas_actuales: Number(v.horas_actuales), campos });
}));

router.post('/vehiculos', adm, ah(async (req, res) => {
  const b = req.body || {};
  const codigo = (b.codigo || '').trim().toUpperCase();
  const nombre = (b.nombre || '').trim();
  const tipo = b.tipo || 'maquina';
  if (!codigo || !nombre) throw bad('El código y el nombre son obligatorios.');
  if (!TIPOS_VEHICULO.includes(tipo)) throw bad('Tipo de vehículo no válido.');
  const placa = nulo((b.placa || '').trim().toUpperCase());
  const km = numero(b.km_actual, 'El kilometraje', { entero: true }) ?? 0;
  const horas = numero(b.horas_actuales, 'Las horas de uso') ?? 0;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [r] = await conn.query(
      'INSERT INTO vehiculos (codigo, nombre, placa, tipo, km_actual, horas_actuales) VALUES (?, ?, ?, ?, ?, ?)',
      [codigo, nombre, placa, tipo, km, horas]
    );
    await guardarCampos(conn, r.insertId, b.campos);
    await conn.commit();
    res.status(201).json({ id: r.insertId });
  } catch (e) {
    await conn.rollback();
    errorDuplicado(e);
  } finally {
    conn.release();
  }
}));

router.put('/vehiculos/:id', adm, ah(async (req, res) => {
  const v = await obtenerVehiculo(req.params.id, { permitirBaja: true });
  const b = req.body || {};
  if (b.tipo && !TIPOS_VEHICULO.includes(b.tipo)) throw bad('Tipo de vehículo no válido.');
  const sets = [];
  const valores = [];
  if (b.codigo) { sets.push('codigo = ?'); valores.push(b.codigo.trim().toUpperCase()); }
  if (b.nombre) { sets.push('nombre = ?'); valores.push(b.nombre.trim()); }
  if (b.tipo) { sets.push('tipo = ?'); valores.push(b.tipo); }
  if (b.placa !== undefined) { sets.push('placa = ?'); valores.push(nulo((b.placa || '').trim().toUpperCase())); }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    if (sets.length) await conn.query(`UPDATE vehiculos SET ${sets.join(', ')} WHERE id = ?`, [...valores, v.id]);
    await guardarCampos(conn, v.id, b.campos);
    await conn.commit();
    res.json({ ok: true });
  } catch (e) {
    await conn.rollback();
    errorDuplicado(e);
  } finally {
    conn.release();
  }
}));

// HU-3.8: estado del vehículo. Dado de baja lo saca de las listas de unidades activas.
router.patch('/vehiculos/:id/estado', adm, ah(async (req, res) => {
  const { estado } = req.body || {};
  if (estado === 'prestado') throw bad('Para prestar un vehículo regístralo en el módulo Préstamos.');
  if (!ESTADOS_VEHICULO.includes(estado)) throw bad('Estado no válido.');
  if (estado === 'baja') throw bad('Para eliminar un vehículo usa el botón "Eliminar": pide el motivo y tu contraseña.');
  const v = await obtenerVehiculo(req.params.id, { permitirBaja: true });
  if (v.estado === 'baja') throw bad('Este vehículo está eliminado. Para reintegrarlo usa el botón "Reintegrar": pide el motivo y tu contraseña.', 409);
  if (v.estado === 'prestado') throw bad('El vehículo está prestado: registra su devolución en el módulo Préstamos.', 409);
  await db.query('UPDATE vehiculos SET estado = ?, activo = ? WHERE id = ?', [estado, estado === 'baja' ? 0 : 1, v.id]);
  res.json({ ok: true });
}));

// Eliminar un vehículo: solo con permiso total (administrador), con su contraseña y un motivo. Queda en el registro.
// Sale de todas las listas y sus elementos pasan al Almacén. Se conserva su historial para poder reintegrarlo después (también con contraseña);
// al reintegrarlo vuelve SIN los elementos que tenía.
router.post('/vehiculos/:id/baja', adm, ah(async (req, res) => {
  const motivo = motivoDe(req.body);
  const v = await obtenerVehiculo(req.params.id, { permitirBaja: true });
  if (v.estado === 'baja') throw bad(`${v.nombre} ya está eliminado.`, 409);
  if (['prestado', 'en_uso'].includes(v.estado)) throw bad(`${v.nombre} está ${v.estado === 'prestado' ? 'prestado' : 'en servicio'}: espera a que regrese para eliminarlo.`, 409);
  await verificarClave(req);
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[{ n }]] = await conn.query("SELECT COUNT(*) AS n FROM equipos WHERE vehiculo_id = ? AND estado <> 'baja'", [v.id]);
    await conn.query(
      "INSERT INTO equipo_eventos (equipo_id, tipo, detalle, usuario_id) SELECT id, 'traslado', ?, ? FROM equipos WHERE vehiculo_id = ?",
      [`De ${v.nombre} a Almacén (vehículo eliminado)`, req.user.id, v.id]
    );
    await conn.query('UPDATE equipos SET vehiculo_id = NULL WHERE vehiculo_id = ?', [v.id]);
    await conn.query("UPDATE vehiculos SET estado = 'baja', activo = 0 WHERE id = ?", [v.id]);
    await registrar({ vehiculo: v, accion: 'eliminar_vehiculo', detalle: `Vehículo eliminado${n ? ` (${n} elemento(s) pasaron al Almacén)` : ''}`, motivo, usuario: req.user }, conn);
    await conn.commit();
    res.json({ ok: true });
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}));

router.post('/vehiculos/:id/reintegrar', adm, ah(async (req, res) => {
  const motivo = motivoDe(req.body);
  const v = await obtenerVehiculo(req.params.id, { permitirBaja: true });
  if (v.estado !== 'baja') throw bad(`${v.nombre} no está eliminado.`, 409);
  await verificarClave(req);
  await db.query("UPDATE vehiculos SET estado = 'activo', activo = 1 WHERE id = ?", [v.id]);
  await registrar({ vehiculo: v, accion: 'reintegro_vehiculo', detalle: 'Vehículo reintegrado a la flota, sin los elementos que tenía', motivo, usuario: req.user });
  res.json({ ok: true });
}));

// Registro de eliminaciones y bajas (solo administrador)
router.get('/bitacora', adm, ah(async (req, res) => {
  const [filas] = await db.query(
    'SELECT id, vehiculo_codigo, vehiculo_nombre, accion, detalle, motivo, usuario_nombre, creado_en FROM bitacora_flota ORDER BY creado_en DESC, id DESC LIMIT 100'
  );
  res.json(filas);
}));

// ---------- HU-3.9: horas de servicio y kilometraje en cada entrada ----------
router.post('/vehiculos/:id/uso', reg, ah(async (req, res) => {
  const v = await obtenerVehiculo(req.params.id);
  const km = numero(req.body?.km, 'El kilometraje', { entero: true });
  const horas = numero(req.body?.horas, 'Las horas de uso');
  if (km === null && horas === null) throw bad('Escribe el kilometraje o las horas de uso.');
  if (km !== null && km < v.km_actual) throw bad(`El kilometraje no puede ser menor al actual (${v.km_actual} km).`);
  if (horas !== null && horas < Number(v.horas_actuales)) throw bad(`Las horas no pueden ser menores a las actuales (${v.horas_actuales} h).`);

  await db.query('INSERT INTO uso_vehiculo (vehiculo_id, km, horas, usuario_id) VALUES (?, ?, ?, ?)', [v.id, km, horas, req.user.id]);
  await db.query('UPDATE vehiculos SET km_actual = COALESCE(?, km_actual), horas_actuales = COALESCE(?, horas_actuales) WHERE id = ?', [km, horas, v.id]);
  res.status(201).json({ ok: true });
}));

router.get('/vehiculos/:id/uso', ver, ah(async (req, res) => {
  const [filas] = await db.query(
    `SELECT s.id, s.km, s.horas, s.creado_en, u.nombre AS usuario FROM uso_vehiculo s LEFT JOIN usuarios u ON u.id = s.usuario_id
      WHERE s.vehiculo_id = ? ORDER BY s.creado_en DESC, s.id DESC LIMIT 30`,
    [req.params.id]
  );
  res.json(filas);
}));

// Eliminar un registro de uso (kilometraje u horas). Pide motivo y queda en el registro.
router.delete('/uso/:id', reg, ah(async (req, res) => {
  const motivo = motivoDe(req.body);
  const [[s]] = await db.query('SELECT id, vehiculo_id, km, horas, creado_en FROM uso_vehiculo WHERE id = ?', [req.params.id]);
  if (!s) throw bad('Registro no encontrado.', 404);
  const v = await obtenerVehiculo(s.vehiculo_id, { permitirBaja: true });
  await db.query('DELETE FROM uso_vehiculo WHERE id = ?', [s.id]);
  // Si era el último, el kilometraje y las horas actuales vuelven al registro anterior (si hay uno)
  if (s.km !== null) {
    const [[a]] = await db.query('SELECT km FROM uso_vehiculo WHERE vehiculo_id = ? AND km IS NOT NULL ORDER BY creado_en DESC, id DESC LIMIT 1', [v.id]);
    if (a && v.km_actual === s.km) await db.query('UPDATE vehiculos SET km_actual = ? WHERE id = ?', [a.km, v.id]);
  }
  if (s.horas !== null) {
    const [[a]] = await db.query('SELECT horas FROM uso_vehiculo WHERE vehiculo_id = ? AND horas IS NOT NULL ORDER BY creado_en DESC, id DESC LIMIT 1', [v.id]);
    if (a && Number(v.horas_actuales) === Number(s.horas)) await db.query('UPDATE vehiculos SET horas_actuales = ? WHERE id = ?', [a.horas, v.id]);
  }
  await registrar({ vehiculo: v, accion: 'eliminar_uso', detalle: `Registro de uso: ${s.km !== null ? s.km + ' km' : ''}${s.km !== null && s.horas !== null ? ' · ' : ''}${s.horas !== null ? s.horas + ' h' : ''} (${String(s.creado_en).slice(0, 10)})`, motivo, usuario: req.user });
  res.json({ ok: true });
}));

// ---------- HU-3.12: daños a la máquina ----------
router.get('/danos', ver, ah(async (req, res) => {
  const estado = req.query.estado === 'atendido' ? 'atendido' : 'pendiente';
  const [filas] = await db.query(
    `SELECT d.id, d.vehiculo_id, v.codigo AS vehiculo, d.descripcion, d.estado, d.creado_en, u.nombre AS usuario
       FROM danos_vehiculo d JOIN vehiculos v ON v.id = d.vehiculo_id LEFT JOIN usuarios u ON u.id = d.usuario_id
      WHERE d.estado = ? ORDER BY d.creado_en DESC`,
    [estado]
  );
  res.json(filas);
}));

router.post('/vehiculos/:id/danos', reg, ah(async (req, res) => {
  const v = await obtenerVehiculo(req.params.id);
  const descripcion = (req.body?.descripcion || '').trim();
  if (!descripcion) throw bad('Describe el daño.');
  const [r] = await db.query('INSERT INTO danos_vehiculo (vehiculo_id, descripcion, usuario_id) VALUES (?, ?, ?)', [v.id, descripcion.slice(0, 255), req.user.id]);
  res.status(201).json({ id: r.insertId });
}));

router.patch('/danos/:id', reg, ah(async (req, res) => {
  const [r] = await db.query("UPDATE danos_vehiculo SET estado = 'atendido', atendido_en = COALESCE(atendido_en, NOW()) WHERE id = ?", [req.params.id]);
  if (!r.affectedRows) throw bad('Reporte no encontrado.', 404);
  res.json({ ok: true });
}));

// ---------- HU-3.5: historial completo del vehículo ----------
router.get('/vehiculos/:id/historial', ver, ah(async (req, res) => {
  await obtenerVehiculo(req.params.id, { permitirBaja: true });
  const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
  const page = Math.max(Number(req.query.page) || 1, 1);
  const id = req.params.id;
  const tipo = ['preventivo', 'correctivo', 'inspeccion', 'danos', 'llantas'].includes(req.query.tipo) ? req.query.tipo : null;

  const union = `
    SELECT CONCAT('m-', m.id) AS ref, m.fecha AS fecha, CAST(m.tipo AS CHAR) AS tipo, m.descripcion AS detalle,
           m.km AS km, m.horas AS horas, CAST(m.estado AS CHAR) AS estado, u.nombre AS usuario
      FROM mantenimientos m LEFT JOIN usuarios u ON u.id = m.usuario_id WHERE m.vehiculo_id = ? AND m.estado <> 'cancelado'
    UNION ALL
    SELECT CONCAT('l-', l.id), l.fecha, 'llantas', CONCAT('Cambio de llanta: ', l.posicion, COALESCE(CONCAT(' · ', l.marca), '')),
           l.km, l.horas, 'realizado', u.nombre
      FROM llantas_cambios l LEFT JOIN usuarios u ON u.id = l.usuario_id WHERE l.vehiculo_id = ?
    UNION ALL
    SELECT CONCAT('d-', d.id), DATE(d.creado_en), 'danos', d.descripcion, NULL, NULL, CAST(d.estado AS CHAR), u.nombre
      FROM danos_vehiculo d LEFT JOIN usuarios u ON u.id = d.usuario_id WHERE d.vehiculo_id = ?`;
  const filtro = tipo ? 'WHERE h.tipo = ?' : '';
  const base = [id, id, id, ...(tipo ? [tipo] : [])];

  const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM (${union}) h ${filtro}`, base);
  const [items] = await db.query(`SELECT h.* FROM (${union}) h ${filtro} ORDER BY h.fecha DESC, h.ref DESC LIMIT ? OFFSET ?`, [...base, limit, (page - 1) * limit]);
  res.json({ total, page, limit, items });
}));

// ---------- Planes: frecuencias y recordatorios (HU-3.4, HU-3.11) ----------
router.get('/recordatorios', ver, ah(async (req, res) => res.json(await listarPlanes())));

router.get('/planes', ver, ah(async (req, res) => {
  res.json(await listarPlanes({ vehiculoId: req.query.vehiculo_id || null, soloActivos: req.query.todos !== '1' }));
}));

// ---------- Catálogo de mantenimientos: se elige de la lista o se crea uno nuevo ----------
const TIPOS_CATALOGO = ['preventivo', 'correctivo', 'inspeccion', 'chequeo', 'danos'];
const tipoDePlan = (t) => (TIPOS_PLAN.includes(t) ? t : 'preventivo');

router.get('/catalogo-mantenimientos', ver, ah(async (req, res) => {
  const q = (req.query.q || '').trim();
  const [filas] = await db.query(
    'SELECT id, nombre, tipo, cada_dias, cada_km, cada_horas FROM catalogo_mantenimientos WHERE nombre LIKE ? ORDER BY (nombre LIKE ?) DESC, nombre LIMIT 30',
    [`%${q}%`, `${q}%`]
  );
  res.json(filas);
}));

router.post('/catalogo-mantenimientos', reg, ah(async (req, res) => {
  const b = req.body || {};
  const nombre = (b.nombre || '').trim();
  const tipo = b.tipo || 'preventivo';
  if (!nombre) throw bad('Escribe el nombre del mantenimiento.');
  if (!TIPOS_CATALOGO.includes(tipo)) throw bad('Tipo no válido.');
  const dias = numero(b.cada_dias, 'La frecuencia en días', { entero: true, positivo: true });
  const km = numero(b.cada_km, 'La frecuencia en km', { entero: true, positivo: true });
  const horas = numero(b.cada_horas, 'La frecuencia en horas', { positivo: true });
  try {
    const [r] = await db.query('INSERT INTO catalogo_mantenimientos (nombre, tipo, cada_dias, cada_km, cada_horas) VALUES (?, ?, ?, ?, ?)', [nombre.slice(0, 80), tipo, dias, km, horas]);
    const [[c]] = await db.query('SELECT id, nombre, tipo, cada_dias, cada_km, cada_horas FROM catalogo_mantenimientos WHERE id = ?', [r.insertId]);
    res.status(201).json(c);
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') throw bad('Ya existe un mantenimiento con ese nombre. Búscalo en la lista y selecciónalo.', 409);
    throw e;
  }
}));

router.post('/planes', reg, ah(async (req, res) => {
  const b = req.body || {};
  const v = await obtenerVehiculo(b.vehiculo_id);
  const nombre = (b.nombre || '').trim();
  const tipo = b.tipo || 'preventivo';
  if (!nombre) throw bad('Escribe el nombre del chequeo o mantenimiento.');
  if (!TIPOS_PLAN.includes(tipo)) throw bad('Tipo no válido.');
  const dias = numero(b.cada_dias, 'La frecuencia en días', { entero: true, positivo: true });
  const km = numero(b.cada_km, 'La frecuencia en km', { entero: true, positivo: true });
  const horas = numero(b.cada_horas, 'La frecuencia en horas', { positivo: true });
  const seRepite = dias !== null || km !== null || horas !== null; // la frecuencia es opcional: sin ella, el mantenimiento solo se registra cuando se hace
  if (b.ultima_fecha && !FECHA.test(b.ultima_fecha)) throw bad('La fecha debe tener formato AAAA-MM-DD.');

  if (b.ultima_fecha) {
    const [[{ futura }]] = await db.query('SELECT ? > CURDATE() AS futura', [b.ultima_fecha]);
    if (futura) throw bad('La última vez que se hizo no puede ser una fecha futura.');
  }
  const [[repetido]] = await db.query('SELECT id FROM planes_mantenimiento WHERE vehiculo_id = ? AND nombre = ? AND activo = 1', [v.id, nombre]);
  if (repetido) throw bad('Este vehículo ya tiene ese mantenimiento. Elimínalo primero si quieres cambiarlo.', 409);

  // Lo que se programa también queda en el catálogo para que otros vehículos lo elijan de la lista.
  await db.query('INSERT IGNORE INTO catalogo_mantenimientos (nombre, tipo, cada_dias, cada_km, cada_horas) VALUES (?, ?, ?, ?, ?)', [nombre.slice(0, 80), tipo, dias, km, horas]);

  // La cuenta empieza hoy (o en la fecha indicada) y con el kilometraje y las horas actuales, salvo que se indique otra base.
  const [r] = await db.query(
    `INSERT INTO planes_mantenimiento (vehiculo_id, nombre, tipo, cada_dias, cada_km, cada_horas, ultima_fecha, ultimo_km, ultimas_horas)
     VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, IF(?, CURDATE(), NULL)), ?, ?)`,
    [v.id, nombre.slice(0, 80), tipo, dias, km, horas, nulo(b.ultima_fecha), seRepite ? 1 : 0,
      km === null ? null : (numero(b.ultimo_km, 'El kilometraje base', { entero: true }) ?? v.km_actual),
      horas === null ? null : (numero(b.ultimas_horas, 'Las horas base') ?? Number(v.horas_actuales))]
  );
  res.status(201).json({ id: r.insertId });
}));

// Quitar un mantenimiento de un vehículo: deja de recordarse y de salir en el calendario. Lo que ya se hizo sigue en el historial.
router.delete('/planes/:id', reg, ah(async (req, res) => {
  const motivo = motivoDe(req.body);
  const [[p]] = await db.query('SELECT id, vehiculo_id, nombre, cada_dias, cada_km, cada_horas FROM planes_mantenimiento WHERE id = ?', [req.params.id]);
  if (!p) throw bad('Mantenimiento no encontrado.', 404);
  const v = await obtenerVehiculo(p.vehiculo_id, { permitirBaja: true });
  await db.query('DELETE FROM planes_mantenimiento WHERE id = ?', [p.id]);
  const frec = [p.cada_dias && `cada ${p.cada_dias} días`, p.cada_km && `cada ${p.cada_km} km`, p.cada_horas && `cada ${p.cada_horas} h`].filter(Boolean).join(', ');
  await registrar({ vehiculo: v, accion: 'eliminar_mantenimiento', detalle: `Mantenimiento «${p.nombre}»${frec ? ' (' + frec + ')' : ''}`, motivo, usuario: req.user });
  res.json({ ok: true });
}));

router.patch('/planes/:id/activo', adm, ah(async (req, res) => {
  const [r] = await db.query('UPDATE planes_mantenimiento SET activo = ? WHERE id = ?', [req.body?.activo ? 1 : 0, req.params.id]);
  if (!r.affectedRows) throw bad('Plan no encontrado.', 404);
  res.json({ ok: true });
}));

// HU-3.11: marcar un chequeo o mantenimiento periódico como realizado (queda en el historial)
router.post('/planes/:id/realizar', reg, ah(async (req, res) => {
  const [[plan]] = await db.query('SELECT * FROM planes_mantenimiento WHERE id = ? AND activo = 1', [req.params.id]);
  if (!plan) throw bad('Plan no encontrado.', 404);
  const v = await obtenerVehiculo(plan.vehiculo_id);
  const b = req.body || {};
  const km = numero(b.km, 'El kilometraje', { entero: true });
  const horas = numero(b.horas, 'Las horas de uso');
  if (km !== null && km < v.km_actual) throw bad(`El kilometraje no puede ser menor al actual (${v.km_actual} km).`);
  if (horas !== null && horas < Number(v.horas_actuales)) throw bad(`Las horas no pueden ser menores a las actuales (${v.horas_actuales} h).`);

  const nota = nulo((b.notas || '').trim());
  // La cuenta del recordatorio vuelve a empezar desde la fecha en que se hizo (hoy, o una fecha anterior si se informa tarde).
  const hecho = nulo(b.fecha);
  if (hecho) {
    if (!FECHA.test(hecho)) throw bad('La fecha debe tener formato AAAA-MM-DD.');
    const [[{ futura }]] = await db.query('SELECT ? > CURDATE() AS futura', [hecho]);
    if (futura) throw bad('La fecha en que se hizo no puede ser futura.');
  }
  const [r] = await db.query(
    `INSERT INTO mantenimientos (vehiculo_id, tipo, descripcion, fecha, km, horas, estado, plan_id, usuario_id)
     VALUES (?, ?, ?, COALESCE(?, CURDATE()), ?, ?, 'realizado', ?, ?)`,
    [v.id, plan.tipo === 'preventivo' ? 'preventivo' : 'inspeccion', `${plan.nombre}${nota ? ' · ' + nota : ''}`.slice(0, 255), hecho, km, horas, plan.id, req.user.id]
  );
  const [[m]] = await db.query('SELECT id, vehiculo_id, fecha, km, horas, plan_id FROM mantenimientos WHERE id = ?', [r.insertId]);
  await aplicarRealizado({ ...m, km: m.km === null ? null : Number(m.km), horas: m.horas === null ? null : Number(m.horas) });
  res.status(201).json({ id: r.insertId });
}));

module.exports = router;
