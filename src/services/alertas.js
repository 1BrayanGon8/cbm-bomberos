const db = require('../config/db');
const { diasPorVencer } = require('./inventario');
const { listarPlanes } = require('./flota');

const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

function textoFecha(tipoFecha, d) {
  if (tipoFecha === 'recarga') {
    if (d < 0) return `Recarga vencida hace ${plural(-d, 'día', 'días')}`;
    return d === 0 ? 'Recarga hoy' : `Recarga en ${plural(d, 'día', 'días')}`;
  }
  if (d < 0) return `Vencido hace ${plural(-d, 'día', 'días')}`;
  return d === 0 ? 'Vence hoy' : `Vence en ${plural(d, 'día', 'días')}`;
}

const RANGO = { critica: 0, alta: 1, media: 2 };

function tiempoTexto(minutos) {
  const m = Math.abs(minutos);
  if (m < 60) return plural(m, 'minuto', 'minutos');
  if (m < 2880) return plural(Math.round(m / 60), 'hora', 'horas');
  return plural(Math.floor(m / 1440), 'día', 'días');
}

// Alertas automáticas con su acción directa. Las críticas son las que requieren acción inmediata.
async function generarAlertas() {
  const alertas = [];
  const dias = await diasPorVencer();

  // Equipos vencidos o por vencer (los que están en mantenimiento ya se están atendiendo)
  const [equipos] = await db.query(
    `SELECT e.id, e.nombre, e.tipo_fecha, e.vehiculo_id, COALESCE(v.codigo, 'Almacén') AS ubicacion,
            DATEDIFF(e.fecha_clave, CURDATE()) AS dias
       FROM equipos e LEFT JOIN vehiculos v ON v.id = e.vehiculo_id
      WHERE e.estado NOT IN ('baja', 'en_mantenimiento') AND e.fecha_clave IS NOT NULL
        AND e.fecha_clave <= DATE_ADD(CURDATE(), INTERVAL ? DAY)
      ORDER BY e.fecha_clave LIMIT 100`,
    [dias]
  );
  for (const e of equipos) {
    const d = Number(e.dias);
    let severidad = 'alta';
    let accion = { tipo: 'ver_equipo', etiqueta: 'Revisar equipo', equipo_id: e.id };
    if (d < 0) {
      if (e.tipo_fecha === 'recarga') { severidad = 'critica'; accion = { tipo: 'recarga', etiqueta: 'Programar recarga', equipo_id: e.id }; }
      else if (e.vehiculo_id) { severidad = 'critica'; accion = { tipo: 'retirar', etiqueta: 'Retirar de unidad', equipo_id: e.id }; }
      else { severidad = 'media'; accion = { tipo: 'ver_equipo', etiqueta: 'Ver equipo', equipo_id: e.id }; }
    }
    alertas.push({ id: `eq-${e.id}`, severidad, tipo: 'equipo', titulo: `${e.nombre} · ${e.ubicacion}`, detalle: textoFecha(e.tipo_fecha, d), accion, orden: d });
  }

  // Mantenimientos y chequeos próximos o vencidos
  for (const p of await listarPlanes()) {
    if (p.estado === 'ok') continue;
    alertas.push({
      id: `plan-${p.id}`, severidad: p.estado === 'vencido' ? 'critica' : 'alta', tipo: 'mantenimiento',
      titulo: `${p.vehiculo} · ${p.nombre}`, detalle: `${p.estado === 'vencido' ? 'Mantenimiento' : 'Próximo'}: ${p.texto}`,
      accion: { tipo: 'ir', etiqueta: 'Agendar taller', modulo: 'mantenimientos' }, orden: p.urgencia,
    });
  }

  // Daños a vehículos sin atender
  const [danos] = await db.query(
    `SELECT d.id, v.codigo, d.descripcion FROM danos_vehiculo d JOIN vehiculos v ON v.id = d.vehiculo_id
      WHERE d.estado = 'pendiente' AND v.estado <> 'baja' ORDER BY d.creado_en`
  );
  for (const d of danos) {
    alertas.push({ id: `dano-${d.id}`, severidad: 'alta', tipo: 'dano', titulo: `${d.codigo} · Daño reportado`, detalle: d.descripcion,
      accion: { tipo: 'dano_atendido', etiqueta: 'Marcar atendido', id: d.id }, orden: 0 });
  }

  // Equipos reportados como dañados o perdidos (HU-4.6)
  const [reportes] = await db.query(
    `SELECT r.id, r.tipo, r.descripcion, e.nombre, COALESCE(v.codigo, 'Almacén') AS ubicacion
       FROM reportes_equipo r JOIN equipos e ON e.id = r.equipo_id LEFT JOIN vehiculos v ON v.id = e.vehiculo_id
      WHERE r.estado = 'pendiente' ORDER BY r.creado_en`
  );
  for (const r of reportes) {
    alertas.push({ id: `rep-${r.id}`, severidad: r.tipo === 'perdido' ? 'critica' : 'alta', tipo: 'reporte',
      titulo: `${r.nombre} · ${r.ubicacion}`, detalle: `${r.tipo === 'perdido' ? 'Reportado como perdido' : 'Reportado como dañado'}: ${r.descripcion}`,
      accion: { tipo: 'reporte_atendido', etiqueta: 'Marcar atendido', id: r.id }, orden: 0 });
  }

  // Préstamos vencidos sin devolver (HU-7.3)
  const [prestamos] = await db.query(
    `SELECT p.id, p.persona_nombre, p.cantidad, p.vehiculo_id, COALESCE(e.nombre, v.nombre) AS nombre, TIMESTAMPDIFF(MINUTE, p.fecha_limite, NOW()) AS minutos
       FROM prestamos p LEFT JOIN equipos e ON e.id = p.equipo_id LEFT JOIN vehiculos v ON v.id = p.vehiculo_id
      WHERE p.estado = 'activo' AND p.fecha_limite < NOW() ORDER BY p.fecha_limite LIMIT 50`
  );
  for (const p of prestamos) {
    alertas.push({ id: `prest-${p.id}`, severidad: 'critica', tipo: 'prestamo', titulo: `${p.vehiculo_id ? p.nombre + ' (vehículo)' : p.nombre + (p.cantidad > 1 ? ' x' + p.cantidad : '')} · Préstamo vencido`,
      detalle: `${p.persona_nombre} · ${tiempoTexto(Number(p.minutos))} de retraso`,
      accion: { tipo: 'ir', etiqueta: 'Ver préstamos', modulo: 'prestamos' }, orden: -Number(p.minutos) / 1440 });
  }

  // Obstrucciones y accidentes activos en las vías (HU-9.1 y 9.2)
  const [vias] = await db.query(
    `SELECT id, tipo, ubicacion, descripcion, TIMESTAMPDIFF(MINUTE, ocurrido_en, NOW()) AS minutos
       FROM reportes_via WHERE estado = 'activa' ORDER BY ocurrido_en DESC LIMIT 20`
  );
  for (const v of vias) {
    alertas.push({ id: `via-${v.id}`, severidad: v.tipo === 'accidente' ? 'alta' : 'media', tipo: 'via',
      titulo: `${v.tipo === 'accidente' ? 'Accidente' : 'Obstrucción'} · ${v.ubicacion}`,
      detalle: `${v.descripcion} · hace ${tiempoTexto(Number(v.minutos))}`,
      accion: { tipo: 'ir', etiqueta: 'Ver vías', modulo: 'vias' }, orden: 0 });
  }

  // Reportes del público sobre posibles desaparecidos que aún nadie ha revisado
  const [[nuevos]] = await db.query(
    "SELECT COUNT(*) AS n, TIMESTAMPDIFF(MINUTE, MIN(creado_en), NOW()) AS minutos FROM reportes_desaparecido WHERE estado = 'nuevo'"
  );
  if (nuevos.n > 0) {
    alertas.push({ id: 'desap-nuevos', severidad: 'critica', tipo: 'desaparecidos',
      titulo: `${plural(Number(nuevos.n), 'reporte nuevo', 'reportes nuevos')} de posibles desaparecidos`,
      detalle: `El más antiguo lleva ${tiempoTexto(Number(nuevos.minutos))} sin revisar`,
      accion: { tipo: 'ir', etiqueta: 'Revisar reportes', modulo: 'desaparecidos' }, orden: -1 });
  }

  return alertas.sort((a, b) => RANGO[a.severidad] - RANGO[b.severidad] || a.orden - b.orden);
}

// HU-4.5: Disponible, En servicio, Fuera de servicio o Atención requerida
function estadoUnidad(v) {
  if (v.estado === 'en_uso') return 'en_servicio';
  if (v.alistamiento === 'fuera_de_servicio') return 'fuera_de_servicio';
  if (v.alistamiento === 'atencion') return 'atencion_requerida';
  return 'disponible';
}

module.exports = { generarAlertas, estadoUnidad, textoFecha, tiempoTexto };
