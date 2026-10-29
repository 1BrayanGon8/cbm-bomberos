const crypto = require('crypto');
const router = require('express').Router();
const db = require('../config/db');
const { NIVELES } = require('../config/permisos');
const { ah, autenticar, requierePermiso } = require('../middleware/auth');
const { cargarPermisos } = require('../services/sesion');
const { diasPorVencer, evaluar } = require('../services/inventario');
const { bad } = require('../services/validar');

router.use(autenticar);

const ESTADOS = ['activo', 'en_uso', 'en_mantenimiento', 'baja'];
// Por qué se quita un elemento del inventario (queda en su hoja de vida).
const MOTIVOS = { danado: 'Daño', perdido: 'Pérdida', vencido: 'Se venció', consumido: 'Se consumió o gastó', obsoleto: 'Desgaste o fuera de uso', trasladado: 'Se trasladó a otro lugar', otro: 'Otro motivo' };
const TIPOS_FECHA = ['vencimiento', 'recarga'];
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

const SELECT = `SELECT e.id, e.codigo, e.nombre, e.categoria_id, c.nombre AS categoria, e.vehiculo_id,
    COALESCE(v.codigo, 'Almacén') AS ubicacion, e.lote_serie, e.tipo_fecha, e.fecha_clave,
    DATEDIFF(e.fecha_clave, CURDATE()) AS dias_restantes, e.responsable_id, ur.nombre AS responsable,
    e.area, e.estado, e.fecha_ingreso, e.cantidad, e.descripcion, e.catalogo_id, v.estado AS vehiculo_estado,
    (SELECT COALESCE(SUM(p.cantidad), 0) FROM prestamos p WHERE p.equipo_id = e.id AND p.estado = 'activo') AS prestadas`;
const FROM = `FROM equipos e JOIN categorias c ON c.id = e.categoria_id
    LEFT JOIN vehiculos v ON v.id = e.vehiculo_id LEFT JOIN usuarios ur ON ur.id = e.responsable_id`;

async function obtener(id) {
  const [[e]] = await db.query(`${SELECT} ${FROM} WHERE e.id = ?`, [id]);
  return e || null;
}

// Cada cambio de cantidad queda como movimiento para la analítica (préstamos, daños, pérdidas, vencidos).
async function registrarMovimiento(equipoId, tipo, cantidad, usuarioId) {
  await db.query('INSERT INTO inventario_movimientos (equipo_id, tipo, cantidad, usuario_id) VALUES (?, ?, ?, ?)', [equipoId, tipo, cantidad, usuarioId]);
}

async function registrarEvento(equipoId, tipo, detalle, usuarioId) {
  await db.query('INSERT INTO equipo_eventos (equipo_id, tipo, detalle, usuario_id) VALUES (?, ?, ?, ?)', [equipoId, tipo, detalle, usuarioId]);
}

const nulo = (v) => (v === '' || v === undefined ? null : v);

// Opciones para los formularios y filtros
router.get('/opciones', requierePermiso('inventarios', 'consulta'), ah(async (req, res) => {
  const [vehiculos] = await db.query('SELECT id, codigo, nombre, tipo FROM vehiculos WHERE activo = 1 ORDER BY codigo');
  const [categorias] = await db.query('SELECT id, nombre FROM categorias ORDER BY nombre');
  const [usuarios] = await db.query("SELECT id, nombre FROM usuarios WHERE estado = 'activo' ORDER BY nombre");
  res.json({ vehiculos, categorias, usuarios, estados: ESTADOS, motivos: MOTIVOS, tipos_fecha: TIPOS_FECHA, dias_por_vencer: await diasPorVencer() });
}));

// HU-2.8: días para que el semáforo pase a amarillo
router.put('/config', requierePermiso('inventarios', 'total'), ah(async (req, res) => {
  const dias = Number(req.body?.dias_por_vencer);
  if (!Number.isInteger(dias) || dias < 1 || dias > 365) return res.status(400).json({ error: 'Escribe un número de días entre 1 y 365.' });
  await db.query("INSERT INTO ajustes (clave, valor) VALUES ('dias_por_vencer', ?) ON DUPLICATE KEY UPDATE valor = VALUES(valor)", [String(dias)]);
  res.json({ dias_por_vencer: dias });
}));

