const router = require('express').Router();
const db = require('../config/db');
const { ah, autenticar, requierePermiso } = require('../middleware/auth');
const { bad, nulo } = require('../services/validar');

router.use(autenticar);
const ver = requierePermiso('prestamos', 'consulta');
const reg = requierePermiso('prestamos', 'registro');

const TELEFONO = /^[0-9+\s()-]{6,30}$/;
const ESTADO_EQUIPO = { en_uso: 'En uso', en_mantenimiento: 'En mantenimiento', baja: 'Dado de baja' };
const ESTADO_VEH = { en_uso: 'En servicio', en_mantenimiento: 'En mantenimiento', baja: 'Dado de baja', prestado: 'Ya está prestado', inactivo_temporal: 'Temporalmente inactivo' };

// Un préstamo es de un elemento (con cantidad) o de un vehículo completo (con todo lo que lleva adentro).
const SELECT = `SELECT p.id, p.equipo_id, p.vehiculo_id, p.cantidad, p.incluye_unidades,
    IF(p.vehiculo_id IS NULL, 'elemento', 'vehiculo') AS tipo,
    COALESCE(e.codigo, v.codigo) AS codigo, COALESCE(e.nombre, v.nombre) AS equipo,
    p.persona_nombre, p.persona_telefono, p.persona_direccion,
    up.nombre AS prestado_por, p.fecha_prestamo, p.fecha_limite, p.notas, p.estado, p.fecha_devolucion,
    p.condicion_devolucion, p.notas_devolucion, p.cant_buena, p.cant_danada, p.cant_perdida, ur.nombre AS recibido_por,
    (p.estado = 'activo' AND p.fecha_limite < NOW()) AS vencido,
    TIMESTAMPDIFF(MINUTE, NOW(), p.fecha_limite) AS minutos_restantes
  FROM prestamos p LEFT JOIN equipos e ON e.id = p.equipo_id LEFT JOIN vehiculos v ON v.id = p.vehiculo_id
  LEFT JOIN usuarios up ON up.id = p.prestado_por LEFT JOIN usuarios ur ON ur.id = p.recibido_por`;

const mapear = (p) => ({ ...p, vencido: !!p.vencido, minutos_restantes: Number(p.minutos_restantes) });

async function usuarioActivo(id) {
  const [[u]] = await db.query("SELECT id FROM usuarios WHERE id = ? AND estado = 'activo'", [id]);
  if (!u) throw bad('Elige una persona activa de la estación.');
  return u.id;
}

router.get('/opciones', ver, ah(async (req, res) => {
  const [usuarios] = await db.query("SELECT id, nombre FROM usuarios WHERE estado = 'activo' ORDER BY nombre");
  res.json({ usuarios });
}));

// Lista desplegable con búsqueda por nombre: elementos con unidades disponibles y vehículos que se pueden prestar.
router.get('/disponibles', ver, ah(async (req, res) => {
  const q = `%${(req.query.q || '').trim()}%`;
  const [elementos] = await db.query(
    `SELECT e.id, e.nombre, e.cantidad AS disponible, c.nombre AS categoria, COALESCE(v.nombre, 'Almacén') AS ubicacion, e.area
       FROM equipos e JOIN categorias c ON c.id = e.categoria_id LEFT JOIN vehiculos v ON v.id = e.vehiculo_id
      WHERE e.estado = 'activo' AND e.cantidad > 0 AND (v.id IS NULL OR v.estado <> 'prestado')
        AND (e.fecha_clave IS NULL OR e.fecha_clave >= CURDATE())
        AND (e.nombre LIKE ? OR e.codigo LIKE ? OR c.nombre LIKE ? OR e.descripcion LIKE ?)
      ORDER BY e.nombre, v.nombre LIMIT 40`,
    [q, q, q, q]
  );
  const [vehiculos] = await db.query(
    `SELECT v.id, v.codigo, v.nombre, v.tipo, v.placa,
            (SELECT COALESCE(SUM(e.cantidad), 0) FROM equipos e WHERE e.vehiculo_id = v.id AND e.estado <> 'baja') AS unidades,
            (SELECT COUNT(*) FROM equipos e WHERE e.vehiculo_id = v.id AND e.estado <> 'baja' AND e.cantidad > 0) AS elementos
       FROM vehiculos v WHERE v.estado = 'activo' AND v.activo = 1 AND (v.nombre LIKE ? OR v.codigo LIKE ? OR v.placa LIKE ?)
      ORDER BY v.codigo`,
    [q, q, q]
  );
  res.json({
    elementos: elementos.map((e) => ({ ...e, disponible: Number(e.disponible) })),
    vehiculos: vehiculos.map((v) => ({ ...v, unidades: Number(v.unidades), elementos: Number(v.elementos) })),
  });
}));

