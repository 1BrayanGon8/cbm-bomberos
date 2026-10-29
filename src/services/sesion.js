const db = require('../config/db');

async function cargarPermisos(rolId) {
  const [filas] = await db.query('SELECT modulo, nivel FROM permisos WHERE rol_id = ?', [rolId]);
  return Object.fromEntries(filas.map((f) => [f.modulo, f.nivel]));
}

async function turnoActivo() {
  const [[turno]] = await db.query('SELECT id, nombre, hora_inicio, hora_fin FROM turnos WHERE activo = 1 LIMIT 1');
  return turno || null;
}

// Los turnos son de 24 h: se reciben a las 8:00 y se entregan a las 8:00 del día siguiente.
// Antes de las 8:00 todavía estamos en el ciclo que empezó ayer.
const HORA_RELEVO = 8;
async function cicloActual() {
  const [[r]] = await db.query('SELECT DATE_FORMAT(DATE_SUB(NOW(), INTERVAL ? HOUR), \'%Y-%m-%d\') AS fecha', [HORA_RELEVO]);
  return r.fecha;
}

// Turno que sigue en la rotación (Alfa → Bravo → Charlie → Delta → Alfa), según el orden de creación.
async function turnoSiguiente(turnoId) {
  const [turnos] = await db.query('SELECT id, nombre FROM turnos ORDER BY id');
  if (!turnos.length) return null;
  const i = turnos.findIndex((t) => t.id === turnoId);
  return turnos[(i + 1) % turnos.length];
}

module.exports = { cargarPermisos, turnoActivo, cicloActual, turnoSiguiente, HORA_RELEVO };
