const db = require('../config/db');
const { diasPorVencer } = require('./inventario');
const { listarFlota } = require('./flota');
const { estadoUnidad } = require('./alertas');
const { bad, FECHA } = require('./validar');

const DIA_MS = 86400000;
const sumarDias = (iso, n) => new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * DIA_MS).toISOString().slice(0, 10);
const entre = (desde, hasta) => Math.round((new Date(`${hasta}T00:00:00Z`) - new Date(`${desde}T00:00:00Z`)) / DIA_MS);
const porcentaje = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
const numero = (v) => (v === null || v === undefined ? null : Number(v));

// HU-6.1: periodo elegido (por defecto, los últimos 30 días) y periodo anterior de la misma duración
async function resolverPeriodo(desde, hasta) {
  const [[{ hoy }]] = await db.query('SELECT CURDATE() AS hoy');
  if ((desde && !FECHA.test(desde)) || (hasta && !FECHA.test(hasta))) throw bad('Las fechas deben tener formato AAAA-MM-DD.');
  const fin = hasta || hoy;
  const ini = desde || sumarDias(fin, -29);
  if (ini > fin) throw bad('La fecha inicial no puede ser posterior a la final.');
  const dias = entre(ini, fin) + 1;
  if (dias > 366) throw bad('El periodo no puede ser mayor a un año.');
  const antHasta = sumarDias(ini, -1);
  return { desde: ini, hasta: fin, dias, anterior: { desde: sumarDias(antHasta, -(dias - 1)), hasta: antHasta } };
}

// Tiempo de respuesta = desde que se registra la emergencia hasta la hora de salida de la unidad.
// Se ignoran valores negativos o de más de 6 horas (registros hechos después del hecho).
const RESP = 'TIMESTAMPDIFF(SECOND, creado_en, fecha_salida)';
const VALIDA = `CASE WHEN ${RESP} BETWEEN 0 AND 21600 THEN ${RESP} END`;
const EN_PERIODO = 'fecha_salida >= ? AND fecha_salida < DATE_ADD(?, INTERVAL 1 DAY)';

async function estadisticasEmergencias(desde, hasta) {
  const [[r]] = await db.query(
    `SELECT COUNT(*) AS total, AVG(${VALIDA}) AS promedio, MAX(${VALIDA}) AS maximo FROM emergencias WHERE ${EN_PERIODO}`,
    [desde, hasta]
  );
  return { total: Number(r.total), promedio: numero(r.promedio) === null ? null : Math.round(Number(r.promedio)), maximo: numero(r.maximo) };
}