router.get('/resumen', ver, ah(async (req, res) => {
  const [[r]] = await db.query(
    `SELECT COALESCE(SUM(estado = 'activo'), 0) AS activos,
            COALESCE(SUM(estado = 'activo' AND fecha_limite < NOW()), 0) AS vencidos,
            COALESCE(SUM(estado = 'devuelto' AND fecha_devolucion >= DATE_FORMAT(CURDATE(), '%Y-%m-01')), 0) AS devueltos_mes,
            COALESCE(SUM(IF(estado = 'activo' AND vehiculo_id IS NULL, cantidad, 0)), 0) AS unidades_prestadas,
            COALESCE(SUM(estado = 'activo' AND vehiculo_id IS NOT NULL), 0) AS vehiculos_prestados
       FROM prestamos`
  );
  res.json({ activos: Number(r.activos), vencidos: Number(r.vencidos), devueltos_mes: Number(r.devueltos_mes),
    unidades_prestadas: Number(r.unidades_prestadas), vehiculos_prestados: Number(r.vehiculos_prestados) });
}));

// HU-7.3 y 7.4: préstamos activos, vencidos o devueltos; búsqueda por elemento, vehículo o persona
router.get('/', ver, ah(async (req, res) => {
  const estado = ['activo', 'vencido', 'devuelto', 'todos'].includes(req.query.estado) ? req.query.estado : 'activo';
  const filtros = [];
  const valores = [];
  if (estado === 'activo') filtros.push("p.estado = 'activo'");
  else if (estado === 'vencido') filtros.push("p.estado = 'activo' AND p.fecha_limite < NOW()");
  else if (estado === 'devuelto') filtros.push("p.estado = 'devuelto'");
  if (req.query.q) {
    filtros.push('(e.codigo LIKE ? OR e.nombre LIKE ? OR v.codigo LIKE ? OR v.nombre LIKE ? OR p.persona_nombre LIKE ? OR p.persona_telefono LIKE ?)');
    valores.push(...Array(6).fill(`%${req.query.q}%`));
  }
  if (req.query.equipo_id) { filtros.push('p.equipo_id = ?'); valores.push(req.query.equipo_id); }
  const donde = filtros.length ? `WHERE ${filtros.join(' AND ')}` : '';
  const orden = estado === 'devuelto' ? 'ORDER BY p.fecha_devolucion DESC'
    : estado === 'todos' ? 'ORDER BY p.fecha_prestamo DESC' : 'ORDER BY p.fecha_limite';
  const [filas] = await db.query(`${SELECT} ${donde} ${orden} LIMIT 200`, valores);
  res.json(filas.map(mapear));
}));