// HU-2.2: listado con búsqueda, filtros y paginación
router.get('/', requierePermiso('inventarios', 'consulta'), ah(async (req, res) => {
  const { q, vehiculo_id, categoria_id, estado, semaforo, incluir_bajas } = req.query;
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
  const page = Math.max(Number(req.query.page) || 1, 1);
  const dias = await diasPorVencer();

  const filtros = [];
  const valores = [];
  if (q) {
    filtros.push('(e.nombre LIKE ? OR e.descripcion LIKE ? OR e.area LIKE ? OR e.lote_serie LIKE ? OR ur.nombre LIKE ? OR e.codigo LIKE ?)');
    valores.push(...Array(6).fill(`%${q}%`));
  }
  if (vehiculo_id === 'almacen') filtros.push('e.vehiculo_id IS NULL');
  else if (vehiculo_id) { filtros.push('e.vehiculo_id = ?'); valores.push(vehiculo_id); }
  if (categoria_id) { filtros.push('e.categoria_id = ?'); valores.push(categoria_id); }
  if (estado) {
    if (!ESTADOS.includes(estado)) return res.status(400).json({ error: 'Estado no válido.' });
    filtros.push('e.estado = ?'); valores.push(estado);
  } else if (incluir_bajas !== '1') filtros.push("e.estado <> 'baja'");
  if (semaforo === 'rojo') filtros.push('e.fecha_clave < CURDATE()');
  else if (semaforo === 'amarillo') { filtros.push('e.fecha_clave >= CURDATE() AND e.fecha_clave <= DATE_ADD(CURDATE(), INTERVAL ? DAY)'); valores.push(dias); }
  else if (semaforo === 'verde') { filtros.push('(e.fecha_clave IS NULL OR e.fecha_clave > DATE_ADD(CURDATE(), INTERVAL ? DAY))'); valores.push(dias); }

  const donde = filtros.length ? `WHERE ${filtros.join(' AND ')}` : '';
  // Por unidad: ordenado por categoría; en general: lo más urgente primero.
  const orden = vehiculo_id ? 'ORDER BY c.nombre, e.area, e.nombre' : 'ORDER BY (e.fecha_clave IS NULL), e.fecha_clave, e.nombre';

  const [[{ total, unidades }]] = await db.query(`SELECT COUNT(*) AS total, COALESCE(SUM(e.cantidad), 0) AS unidades ${FROM} ${donde}`, valores);
  const [filas] = await db.query(`${SELECT} ${FROM} ${donde} ${orden} LIMIT ? OFFSET ?`, [...valores, limit, (page - 1) * limit]);
  const [[{ prestadas }]] = await db.query(`SELECT COALESCE(SUM((SELECT COALESCE(SUM(p.cantidad), 0) FROM prestamos p WHERE p.equipo_id = e.id AND p.estado = 'activo')), 0) AS prestadas ${FROM} ${donde}`, valores);
  res.json({ total, unidades: Number(unidades), prestadas: Number(prestadas), page, limit, equipos: filas.map((e) => ({ ...e, prestadas: Number(e.prestadas), ...evaluar(e, dias) })) });
}));

// HU-4.6: reportar un equipo dañado o perdido (queda en su hoja de vida y genera una alerta en el dashboard)
router.post('/:id/reportes', requierePermiso('inventarios', 'registro'), ah(async (req, res) => {
  const e = await obtener(req.params.id);
  if (!e) return res.status(404).json({ error: 'Equipo no encontrado.' });
  const tipo = req.body?.tipo;
  if (!['danado', 'perdido'].includes(tipo)) return res.status(400).json({ error: 'Indica si el equipo está dañado o perdido.' });
  const descripcion = (req.body?.descripcion || '').trim();
  if (!descripcion) return res.status(400).json({ error: 'Describe lo que pasó.' });

  const [r] = await db.query('INSERT INTO reportes_equipo (equipo_id, tipo, descripcion, usuario_id) VALUES (?, ?, ?, ?)',
    [e.id, tipo, descripcion.slice(0, 255), req.user.id]);
  await registrarEvento(e.id, 'reporte', `${tipo === 'danado' ? 'Reportado como dañado' : 'Reportado como perdido'}: ${descripcion.slice(0, 150)}`, req.user.id);
  res.status(201).json({ id: r.insertId });
}));

router.patch('/reportes/:id', requierePermiso('inventarios', 'registro'), ah(async (req, res) => {
  const [r] = await db.query("UPDATE reportes_equipo SET estado = 'atendido' WHERE id = ?", [req.params.id]);
  if (!r.affectedRows) return res.status(404).json({ error: 'Reporte no encontrado.' });
  res.json({ ok: true });
}));

