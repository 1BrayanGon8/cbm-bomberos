const db = require('../config/db');
const { listarFlota } = require('./flota');
const { estadoUnidad, generarAlertas } = require('./alertas');
const { SELECT, mapear } = require('./emergencias');
const { turnoActivo, cicloActual } = require('./sesion');

// Resumen de cómo está la estación: unidades, equipos y daños reportados, préstamos, emergencias y novedades.
// Si se pasan novedadesIds, solo se incluyen esas (así la entrega y el resumen coinciden exactamente).
async function construirResumen({ novedadesIds = null } = {}) {
  const flota = await listarFlota();
  const unidades = flota.map((v) => ({
    codigo: v.codigo,
    nombre: v.nombre,
    estado: estadoUnidad(v),
    aviso: v.proximo && v.proximo.estado !== 'ok' ? `${v.proximo.nombre}: ${v.proximo.texto}` : null,
  }));

  const [equipos] = await db.query(
    `SELECT r.tipo, r.descripcion, e.codigo, e.nombre, COALESCE(v.codigo, 'Almacén') AS ubicacion
       FROM reportes_equipo r JOIN equipos e ON e.id = r.equipo_id LEFT JOIN vehiculos v ON v.id = e.vehiculo_id
      WHERE r.estado = 'pendiente' ORDER BY r.creado_en`
  );
  const [danos] = await db.query(
    `SELECT v.codigo AS vehiculo, d.descripcion FROM danos_vehiculo d JOIN vehiculos v ON v.id = d.vehiculo_id
      WHERE d.estado = 'pendiente' AND v.estado <> 'baja' ORDER BY d.creado_en`
  );
  const [prestamos] = await db.query(
    `SELECT COALESCE(e.codigo, v.codigo) AS codigo, COALESCE(e.nombre, v.nombre) AS nombre, p.cantidad, p.vehiculo_id IS NOT NULL AS es_vehiculo,
            p.persona_nombre, p.persona_telefono, p.fecha_limite, (p.fecha_limite < NOW()) AS vencido
       FROM prestamos p LEFT JOIN equipos e ON e.id = p.equipo_id LEFT JOIN vehiculos v ON v.id = p.vehiculo_id
      WHERE p.estado = 'activo' ORDER BY p.fecha_limite`
  );
  const [abiertas] = await db.query(`${SELECT} WHERE e.estado = 'abierta' ORDER BY e.fecha_salida`);

  let novedades = [];
  const base = 'SELECT n.id, n.descripcion, n.creado_en, u.nombre AS autor FROM novedades n LEFT JOIN usuarios u ON u.id = n.usuario_id';
  if (novedadesIds === null) [novedades] = await db.query(`${base} WHERE n.entrega_id IS NULL ORDER BY n.creado_en`);
  else if (novedadesIds.length) [novedades] = await db.query(`${base} WHERE n.id IN (?) ORDER BY n.creado_en`, [novedadesIds]);

  // Personal del turno: integrantes fijos y refuerzos (horas extras) del ciclo actual
  const turno = await turnoActivo();
  let personal = [];
  if (turno) {
    const [fijos] = await db.query(
      "SELECT u.nombre, u.situacion FROM usuarios u WHERE u.turno_id = ? AND u.estado = 'activo' ORDER BY u.nombre", [turno.id]
    );
    const [extras] = await db.query(
      `SELECT u.nombre, u.situacion, f.horas FROM turno_refuerzos f JOIN usuarios u ON u.id = f.usuario_id
        WHERE f.turno_id = ? AND f.fecha = ? AND u.estado = 'activo' ORDER BY u.nombre`,
      [turno.id, await cicloActual()]
    );
    personal = [
      ...fijos.map((p) => ({ nombre: p.nombre, tipo: 'fijo', en_turno: p.situacion === 'en_turno' })),
      ...extras.map((p) => ({ nombre: p.nombre, tipo: 'refuerzo', horas: p.horas === null ? null : Number(p.horas), en_turno: p.situacion === 'en_turno' })),
    ];
  }

  const alertas = await generarAlertas();
  return {
    personal,
    unidades,
    equipos_reportados: equipos,
    danos_vehiculos: danos,
    prestamos: prestamos.map((p) => ({ ...p, vencido: !!p.vencido })),
    emergencias: abiertas.map(mapear).map((e) => ({ codigo: e.codigo, tipo: e.tipo, ubicacion: e.ubicacion, unidades: e.unidades })),
    novedades,
    alertas_urgentes: alertas.filter((a) => a.severidad === 'critica').length,
  };
}

module.exports = { construirResumen };
