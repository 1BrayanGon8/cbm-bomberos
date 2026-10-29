const router = require('express').Router();
const db = require('../config/db');
const { NIVELES } = require('../config/permisos');
const { ah, autenticar, requierePermiso } = require('../middleware/auth');
const { cargarPermisos, turnoActivo, turnoSiguiente } = require('../services/sesion');
const { construirResumen } = require('../services/entregas');
const { FECHA, bad, nulo } = require('../services/validar');

router.use(autenticar);
const ver = requierePermiso('entregas', 'consulta');
const reg = requierePermiso('entregas', 'registro');

const LISTA = `SELECT t.id, t.turno_id, t.turno_nombre AS turno, t.estado, t.fecha_entrega, t.fecha_recepcion,
    t.entrega_por, t.recibe_por, ue.nombre AS entrega, ur.nombre AS recibe, t.observaciones
  FROM entregas_turno t JOIN usuarios ue ON ue.id = t.entrega_por JOIN usuarios ur ON ur.id = t.recibe_por`;

async function usuarioActivo(id) {
  const [[u]] = await db.query("SELECT id FROM usuarios WHERE id = ? AND estado = 'activo'", [id || 0]);
  if (!u) throw bad('Elige una persona activa de la estación.');
  return u.id;
}

router.get('/opciones', ver, ah(async (req, res) => {
  const [usuarios] = await db.query(
    "SELECT u.id, u.nombre, u.turno_id, t.nombre AS turno FROM usuarios u LEFT JOIN turnos t ON t.id = u.turno_id WHERE u.estado = 'activo' ORDER BY u.nombre"
  );
  const [turnos] = await db.query('SELECT id, nombre FROM turnos ORDER BY id');
  const activo = await turnoActivo();
  res.json({ usuarios, turnos, turno_activo: activo, turno_siguiente: activo ? await turnoSiguiente(activo.id) : null });
}));

// HU-8.1: así quedaría la entrega si se envía ahora
router.get('/preview', ver, ah(async (req, res) => res.json(await construirResumen())));

// ---------- HU-8.2: novedades durante el turno ----------
router.get('/novedades', ver, ah(async (req, res) => {
  const [filas] = await db.query(
    `SELECT n.id, n.descripcion, n.creado_en, u.nombre AS autor, t.nombre AS turno
       FROM novedades n LEFT JOIN usuarios u ON u.id = n.usuario_id LEFT JOIN turnos t ON t.id = n.turno_id
      WHERE n.entrega_id IS NULL ORDER BY n.creado_en DESC LIMIT 100`
  );
  res.json(filas);
}));

router.post('/novedades', reg, ah(async (req, res) => {
  const descripcion = (req.body?.descripcion || '').trim();
  if (!descripcion) throw bad('Escribe la novedad.');
  const turno = await turnoActivo();
  const [r] = await db.query('INSERT INTO novedades (descripcion, turno_id, usuario_id) VALUES (?, ?, ?)',
    [descripcion.slice(0, 500), turno ? turno.id : null, req.user.id]);
  res.status(201).json({ id: r.insertId });
}));

// ---------- HU-8.3: historial de entregas (filtro por fecha, turno y estado) ----------
router.get('/', ver, ah(async (req, res) => {
  const filtros = [];
  const valores = [];
  if (FECHA.test(req.query.desde || '')) { filtros.push('DATE(t.fecha_entrega) >= ?'); valores.push(req.query.desde); }
  if (FECHA.test(req.query.hasta || '')) { filtros.push('DATE(t.fecha_entrega) <= ?'); valores.push(req.query.hasta); }
  if (req.query.turno_id) { filtros.push('t.turno_id = ?'); valores.push(req.query.turno_id); }
  if (['pendiente', 'recibida'].includes(req.query.estado)) { filtros.push('t.estado = ?'); valores.push(req.query.estado); }
  if (req.query.para_mi === '1') { filtros.push("t.recibe_por = ? AND t.estado = 'pendiente'"); valores.push(req.user.id); }
  const donde = filtros.length ? `WHERE ${filtros.join(' AND ')}` : '';
  const [filas] = await db.query(`${LISTA} ${donde} ORDER BY t.fecha_entrega DESC LIMIT 100`, valores);
  res.json(filas);
}));

