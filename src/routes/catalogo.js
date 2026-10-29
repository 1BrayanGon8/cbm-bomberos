const router = require('express').Router();
const db = require('../config/db');
const { ah, autenticar, requierePermiso } = require('../middleware/auth');
const { bad } = require('../services/validar');

router.use(autenticar);

const TIPOS_FECHA = ['vencimiento', 'recarga'];

// Busca elementos del catálogo por nombre (también por categoría). Sin texto, devuelve los primeros por orden alfabético.
router.get('/', requierePermiso('inventarios', 'consulta'), ah(async (req, res) => {
  const q = (req.query.q || '').trim();
  const [filas] = await db.query(
    `SELECT c.id, c.nombre, c.categoria_id, cat.nombre AS categoria, c.tiene_fecha, c.tipo_fecha, c.pide_serie, c.descripcion,
            (SELECT COALESCE(SUM(e.cantidad), 0) FROM equipos e WHERE e.catalogo_id = c.id AND e.estado <> 'baja') AS en_inventario
       FROM catalogo_elementos c JOIN categorias cat ON cat.id = c.categoria_id
      WHERE c.nombre LIKE ? OR cat.nombre LIKE ?
      ORDER BY (c.nombre LIKE ?) DESC, c.nombre LIMIT 30`,
    [`%${q}%`, `%${q}%`, `${q}%`]
  );
  res.json(filas.map((f) => ({ ...f, tiene_fecha: !!f.tiene_fecha, pide_serie: !!f.pide_serie, en_inventario: Number(f.en_inventario) })));
}));

// Crear un elemento nuevo: se define una sola vez si lleva fecha (y de qué tipo) y si pide serie o lote.
router.post('/', requierePermiso('inventarios', 'registro'), ah(async (req, res) => {
  const b = req.body || {};
  const nombre = (b.nombre || '').trim();
  if (!nombre) throw bad('Escribe el nombre del elemento.');
  if (!b.categoria_id) throw bad('Elige la categoría del elemento.');
  const tieneFecha = b.tiene_fecha === true || b.tiene_fecha === 1 || b.tiene_fecha === '1' || b.tiene_fecha === 'true';
  const tipo = b.tipo_fecha || 'vencimiento';
  if (!TIPOS_FECHA.includes(tipo)) throw bad('Tipo de fecha no válido.');
  const pideSerie = b.pide_serie === true || b.pide_serie === 1 || b.pide_serie === '1' || b.pide_serie === 'true';
  try {
    const [r] = await db.query(
      'INSERT INTO catalogo_elementos (nombre, categoria_id, tiene_fecha, tipo_fecha, pide_serie, descripcion) VALUES (?, ?, ?, ?, ?, ?)',
      [nombre.slice(0, 120), b.categoria_id, tieneFecha ? 1 : 0, tipo, pideSerie ? 1 : 0, (b.descripcion || '').trim().slice(0, 255) || null]
    );
    const [[c]] = await db.query(
      `SELECT c.id, c.nombre, c.categoria_id, cat.nombre AS categoria, c.tiene_fecha, c.tipo_fecha, c.pide_serie, c.descripcion
         FROM catalogo_elementos c JOIN categorias cat ON cat.id = c.categoria_id WHERE c.id = ?`, [r.insertId]
    );
    res.status(201).json({ ...c, tiene_fecha: !!c.tiene_fecha, pide_serie: !!c.pide_serie, en_inventario: 0 });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') throw bad('Ya existe un elemento con ese nombre. Búscalo en la lista y selecciónalo.', 409);
    if (e.code === 'ER_NO_REFERENCED_ROW_2') throw bad('La categoría no existe.');
    throw e;
  }
}));

module.exports = router;
