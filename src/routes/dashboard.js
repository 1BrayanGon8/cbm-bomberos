const router = require('express').Router();
const db = require('../config/db');
const { ah, autenticar, requierePermiso } = require('../middleware/auth');
const { listarFlota } = require('../services/flota');
const { generarAlertas, estadoUnidad } = require('../services/alertas');
const { SELECT, mapear } = require('../services/emergencias');

router.use(autenticar);

// HU-4.3, 4.4 y 4.5: todo lo que muestra el centro de operaciones en una sola consulta
router.get('/', requierePermiso('dashboard', 'consulta'), ah(async (req, res) => {
  const [flota, alertas] = await Promise.all([listarFlota(), generarAlertas()]);
  const unidades = flota.map((v) => ({ id: v.id, codigo: v.codigo, nombre: v.nombre, estado: estadoUnidad(v) }));

  const [[em]] = await db.query(
    `SELECT COALESCE(SUM(fecha_salida >= DATE_FORMAT(CURDATE(), '%Y-%m-01')), 0) AS mes,
            COALESCE(SUM(fecha_salida >= DATE_SUB(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL 1 MONTH)
                         AND fecha_salida < DATE_FORMAT(CURDATE(), '%Y-%m-01')), 0) AS anterior,
            MONTH(DATE_SUB(CURDATE(), INTERVAL 1 MONTH)) AS mes_anterior
       FROM emergencias`
  );
  const mes = Number(em.mes);
  const anterior = Number(em.anterior);
  const [[des]] = await db.query(
    "SELECT COUNT(*) AS activos, COALESCE(SUM(urgencia = 'alta'), 0) AS alta FROM desaparecidos WHERE estado = 'activo'"
  );
  const [[rep]] = await db.query(
    "SELECT COALESCE(SUM(estado = 'nuevo'), 0) AS nuevos, COALESCE(SUM(estado <> 'resuelto'), 0) AS abiertos FROM reportes_desaparecido"
  );
  const [abiertas] = await db.query(`${SELECT} WHERE e.estado = 'abierta' ORDER BY e.fecha_salida DESC`);

  res.json({
    tarjetas: {
      operativos: unidades.filter((u) => u.estado !== 'fuera_de_servicio').length,
      total_unidades: unidades.length,
      en_mantenimiento: flota.filter((v) => v.estado === 'en_mantenimiento').length,
      alertas_activas: alertas.length,
      alertas_urgentes: alertas.filter((a) => a.severidad === 'critica').length,
      emergencias_mes: mes,
      emergencias_mes_anterior: anterior,
      variacion_pct: anterior > 0 ? Math.round(((mes - anterior) / anterior) * 100) : null,
      mes_anterior: Number(em.mes_anterior),
      desaparecidos_activos: Number(des.activos),
      desaparecidos_alta: Number(des.alta),
      reportes_nuevos: Number(rep.nuevos),
      reportes_abiertos: Number(rep.abiertos),
    },
    unidades,
    alertas: alertas.slice(0, 50),
    emergencias_abiertas: abiertas.map(mapear),
  });
}));

module.exports = router;
