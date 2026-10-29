const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^\d{2}:\d{2}$/;

// Error controlado: el manejador de app.js responde con este estado y mensaje.
const bad = (mensaje, status = 400) => Object.assign(new Error(mensaje), { status });
const nulo = (v) => (v === '' || v === undefined ? null : v);

// Número opcional: devuelve null si viene vacío; falla si no es válido.
function numero(v, nombre, { entero = false, positivo = false } = {}) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || (positivo && n === 0) || (entero && !Number.isInteger(n))) throw bad(`${nombre} no es válido.`);
  return n;
}

// Coordenadas con signo (la longitud de Colombia es negativa); van juntas o ninguna.
function coordenadas(b) {
  const leer = (v, nombre, min, max) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < min || n > max) throw bad(`${nombre} no es válida.`);
    return n;
  };
  const lat = leer(b.latitud, 'La latitud', -90, 90);
  const lng = leer(b.longitud, 'La longitud', -180, 180);
  if ((lat === null) !== (lng === null)) throw bad('Indica la latitud y la longitud juntas.');
  return { lat, lng };
}

// Fecha y hora "AAAA-MM-DD HH:MM" (o con T); vacío = ahora. Devuelve el fragmento SQL y sus parámetros.
const FECHA_HORA = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}$/;
function fechaHora(v) {
  if (v === undefined || v === null || v === '') return { sql: 'NOW()', params: [] };
  if (!FECHA_HORA.test(v)) throw bad('La fecha y hora no son válidas.');
  return { sql: '?', params: [`${v.replace('T', ' ')}:00`] };
}

module.exports = { FECHA, HORA, bad, nulo, numero, coordenadas, fechaHora };
