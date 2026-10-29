const db = require('../config/db');

async function diasPorVencer() {
  const [[r]] = await db.query("SELECT valor FROM ajustes WHERE clave = 'dias_por_vencer'");
  return r ? Number(r.valor) : 30;
}

// Semáforo por fecha clave (HU-2.8) y estado con su acción (HU-2.3).
// dias_restantes = días entre hoy y la fecha clave (negativo si ya pasó).
function evaluar(e, dias) {
  const d = e.dias_restantes === null || e.dias_restantes === undefined ? null : Number(e.dias_restantes);
  let semaforo = 'verde';
  if (d !== null && d < 0) semaforo = 'rojo';
  else if (d !== null && d <= dias) semaforo = 'amarillo';

  let estado_fecha;
  if (e.estado === 'baja') estado_fecha = 'Dado de baja';
  else if (semaforo === 'rojo') {
    if (e.tipo_fecha === 'recarga') estado_fecha = 'Programar recarga';
    else estado_fecha = e.vehiculo_id ? 'Retirar de unidad' : 'Vencido';
  } else if (semaforo === 'amarillo') estado_fecha = 'Atención';
  else if (d === null && !e.vehiculo_id) estado_fecha = 'Disponible';
  else estado_fecha = 'Vigente';

  return { semaforo: e.estado === 'baja' ? null : semaforo, estado_fecha };
}

module.exports = { diasPorVencer, evaluar };
