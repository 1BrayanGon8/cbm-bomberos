// Carga tres casos de ejemplo con coordenadas cerca del centro del mapa. Es opcional.
require('dotenv').config();
const mysql = require('mysql2/promise');

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'cbm_bomberos',
  });
  const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM desaparecidos');
  if (n > 0) { console.log('Ya hay casos registrados; no se cargó nada.'); await conn.end(); return; }
  const [[c]] = await conn.query("SELECT CAST(valor AS DECIMAL(9,6)) AS lat FROM ajustes WHERE clave = 'mapa_lat'");
  const [[l]] = await conn.query("SELECT CAST(valor AS DECIMAL(9,6)) AS lng FROM ajustes WHERE clave = 'mapa_lng'");
  const lat = Number(c.lat);
  const lng = Number(l.lng);

  // [nombre, edad, descripción, urgencia, ubicación, desfase lat, desfase lng, horas atrás]
  const casos = [
    ['Mariana López', 16, 'Chaqueta azul', 'alta', 'Barrio San Pedro', 0.012, -0.018, 3],
    ['Jorge Eliecer Mora', 72, 'Gorra beige', 'media', 'Vereda Puente Piedra', -0.03, 0.025, 20],
    ['Samuel Ortiz', 9, 'Camiseta roja', 'seguimiento', 'Parque principal', -0.004, 0.006, 72],
  ];
  for (const [nombre, edad, desc, urg, ubic, dLat, dLng, horas] of casos) {
    await conn.query(
      `INSERT INTO desaparecidos (nombre, edad, descripcion, urgencia, ultima_ubicacion, latitud, longitud, ultima_vez)
       VALUES (?, ?, ?, ?, ?, ?, ?, DATE_SUB(NOW(), INTERVAL ? HOUR))`,
      [nombre, edad, desc, urg, ubic, (lat + dLat).toFixed(6), (lng + dLng).toFixed(6), horas]
    );
  }
  await conn.end();
  console.log('Casos de ejemplo cargados.');
})().catch((e) => { console.error('Error:', e.message); process.exit(1); });