router.get('/:id', ver, ah(async (req, res) => {
  const [[t]] = await db.query(
    `SELECT t.id, t.turno_id, t.turno_nombre AS turno, t.estado, t.fecha_entrega, t.fecha_recepcion, t.entrega_por, t.recibe_por,
            ue.nombre AS entrega, ur.nombre AS recibe, uc.nombre AS recibido_por, t.observaciones, t.notas_recepcion, t.resumen
       FROM entregas_turno t JOIN usuarios ue ON ue.id = t.entrega_por JOIN usuarios ur ON ur.id = t.recibe_por
       LEFT JOIN usuarios uc ON uc.id = t.recibido_por WHERE t.id = ?`,
    [req.params.id]
  );
  if (!t) throw bad('Entrega no encontrada.', 404);
  res.json({ ...t, resumen: JSON.parse(t.resumen) });
}));

// HU-8.1: entregar el turno. Queda con hora y firma de quien entrega (la sesión) y, al recibirla, de quien recibe.
router.post('/', reg, ah(async (req, res) => {
  const recibe = await usuarioActivo(req.body?.recibe_por);
  if (recibe === req.user.id) throw bad('Quien recibe el turno debe ser otra persona.');
  const turno = await turnoActivo();
  const observaciones = nulo((req.body?.observaciones || '').trim().slice(0, 500));

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [pendientes] = await conn.query('SELECT id FROM novedades WHERE entrega_id IS NULL FOR UPDATE');
    const ids = pendientes.map((n) => n.id);
    const resumen = await construirResumen({ novedadesIds: ids });
    const [r] = await conn.query(
      `INSERT INTO entregas_turno (turno_id, turno_nombre, entrega_por, recibe_por, fecha_entrega, observaciones, resumen)
       VALUES (?, ?, ?, ?, NOW(), ?, ?)`,
      [turno ? turno.id : null, turno ? turno.nombre : null, req.user.id, recibe, observaciones, JSON.stringify(resumen)]
    );
    if (ids.length) await conn.query('UPDATE novedades SET entrega_id = ? WHERE id IN (?)', [r.insertId, ids]);
    await conn.commit();
    res.status(201).json({ id: r.insertId });
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}));

// Quien recibe confirma desde su propia sesión (un administrativo puede confirmar en su nombre).
router.patch('/:id/recibir', reg, ah(async (req, res) => {
  const [[t]] = await db.query('SELECT id, estado, recibe_por FROM entregas_turno WHERE id = ?', [req.params.id]);
  if (!t) throw bad('Entrega no encontrada.', 404);
  if (t.estado !== 'pendiente') throw bad('Esta entrega ya fue recibida.', 409);
  if (t.recibe_por !== req.user.id) {
    const permisos = await cargarPermisos(req.user.rolId);
    if (NIVELES.indexOf(permisos.entregas || 'ninguno') < NIVELES.indexOf('total')) {
      throw bad('Solo la persona que recibe el turno (o un administrativo) puede confirmarlo.', 403);
    }
  }
  await db.query(
    "UPDATE entregas_turno SET estado = 'recibida', fecha_recepcion = NOW(), recibido_por = ?, notas_recepcion = ? WHERE id = ?",
    [req.user.id, nulo((req.body?.notas || '').trim().slice(0, 500)), t.id]
  );
  // Al recibir, empieza el turno de quien recibe: pasa a ser el turno activo de la estación.
  const [[quien]] = await db.query('SELECT turno_id FROM usuarios WHERE id = ?', [t.recibe_por]);
  if (quien && quien.turno_id) {
    await db.query('UPDATE turnos SET activo = 0');
    await db.query('UPDATE turnos SET activo = 1 WHERE id = ?', [quien.turno_id]);
  }
  res.json({ ok: true, turno_activo: await turnoActivo() });
}));

module.exports = router;