async function calcular(desdeParam, hastaParam) {
  const p = await resolverPeriodo(desdeParam, hastaParam);
  const [actual, previo] = await Promise.all([
    estadisticasEmergencias(p.desde, p.hasta),
    estadisticasEmergencias(p.anterior.desde, p.anterior.hasta),
  ]);

  const [[meta]] = await db.query("SELECT valor FROM ajustes WHERE clave = 'meta_respuesta_min'");
  const metaSeg = (meta ? Number(meta.valor) : 8) * 60;

  // Por semana, contando desde el inicio del periodo
  const [filas] = await db.query(
    `SELECT FLOOR(DATEDIFF(DATE(fecha_salida), ?) / 7) AS semana, COUNT(*) AS total, AVG(${VALIDA}) AS promedio
       FROM emergencias WHERE ${EN_PERIODO} GROUP BY semana`,
    [p.desde, p.desde, p.hasta]
  );
  const porSemana = Array.from({ length: Math.ceil(p.dias / 7) }, (_, i) => {
    const f = filas.find((x) => Number(x.semana) === i);
    return { etiqueta: `Sem ${i + 1}`, total: f ? Number(f.total) : 0, promedio_seg: f && f.promedio !== null ? Math.round(Number(f.promedio)) : null };
  });

  // Inventario hoy: vigente (verde), por vencer (amarillo) y crítico (rojo, vencido)
  const dias = await diasPorVencer();
  const [[inv]] = await db.query(
    `SELECT COUNT(*) AS elementos, COALESCE(SUM(cantidad), 0) AS total,
            COALESCE(SUM(IF(fecha_clave IS NULL OR fecha_clave > DATE_ADD(CURDATE(), INTERVAL ? DAY), cantidad, 0)), 0) AS vigentes,
            COALESCE(SUM(IF(fecha_clave >= CURDATE() AND fecha_clave <= DATE_ADD(CURDATE(), INTERVAL ? DAY), cantidad, 0)), 0) AS por_vencer,
            COALESCE(SUM(IF(fecha_clave < CURDATE(), cantidad, 0)), 0) AS criticos,
            COALESCE(SUM(IF(fecha_clave IS NOT NULL, cantidad, 0)), 0) AS con_fecha
       FROM equipos WHERE estado <> 'baja'`,
    [dias, dias]
  );

  // Lo que está prestado hoy y los movimientos del periodo (préstamos, devoluciones, daños, pérdidas y vencidos)
  const [[prest]] = await db.query(
    `SELECT COALESCE(SUM(IF(vehiculo_id IS NULL, cantidad, 0)), 0) AS unidades, COALESCE(SUM(vehiculo_id IS NOT NULL), 0) AS vehiculos
       FROM prestamos WHERE estado = 'activo'`
  );
  const [movs] = await db.query(
    `SELECT tipo, COALESCE(SUM(cantidad), 0) AS total FROM inventario_movimientos
      WHERE creado_en >= ? AND creado_en < DATE_ADD(?, INTERVAL 1 DAY) GROUP BY tipo`,
    [p.desde, p.hasta]
  );
  const mov = { ingreso: 0, prestamo: 0, devolucion: 0, danado: 0, perdido: 0, vencido: 0, otro_retiro: 0 };
  for (const m of movs) mov[m.tipo] = Number(m.total);

  const [tipos] = await db.query(
    `SELECT tipo, COUNT(*) AS total FROM mantenimientos WHERE fecha BETWEEN ? AND ? AND estado <> 'cancelado' GROUP BY tipo`,
    [p.desde, p.hasta]
  );
  const porTipo = { preventivo: 0, correctivo: 0, inspeccion: 0, danos: 0 };
  for (const t of tipos) porTipo[t.tipo] = Number(t.total);

  const flota = await listarFlota();
  const operativas = flota.filter((v) => estadoUnidad(v) !== 'fuera_de_servicio').length;

  // Desaparecidos: resueltos en el periodo (y en el anterior) y activos hoy
  const [[des]] = await db.query(
    `SELECT COALESCE(SUM(estado = 'resuelto' AND fecha_resolucion >= ? AND fecha_resolucion < DATE_ADD(?, INTERVAL 1 DAY)), 0) AS resueltos,
            COALESCE(SUM(estado = 'resuelto' AND fecha_resolucion >= ? AND fecha_resolucion < DATE_ADD(?, INTERVAL 1 DAY)), 0) AS resueltos_anterior,
            COALESCE(SUM(estado = 'activo'), 0) AS activos
       FROM desaparecidos`,
    [p.desde, p.hasta, p.anterior.desde, p.anterior.hasta]
  );

  const invTotal = Number(inv.total);
  return {
    periodo: { desde: p.desde, hasta: p.hasta, dias: p.dias },
    anterior: p.anterior,
    emergencias: {
      total: actual.total,
      anterior: previo.total,
      variacion_pct: previo.total > 0 ? Math.round(((actual.total - previo.total) / previo.total) * 100) : null,
      por_semana: porSemana.map((s) => ({ etiqueta: s.etiqueta, total: s.total })),
    },
    respuesta: {
      promedio_seg: actual.promedio,
      maximo_seg: actual.maximo,
      meta_seg: metaSeg,
      promedio_anterior_seg: previo.promedio,
      diferencia_seg: actual.promedio !== null && previo.promedio !== null ? actual.promedio - previo.promedio : null,
      por_semana: porSemana.map((s) => ({ etiqueta: s.etiqueta, promedio_seg: s.promedio_seg })),
    },
    inventario: {
      total: invTotal,
      elementos: Number(inv.elementos),
      con_fecha: Number(inv.con_fecha),
      prestadas: Number(prest.unidades),
      vehiculos_prestados: Number(prest.vehiculos),
      movimientos: mov,
      vigentes: Number(inv.vigentes),
      por_vencer: Number(inv.por_vencer),
      criticos: Number(inv.criticos),
      pct_vigente: porcentaje(Number(inv.vigentes), invTotal),
    },
    mantenimiento: { total: Object.values(porTipo).reduce((a, b) => a + b, 0), por_tipo: porTipo },
    flota: {
      total: flota.length,
      operativas,
      en_mantenimiento: flota.filter((v) => v.estado === 'en_mantenimiento').length,
      prestados: flota.filter((v) => v.estado === 'prestado').length,
      inactivos_temporales: flota.filter((v) => v.estado === 'inactivo_temporal').length,
      pct: porcentaje(operativas, flota.length),
    },
    desaparecidos: {
      resueltos: Number(des.resueltos),
      resueltos_anterior: Number(des.resueltos_anterior),
      activos: Number(des.activos),
      pct_resolucion: porcentaje(Number(des.resueltos), Number(des.resueltos) + Number(des.activos)),
    },
  };
}