// HU-2.4: hoja de vida (datos del equipo + historial de eventos)
router.get('/:id', requierePermiso('inventarios', 'consulta'), ah(async (req, res) => {
  const e = await obtener(req.params.id);
  if (!e) return res.status(404).json({ error: 'Equipo no encontrado.' });
  const [eventos] = await db.query(
    `SELECT ev.id, ev.tipo, ev.detalle, ev.creado_en, u.nombre AS usuario
       FROM equipo_eventos ev LEFT JOIN usuarios u ON u.id = ev.usuario_id
      WHERE ev.equipo_id = ? ORDER BY ev.creado_en DESC, ev.id DESC`,
    [e.id]
  );
  res.json({ ...e, prestadas: Number(e.prestadas), ...evaluar(e, await diasPorVencer()), eventos });
}));

// HU-2.1: registrar equipo. Se elige un elemento del catálogo (que ya sabe si lleva fecha y serie) y se pide la cantidad.
// Si ya hay una fila igual en esa ubicación (mismo sitio, serie, fecha y estado), solo se suma la cantidad.
router.post('/', requierePermiso('inventarios', 'registro'), ah(async (req, res) => {
  const b = req.body || {};
  const cantidad = Number(b.cantidad === undefined || b.cantidad === '' ? 1 : b.cantidad);
  if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 9999) throw bad('La cantidad debe ser un número entero entre 1 y 9999.');
  const estado = b.estado || 'activo';
  if (!ESTADOS.includes(estado) || estado === 'baja') throw bad('Estado no válido.');

  // Elemento del catálogo: por id, o (compatibilidad) por nombre, creándolo si no existe
  let cat = null;
  if (b.catalogo_id) {
    [[cat]] = await db.query('SELECT * FROM catalogo_elementos WHERE id = ?', [b.catalogo_id]);
    if (!cat) throw bad('Ese elemento no existe en el catálogo. Búscalo de nuevo o créalo.', 404);
  } else {
    const nombre = (b.nombre || '').trim();
    if (!nombre || !b.categoria_id) throw bad('Elige un elemento de la lista o créalo (nombre y categoría).');
    [[cat]] = await db.query('SELECT * FROM catalogo_elementos WHERE nombre = ?', [nombre]);
    if (!cat) {
      const tipoNuevo = b.tipo_fecha || 'vencimiento';
      if (!TIPOS_FECHA.includes(tipoNuevo)) throw bad('Tipo de fecha no válido.');
      const [c] = await db.query(
        'INSERT INTO catalogo_elementos (nombre, categoria_id, tiene_fecha, tipo_fecha, pide_serie) VALUES (?, ?, ?, ?, ?)',
        [nombre.slice(0, 120), b.categoria_id, nulo(b.fecha_clave) ? 1 : 0, tipoNuevo, nulo((b.lote_serie || '').trim()) ? 1 : 0]
      );
      [[cat]] = await db.query('SELECT * FROM catalogo_elementos WHERE id = ?', [c.insertId]);
    }
  }

  // Lo que el elemento exige
  const fecha = cat.tiene_fecha ? nulo(b.fecha_clave) : null;
  if (cat.tiene_fecha && !fecha) throw bad(`Este elemento lleva fecha de ${cat.tipo_fecha === 'recarga' ? 'recarga' : 'vencimiento'}: escríbela.`);
  if (fecha && !FECHA.test(fecha)) throw bad('La fecha clave debe tener formato AAAA-MM-DD.');
  const serie = cat.pide_serie ? nulo((b.lote_serie || '').trim().slice(0, 60)) : null;
  if (cat.pide_serie && !serie) throw bad('Este elemento lleva serie o lote: escríbelo.');
  const vehiculo = nulo(b.vehiculo_id);
  const area = nulo((b.area || '').trim().slice(0, 60));
  const descripcion = nulo((b.descripcion || '').trim().slice(0, 255));
  const responsable = nulo(b.responsable_id);

  try {
    const [[igual]] = await db.query(
      `SELECT id FROM equipos WHERE catalogo_id = ? AND estado = ? AND vehiculo_id <=> ? AND area <=> ? AND lote_serie <=> ? AND fecha_clave <=> ?
          AND descripcion <=> ? AND responsable_id <=> ? LIMIT 1`,
      [cat.id, estado, vehiculo, area, serie, fecha, descripcion, responsable]
    );
    if (igual) {
      await db.query('UPDATE equipos SET cantidad = cantidad + ? WHERE id = ?', [cantidad, igual.id]);
      const e = await obtener(igual.id);
      await registrarEvento(igual.id, 'cantidad', `Se agregaron ${cantidad} (ahora hay ${e.cantidad}) en ${e.ubicacion}${e.area ? ' (' + e.area + ')' : ''}`, req.user.id);
      await registrarMovimiento(igual.id, 'ingreso', cantidad, req.user.id);
      return res.status(201).json({ id: igual.id, sumado: true, cantidad: e.cantidad });
    }

    const manual = (b.codigo || '').trim();
    const codigo = manual || `TMP-${crypto.randomBytes(6).toString('hex')}`;
    const [r] = await db.query(
      `INSERT INTO equipos (codigo, nombre, categoria_id, vehiculo_id, lote_serie, tipo_fecha, fecha_clave, responsable_id, area, cantidad, estado, descripcion, catalogo_id, fecha_ingreso)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURDATE())`,
      [codigo, cat.nombre, cat.categoria_id, vehiculo, serie, cat.tipo_fecha, fecha, responsable, area, cantidad, estado, descripcion, cat.id]
    );
    if (!manual) await db.query("UPDATE equipos SET codigo = CONCAT('EQ-', LPAD(id, 5, '0')) WHERE id = ?", [r.insertId]);
    const e = await obtener(r.insertId);
    await registrarEvento(r.insertId, 'ingreso', `Ingreso de ${cantidad} a ${e.ubicacion}${e.area ? ' (' + e.area + ')' : ''}`, req.user.id);
    await registrarMovimiento(r.insertId, 'ingreso', cantidad, req.user.id);
    res.status(201).json({ id: r.insertId, sumado: false, cantidad });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ya existe un equipo con ese código.' });
    if (err.code === 'ER_NO_REFERENCED_ROW_2') return res.status(400).json({ error: 'La categoría, el vehículo o el responsable no existe.' });
    throw err;
  }
}));

