const router = require('express').Router();
const db = require('../config/db');
const { ah, autenticar, requierePermiso } = require('../middleware/auth');
const { diasPorVencer } = require('../services/inventario');

router.use(autenticar);

// Unidades con su cantidad de equipos y alertas, más el almacén.
router.get('/', requierePermiso('inventarios', 'consulta'), ah(async (req, res) => {
  const dias = await diasPorVencer();
  const conteos = `COALESCE(SUM(e.cantidad), 0) AS equipos,
      COUNT(e.id) AS tipos,
      COALESCE(SUM(e.fecha_clave < CURDATE()), 0) AS vencidos,
      COALESCE(SUM(e.fecha_clave >= CURDATE() AND e.fecha_clave <= DATE_ADD(CURDATE(), INTERVAL ? DAY)), 0) AS por_vencer`;
  const [vehiculos] = await db.query(
    `SELECT v.id, v.codigo, v.nombre, v.tipo, v.estado, ${conteos},
            (SELECT COALESCE(SUM(p.cantidad), 0) FROM prestamos p JOIN equipos e2 ON e2.id = p.equipo_id WHERE e2.vehiculo_id = v.id AND p.estado = 'activo') AS prestadas
       FROM vehiculos v LEFT JOIN equipos e ON e.vehiculo_id = v.id AND e.estado <> 'baja'
      WHERE v.activo = 1 GROUP BY v.id ORDER BY v.codigo`,
    [dias]
  );
  const [[almacen]] = await db.query(
    `SELECT ${conteos},
            (SELECT COALESCE(SUM(p.cantidad), 0) FROM prestamos p JOIN equipos e2 ON e2.id = p.equipo_id WHERE e2.vehiculo_id IS NULL AND p.estado = 'activo') AS prestadas
       FROM equipos e WHERE e.vehiculo_id IS NULL AND e.estado <> 'baja'`, [dias]
  );
  const num = (o) => ({ ...o, equipos: Number(o.equipos), tipos: Number(o.tipos), vencidos: Number(o.vencidos), por_vencer: Number(o.por_vencer), prestadas: Number(o.prestadas) });
  res.json({ vehiculos: vehiculos.map(num), almacen: num(almacen) });
}));

module.exports = router;