// ---------- Tablas para exportar (las usan el Excel y el PDF) ----------
const mmss = (seg) => (seg === null || seg === undefined ? '—' : `${String(Math.floor(seg / 60)).padStart(2, '0')}:${String(seg % 60).padStart(2, '0')}`);
const dmy = (iso) => iso.split('-').reverse().join('/');
const con = (n, sufijo = '') => (n === null || n === undefined ? '—' : `${n}${sufijo}`);
const firmado = (n) => (n === null ? '—' : `${n > 0 ? '+' : ''}${n}%`);

function aTabla(d) {
  const t = d.mantenimiento.por_tipo;
  return {
    titulo: 'Analítica operativa · Bomberos Voluntarios de Facatativá',
    subtitulo: `Periodo: ${dmy(d.periodo.desde)} al ${dmy(d.periodo.hasta)} (${d.periodo.dias} días)`,
    secciones: [
      { titulo: 'Indicadores principales', filas: [
        ['Emergencias en el periodo', d.emergencias.total],
        ['Variación frente al periodo anterior', firmado(d.emergencias.variacion_pct)],
        ['Respuesta promedio (mm:ss)', mmss(d.respuesta.promedio_seg)],
        ['Respuesta máxima (mm:ss)', mmss(d.respuesta.maximo_seg)],
        ['Meta de respuesta (mm:ss)', mmss(d.respuesta.meta_seg)],
        ['Inventario vigente (hoy)', con(d.inventario.pct_vigente, '%')],
        ['Unidades prestadas (hoy)', d.inventario.prestadas],
        ['Vehículos prestados (hoy)', d.inventario.vehiculos_prestados],
        ['Mantenimientos del periodo', d.mantenimiento.total],
        ['Disponibilidad de la flota (hoy)', `${con(d.flota.pct, '%')} (${d.flota.operativas} de ${d.flota.total} unidades)`],
        ['Casos de desaparecidos resueltos', d.desaparecidos.resueltos],
      ] },
      { titulo: 'Emergencias por semana', encabezado: ['Semana', 'Emergencias', 'Respuesta promedio'],
        filas: d.emergencias.por_semana.map((s, i) => [s.etiqueta, s.total, mmss(d.respuesta.por_semana[i].promedio_seg)]) },
      { titulo: 'Estado del inventario (hoy, en unidades)', encabezado: ['Estado', 'Unidades'], filas: [
        ['Vigentes', d.inventario.vigentes], ['Por vencer', d.inventario.por_vencer], ['Críticos (vencidos)', d.inventario.criticos], ['Total', d.inventario.total],
        ['Con fecha de vencimiento o recarga', d.inventario.con_fecha], ['Prestadas ahora', d.inventario.prestadas],
      ] },
      { titulo: 'Movimientos de inventario del periodo (unidades)', encabezado: ['Movimiento', 'Unidades'], filas: [
        ['Prestadas', d.inventario.movimientos.prestamo], ['Devueltas', d.inventario.movimientos.devolucion],
        ['Dañadas', d.inventario.movimientos.danado], ['Perdidas', d.inventario.movimientos.perdido], ['Vencidas', d.inventario.movimientos.vencido],
        ['Otros retiros', d.inventario.movimientos.otro_retiro], ['Ingresos', d.inventario.movimientos.ingreso],
      ] },
      { titulo: 'Flota (hoy)', filas: [
        ['Vehículos prestados', d.flota.prestados], ['Vehículos temporalmente inactivos', d.flota.inactivos_temporales], ['En mantenimiento', d.flota.en_mantenimiento],
      ] },
      { titulo: 'Mantenimiento por tipo', encabezado: ['Tipo', 'Cantidad'], filas: [
        ['Preventivo', t.preventivo], ['Correctivo', t.correctivo], ['Inspección', t.inspeccion], ['Daños', t.danos],
      ] },
      { titulo: 'Casos de desaparecidos', filas: [
        ['Resueltos en el periodo', d.desaparecidos.resueltos],
        ['Resueltos en el periodo anterior', d.desaparecidos.resueltos_anterior],
        ['Activos hoy', d.desaparecidos.activos],
        ['Porcentaje de resolución', con(d.desaparecidos.pct_resolucion, '%')],
      ] },
    ],
  };
}

module.exports = { calcular, aTabla, mmss, resolverPeriodo };