// Aumentar la cantidad de un elemento que ya existe en el inventario.
router.post('/:id/agregar', requierePermiso('inventarios', 'registro'), ah(async (req, res) => {
  const e = await obtener(req.params.id);
  if (!e) return res.status(404).json({ error: 'Equipo no encontrado.' });
  const n = Number(req.body?.cantidad);
  if (!Number.isInteger(n) || n < 1 || n > 9999) return res.status(400).json({ error: 'Escribe cuántas unidades se agregan (entero, mínimo 1).' });
  const nota = (req.body?.detalle || '').trim();
  const total = e.cantidad + n;
  await db.query("UPDATE equipos SET cantidad = ?, estado = IF(estado = 'baja', 'activo', estado) WHERE id = ?", [total, e.id]);
  await registrarEvento(e.id, 'cantidad', `Se agregaron ${n} (de ${e.cantidad} a ${total})${nota ? ' · ' + nota.slice(0, 120) : ''}`, req.user.id);
  await registrarMovimiento(e.id, 'ingreso', n, req.user.id);
  res.json({ ok: true, cantidad: total });
}));

// Quitar unidades: siempre se reporta el porqué. Si fue daño o pérdida, también genera la alerta del dashboard.
router.post('/:id/quitar', requierePermiso('inventarios', 'registro'), ah(async (req, res) => {
  const e = await obtener(req.params.id);
  if (!e) return res.status(404).json({ error: 'Equipo no encontrado.' });
  const n = Number(req.body?.cantidad);
  if (!Number.isInteger(n) || n < 1) return res.status(400).json({ error: 'Escribe cuántas unidades se quitan (entero, mínimo 1).' });
  if (n > e.cantidad) return res.status(400).json({ error: `Solo hay ${e.cantidad} en el inventario.` });
  const motivo = req.body?.motivo;
  if (!MOTIVOS[motivo]) return res.status(400).json({ error: 'Elige por qué se quita.' });
  const detalle = (req.body?.detalle || '').trim();
  if (!detalle) return res.status(400).json({ error: 'Cuéntanos qué pasó: el porqué es obligatorio al quitar un elemento.' });

  const quedan = e.cantidad - n;
  await db.query("UPDATE equipos SET cantidad = ?, estado = IF(? = 0 AND ? = 0, 'baja', estado) WHERE id = ?", [quedan, quedan, Number(e.prestadas), e.id]);
  await registrarEvento(e.id, 'retiro', `Se quitaron ${n} (quedan ${quedan}) · ${MOTIVOS[motivo]}: ${detalle.slice(0, 140)}`, req.user.id);
  await registrarMovimiento(e.id, ['danado', 'perdido', 'vencido'].includes(motivo) ? motivo : 'otro_retiro', n, req.user.id);
  if (motivo === 'danado' || motivo === 'perdido') {
    await db.query('INSERT INTO reportes_equipo (equipo_id, tipo, descripcion, usuario_id) VALUES (?, ?, ?, ?)', [e.id, motivo, detalle.slice(0, 255), req.user.id]);
  }
  res.json({ ok: true, cantidad: quedan });
}));