// HU-7.1: registrar préstamo.
// Elemento: se descuenta la cantidad del inventario. Vehículo: pasa a "Prestado" con todos los elementos que lleva.
router.post('/', reg, ah(async (req, res) => {
  const b = req.body || {};
  const esVehiculo = b.tipo === 'vehiculo';
  const nombre = (b.persona_nombre || '').trim();
  const telefono = (b.persona_telefono || '').trim();
  const direccion = (b.persona_direccion || '').trim();
  if (esVehiculo ? !b.vehiculo_id : !b.equipo_id) throw bad('Elige en la lista qué se presta.');
  if (!nombre) throw bad('Escribe el nombre de quien recibe.');
  if (!TELEFONO.test(telefono)) throw bad('Escribe un teléfono válido (solo números, +, espacios y guiones).');
  if (!direccion) throw bad('Escribe la dirección de quien recibe.');
  const duracion = Number(b.duracion);
  const unidad = b.unidad === 'horas' ? 'horas' : 'dias';
  if (!Number.isInteger(duracion) || duracion < 1) throw bad('Indica por cuánto tiempo se presta.');
  const minutos = duracion * (unidad === 'horas' ? 60 : 1440);
  if (minutos > 525600) throw bad('Un préstamo no puede durar más de un año.');
  const presto = b.prestado_por ? await usuarioActivo(b.prestado_por) : req.user.id;
  const cantidad = esVehiculo ? 1 : Number(b.cantidad === undefined || b.cantidad === '' ? 1 : b.cantidad);
  if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 9999) throw bad('La cantidad debe ser un número entero de 1 en adelante.');
  const plazo = `${duracion} ${unidad === 'horas' ? 'hora(s)' : 'día(s)'}`;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    let id;
    if (esVehiculo) {
      const [[v]] = await conn.query('SELECT id, codigo, nombre, estado FROM vehiculos WHERE id = ? FOR UPDATE', [b.vehiculo_id]);
      if (!v) throw bad('No encontré ese vehículo.', 404);
      if (v.estado !== 'activo') throw bad(`${v.nombre} no está disponible para préstamo (${ESTADO_VEH[v.estado] || v.estado}).`, 409);
      const [[{ unidades }]] = await conn.query("SELECT COALESCE(SUM(cantidad), 0) AS unidades FROM equipos WHERE vehiculo_id = ? AND estado <> 'baja'", [v.id]);
      const [r] = await conn.query(
        `INSERT INTO prestamos (vehiculo_id, cantidad, incluye_unidades, persona_nombre, persona_telefono, persona_direccion, prestado_por, fecha_prestamo, fecha_limite, notas)
         VALUES (?, 1, ?, ?, ?, ?, ?, NOW(), DATE_ADD(NOW(), INTERVAL ? MINUTE), ?)`,
        [v.id, Number(unidades), nombre.slice(0, 100), telefono, direccion.slice(0, 160), presto, minutos, nulo((b.notas || '').trim().slice(0, 255))]
      );
      id = r.insertId;
      await conn.query("UPDATE vehiculos SET estado = 'prestado' WHERE id = ?", [v.id]);
      await conn.query(
        "INSERT INTO equipo_eventos (equipo_id, tipo, detalle, usuario_id) SELECT id, 'prestamo', ?, ? FROM equipos WHERE vehiculo_id = ? AND estado <> 'baja'",
        [`Salió prestado con ${v.nombre} a ${nombre} por ${plazo}`.slice(0, 255), req.user.id, v.id]
      );
      await conn.query("INSERT INTO inventario_movimientos (vehiculo_id, tipo, cantidad, usuario_id) VALUES (?, 'prestamo', 1, ?)", [v.id, req.user.id]);
    } else {
      const [[e]] = await conn.query('SELECT id, nombre, estado, cantidad, fecha_clave FROM equipos WHERE id = ? FOR UPDATE', [b.equipo_id]);
      if (!e) throw bad('No encontré ese elemento.', 404);
      if (e.estado !== 'activo') throw bad(`El elemento no está disponible para préstamo (${ESTADO_EQUIPO[e.estado] || e.estado}).`, 409);
      if (cantidad > e.cantidad) throw bad(`Solo hay ${e.cantidad} disponible(s) de ${e.nombre}.`, 409);
      const [r] = await conn.query(
        `INSERT INTO prestamos (equipo_id, cantidad, persona_nombre, persona_telefono, persona_direccion, prestado_por, fecha_prestamo, fecha_limite, notas)
         VALUES (?, ?, ?, ?, ?, ?, NOW(), DATE_ADD(NOW(), INTERVAL ? MINUTE), ?)`,
        [e.id, cantidad, nombre.slice(0, 100), telefono, direccion.slice(0, 160), presto, minutos, nulo((b.notas || '').trim().slice(0, 255))]
      );
      id = r.insertId;
      await conn.query('UPDATE equipos SET cantidad = cantidad - ? WHERE id = ?', [cantidad, e.id]);
      await conn.query("INSERT INTO equipo_eventos (equipo_id, tipo, detalle, usuario_id) VALUES (?, 'prestamo', ?, ?)",
        [e.id, `Prestadas ${cantidad} a ${nombre} (${telefono}) por ${plazo}; quedan ${e.cantidad - cantidad}`.slice(0, 255), req.user.id]);
      await conn.query("INSERT INTO inventario_movimientos (equipo_id, tipo, cantidad, usuario_id) VALUES (?, 'prestamo', ?, ?)", [e.id, cantidad, req.user.id]);
    }
    await conn.commit();
    res.status(201).json({ id });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}));

