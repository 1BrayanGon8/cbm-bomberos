const db = require('../config/db');

async function cargarAjustes() {
  const [filas] = await db.query("SELECT clave, valor FROM ajustes WHERE clave IN ('aviso_dias', 'aviso_km', 'aviso_horas')");
  const m = Object.fromEntries(filas.map((f) => [f.clave, Number(f.valor)]));
  return { aviso_dias: m.aviso_dias ?? 15, aviso_km: m.aviso_km ?? 500, aviso_horas: m.aviso_horas ?? 25 };
}

// Lo que falta para cada frecuencia: días, km u horas (negativo si ya se pasó).
const COLUMNAS_PLAN = `p.id, p.vehiculo_id, v.codigo AS vehiculo, p.nombre, p.tipo, p.cada_dias, p.cada_km, p.cada_horas,
  p.ultima_fecha, p.ultimo_km, p.ultimas_horas, p.activo,
  DATEDIFF(DATE_ADD(p.ultima_fecha, INTERVAL p.cada_dias DAY), CURDATE()) AS restante_dias,
  (p.ultimo_km + p.cada_km) - v.km_actual AS restante_km,
  (p.ultimas_horas + p.cada_horas) - v.horas_actuales AS restante_horas`;

const SIN_URGENCIA = 1e9;

// HU-3.4: estado de un plan (ok, proximo, vencido) y texto como "en 430 km".
function evaluarPlan(p, aj) {
  const criterios = [
    ['dias', p.restante_dias, aj.aviso_dias, 'días'],
    ['km', p.restante_km, aj.aviso_km, 'km'],
    ['horas', p.restante_horas, aj.aviso_horas, 'horas de uso'],
  ]
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([clave, v, umbral, unidad]) => ({ clave, valor: Number(v), umbral, unidad }));
  if (!criterios.length) return { estado: 'ok', texto: 'No se repite', urgencia: SIN_URGENCIA };

  const urgente = criterios.reduce((a, b) => (a.valor / a.umbral <= b.valor / b.umbral ? a : b));
  const estado = criterios.some((c) => c.valor <= 0) ? 'vencido' : criterios.some((c) => c.valor <= c.umbral) ? 'proximo' : 'ok';
  const v = Math.round(urgente.valor * 10) / 10;
  const texto = v < 0 ? `vencido hace ${-v} ${urgente.unidad}` : v === 0 ? 'vence ahora' : `en ${v} ${urgente.unidad}`;
  return { estado, texto, urgencia: urgente.valor / urgente.umbral };
}

const porUrgencia = (a, b) => a.urgencia - b.urgencia;

async function listarPlanes({ vehiculoId = null, soloActivos = true } = {}) {
  const aj = await cargarAjustes();
  const filtros = ["v.estado <> 'baja'"];
  const valores = [];
  if (soloActivos) filtros.push('p.activo = 1');
  if (vehiculoId) { filtros.push('p.vehiculo_id = ?'); valores.push(vehiculoId); }
  const [planes] = await db.query(
    `SELECT ${COLUMNAS_PLAN} FROM planes_mantenimiento p JOIN vehiculos v ON v.id = p.vehiculo_id WHERE ${filtros.join(' AND ')}`,
    valores
  );
  return planes.map((p) => ({ ...p, ...evaluarPlan(p, aj) })).sort(porUrgencia);
}

// HU-3.3: estado de alistamiento (Lista, Atención, Fuera de servicio) y próximo recordatorio por vehículo.
async function listarFlota({ incluirBajas = false } = {}) {
  const [vehiculos] = await db.query(
    `SELECT v.id, v.codigo, v.nombre, v.placa, v.tipo, v.estado, v.km_actual, v.horas_actuales,
            (SELECT COUNT(*) FROM danos_vehiculo d WHERE d.vehiculo_id = v.id AND d.estado = 'pendiente') AS danos_pendientes
       FROM vehiculos v ${incluirBajas ? '' : "WHERE v.estado <> 'baja'"} ORDER BY v.codigo`
  );
  const planes = await listarPlanes();
  const porVehiculo = {};
  for (const p of planes) (porVehiculo[p.vehiculo_id] ||= []).push(p);

  return vehiculos.map((v) => {
    const ps = porVehiculo[v.id] || [];
    const hayAviso = ps.some((p) => p.estado !== 'ok') || Number(v.danos_pendientes) > 0;
    const alistamiento = ['en_mantenimiento', 'baja', 'prestado', 'inactivo_temporal'].includes(v.estado) ? 'fuera_de_servicio' : hayAviso ? 'atencion' : 'lista';
    const prox = ps[0];
    return {
      ...v,
      km_actual: Number(v.km_actual),
      horas_actuales: Number(v.horas_actuales),
      danos_pendientes: Number(v.danos_pendientes),
      alistamiento,
      proximo: prox ? { plan_id: prox.id, nombre: prox.nombre, estado: prox.estado, texto: prox.texto } : null,
    };
  });
}

// Cuando un mantenimiento queda realizado: actualiza km y horas del vehículo y el plan al que pertenece.
async function aplicarRealizado(m) {
  if (m.km !== null || m.horas !== null) {
    await db.query(
      'UPDATE vehiculos SET km_actual = GREATEST(km_actual, COALESCE(?, km_actual)), horas_actuales = GREATEST(horas_actuales, COALESCE(?, horas_actuales)) WHERE id = ?',
      [m.km, m.horas, m.vehiculo_id]
    );
  }
  if (m.plan_id) {
    const [[v]] = await db.query('SELECT km_actual, horas_actuales FROM vehiculos WHERE id = ?', [m.vehiculo_id]);
    await db.query(
      'UPDATE planes_mantenimiento SET ultima_fecha = LEAST(?, CURDATE()), ultimo_km = COALESCE(?, ?), ultimas_horas = COALESCE(?, ?) WHERE id = ?',
      [m.fecha, m.km, v.km_actual, m.horas, v.horas_actuales, m.plan_id]
    );
  }
}

module.exports = { cargarAjustes, evaluarPlan, listarPlanes, listarFlota, aplicarRealizado };