// Editar datos del equipo (el responsable y el estado tienen su propia ruta)
router.put('/:id', requierePermiso('inventarios', 'registro'), ah(async (req, res) => {
  const antes = await obtener(req.params.id);
  if (!antes) return res.status(404).json({ error: 'Equipo no encontrado.' });
  const b = req.body || {};
  if (b.tipo_fecha && !TIPOS_FECHA.includes(b.tipo_fecha)) return res.status(400).json({ error: 'Tipo de fecha no válido.' });
  if (b.fecha_clave && !FECHA.test(b.fecha_clave)) return res.status(400).json({ error: 'La fecha clave debe tener formato AAAA-MM-DD.' });

  const sets = [];
  const valores = [];
  for (const campo of ['codigo', 'nombre', 'categoria_id', 'vehiculo_id', 'lote_serie', 'tipo_fecha', 'fecha_clave', 'descripcion', 'area']) {
    if (b[campo] !== undefined) {
      const v = typeof b[campo] === 'string' ? b[campo].trim() : b[campo];
      sets.push(`${campo} = ?`);
      valores.push(nulo(v));
    }
  }
  if (!sets.length) return res.status(400).json({ error: 'No hay cambios para guardar.' });

  try {
    await db.query(`UPDATE equipos SET ${sets.join(', ')} WHERE id = ?`, [...valores, antes.id]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ya existe un equipo con ese código.' });
    if (err.code === 'ER_NO_REFERENCED_ROW_2') return res.status(400).json({ error: 'La categoría o el vehículo no existe.' });
    throw err;
  }
  const despues = await obtener(antes.id);
  if (antes.ubicacion !== despues.ubicacion) await registrarEvento(antes.id, 'traslado', `De ${antes.ubicacion} a ${despues.ubicacion}`, req.user.id);
  if (sets.some((s) => !s.startsWith('vehiculo_id'))) await registrarEvento(antes.id, 'edicion', 'Datos del equipo actualizados', req.user.id);
  res.json({ ok: true });
}));

// HU-2.10: área y responsable de cada herramienta
router.patch('/:id/responsable', requierePermiso('inventarios', 'registro'), ah(async (req, res) => {
  const antes = await obtener(req.params.id);
  if (!antes) return res.status(404).json({ error: 'Equipo no encontrado.' });
  const b = req.body || {};
  if (b.responsable_id === undefined && b.area === undefined) return res.status(400).json({ error: 'Indica el responsable o el área.' });

  const responsable = b.responsable_id === undefined ? antes.responsable_id : nulo(b.responsable_id);
  const area = b.area === undefined ? antes.area : nulo((b.area || '').trim());
  try {
    await db.query('UPDATE equipos SET responsable_id = ?, area = ? WHERE id = ?', [responsable, area, antes.id]);
  } catch (err) {
    if (err.code === 'ER_NO_REFERENCED_ROW_2') return res.status(400).json({ error: 'El responsable no existe.' });
    throw err;
  }
  const despues = await obtener(antes.id);
  await registrarEvento(antes.id, 'responsable',
    `Responsable: ${antes.responsable || '—'} → ${despues.responsable || '—'}; área: ${antes.area || '—'} → ${despues.area || '—'}`, req.user.id);
  res.json({ ok: true });
}));

// HU-2.11: estado del equipo (dar de baja requiere permiso total)
router.patch('/:id/estado', requierePermiso('inventarios', 'registro'), ah(async (req, res) => {
  const { estado, motivo } = req.body || {};
  if (!ESTADOS.includes(estado)) return res.status(400).json({ error: 'Estado no válido.' });
  if (estado === 'baja') {
    const permisos = await cargarPermisos(req.user.rolId);
    if (NIVELES.indexOf(permisos.inventarios || 'ninguno') < NIVELES.indexOf('total')) {
      return res.status(403).json({ error: 'Solo un administrativo puede dar de baja un equipo.' });
    }
  }
  const antes = await obtener(req.params.id);
  if (!antes) return res.status(404).json({ error: 'Equipo no encontrado.' });
  if (antes.estado === estado) return res.status(400).json({ error: 'El equipo ya tiene ese estado.' });

  await db.query('UPDATE equipos SET estado = ? WHERE id = ?', [estado, antes.id]);
  const nota = motivo && motivo.trim() ? ` · ${motivo.trim().slice(0, 120)}` : '';
  await registrarEvento(antes.id, 'estado', `Estado: ${antes.estado} → ${estado}${nota}`, req.user.id);
  res.json({ ok: true });
}));

module.exports = router;