const entero = (v, nombre) => {
  if (v === undefined || v === null || v === '') return 0;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw bad(`${nombre} debe ser un número entero (0 o más).`);
  return n;
};

// HU-7.2: registrar la devolución.
// Elemento: las unidades buenas vuelven al inventario; las dañadas o perdidas no, y generan reporte y alerta.
// Vehículo: si regresa dañado o para revisión queda "Temporalmente inactivo"; si está bien, vuelve a "Activo".
router.patch('/:id/devolver', reg, ah(async (req, res) => {
  const b = req.body || {};
  const notas = nulo((b.notas || '').trim().slice(0, 255));
  const recibe = b.recibido_por ? await usuarioActivo(b.recibido_por) : req.user.id;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[p]] = await conn.query('SELECT id, equipo_id, vehiculo_id, cantidad, estado, persona_nombre FROM prestamos WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!p) throw bad('Préstamo no encontrado.', 404);
    if (p.estado !== 'activo') throw bad('Este préstamo ya fue devuelto.', 409);

    if (p.vehiculo_id) {
      const condicion = ['bueno', 'danado', 'revision'].includes(b.condicion) ? b.condicion : 'bueno';
      if (condicion !== 'bueno' && !notas) throw bad('Cuéntanos qué tiene el vehículo (daño o motivo de la revisión).');
      await conn.query(
        "UPDATE prestamos SET estado = 'devuelto', fecha_devolucion = NOW(), condicion_devolucion = ?, notas_devolucion = ?, recibido_por = ? WHERE id = ?",
        [condicion, notas, recibe, p.id]
      );
      const [[v]] = await conn.query('SELECT id, nombre FROM vehiculos WHERE id = ? FOR UPDATE', [p.vehiculo_id]);
      await conn.query('UPDATE vehiculos SET estado = ? WHERE id = ? AND estado = ?', [condicion === 'bueno' ? 'activo' : 'inactivo_temporal', v.id, 'prestado']);
      if (condicion !== 'bueno') {
        await conn.query('INSERT INTO danos_vehiculo (vehiculo_id, descripcion, usuario_id) VALUES (?, ?, ?)',
          [v.id, `${condicion === 'danado' ? 'Devuelto con daños' : 'Devuelto para revisión'} por ${p.persona_nombre}: ${notas}`.slice(0, 255), req.user.id]);
      }
      await conn.query(
        "INSERT INTO equipo_eventos (equipo_id, tipo, detalle, usuario_id) SELECT id, 'prestamo', ?, ? FROM equipos WHERE vehiculo_id = ? AND estado <> 'baja'",
        [`Regresó con ${v.nombre}${condicion === 'bueno' ? '' : ' (vehículo temporalmente inactivo)'}`, req.user.id, v.id]
      );
      await conn.query("INSERT INTO inventario_movimientos (vehiculo_id, tipo, cantidad, usuario_id) VALUES (?, 'devolucion', 1, ?)", [v.id, req.user.id]);
    } else {
      // Si no llegan los tres números (versión anterior de la pantalla), se usa la condición general
      const trae = ['cant_buena', 'cant_danada', 'cant_perdida'].some((k) => b[k] !== undefined && b[k] !== '');
      let buena; let danada; let perdida;
      if (trae) {
        buena = entero(b.cant_buena, 'Las unidades en buen estado');
        danada = entero(b.cant_danada, 'Las unidades dañadas');
        perdida = entero(b.cant_perdida, 'Las unidades perdidas');
      } else if (b.condicion === 'danado') { buena = 0; danada = p.cantidad; perdida = 0; } else { buena = p.cantidad; danada = 0; perdida = 0; }
      if (buena + danada + perdida !== p.cantidad) throw bad(`Se prestaron ${p.cantidad}: las unidades buenas, dañadas y perdidas deben sumar ${p.cantidad}.`);
      if ((danada || perdida) && !notas) throw bad('Cuéntanos qué pasó con las unidades dañadas o perdidas.');
      const condicion = danada || perdida ? 'danado' : 'bueno';

      await conn.query(
        `UPDATE prestamos SET estado = 'devuelto', fecha_devolucion = NOW(), condicion_devolucion = ?, notas_devolucion = ?, recibido_por = ?,
                cant_buena = ?, cant_danada = ?, cant_perdida = ? WHERE id = ?`,
        [condicion, notas, recibe, buena, danada, perdida, p.id]
      );
      await conn.query("UPDATE equipos SET cantidad = cantidad + ?, estado = IF(estado IN ('en_uso', 'baja'), 'activo', estado) WHERE id = ?", [buena, p.equipo_id]);
      if (danada) {
        await conn.query("INSERT INTO reportes_equipo (equipo_id, tipo, descripcion, usuario_id) VALUES (?, 'danado', ?, ?)",
          [p.equipo_id, `${danada} devuelto(s) con daños por ${p.persona_nombre}: ${notas}`.slice(0, 255), req.user.id]);
        await conn.query("INSERT INTO inventario_movimientos (equipo_id, tipo, cantidad, usuario_id) VALUES (?, 'danado', ?, ?)", [p.equipo_id, danada, req.user.id]);
      }
      if (perdida) {
        await conn.query("INSERT INTO reportes_equipo (equipo_id, tipo, descripcion, usuario_id) VALUES (?, 'perdido', ?, ?)",
          [p.equipo_id, `${perdida} no regresó/regresaron (${p.persona_nombre}): ${notas}`.slice(0, 255), req.user.id]);
        await conn.query("INSERT INTO inventario_movimientos (equipo_id, tipo, cantidad, usuario_id) VALUES (?, 'perdido', ?, ?)", [p.equipo_id, perdida, req.user.id]);
      }
      if (buena) await conn.query("INSERT INTO inventario_movimientos (equipo_id, tipo, cantidad, usuario_id) VALUES (?, 'devolucion', ?, ?)", [p.equipo_id, buena, req.user.id]);
      const partes = [`${buena} en buen estado`, danada ? `${danada} con daños` : '', perdida ? `${perdida} perdida(s)` : ''].filter(Boolean).join(', ');
      await conn.query("INSERT INTO equipo_eventos (equipo_id, tipo, detalle, usuario_id) VALUES (?, 'prestamo', ?, ?)",
        [p.equipo_id, `Devolución de ${p.persona_nombre}: ${partes}`.slice(0, 255), req.user.id]);
    }
    await conn.commit();
    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}));

module.exports = router;
