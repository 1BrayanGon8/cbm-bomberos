// Carga tres reportes de vías de ejemplo con coordenadas cerca del centro del mapa. Es opcional.
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
  const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM reportes_via');
  if (n > 0) { console.log('Ya hay reportes de vías; no se cargó nada.'); await conn.end(); return; }
  const [[a]] = await conn.query("SELECT CAST(valor AS DECIMAL(9,6)) AS v FROM ajustes WHERE clave = 'mapa_lat'");
  const [[b]] = await conn.query("SELECT CAST(valor AS DECIMAL(9,6)) AS v FROM ajustes WHERE clave = 'mapa_lng'");
  const lat = Number(a.v);
  const lng = Number(b.v);

  // [tipo, ubicación, descripción, desfase lat, desfase lng, minutos atrás]
  const reportes = [
    ['obstruccion', 'Vía principal, salida norte', 'Árbol caído que bloquea un carril', 0.02, -0.01, 45],
    ['accidente', 'Entrada al municipio', 'Choque entre dos vehículos, un carril cerrado', -0.015, 0.02, 20],
    ['obstruccion', 'Vereda Puente Piedra', 'Deslizamiento leve de tierra sobre la vía', -0.03, 0.012, 300],
  ];
  for (const [tipo, ubic, desc, dLat, dLng, min] of reportes) {
    await conn.query(
      `INSERT INTO reportes_via (tipo, ubicacion, latitud, longitud, descripcion, ocurrido_en)
       VALUES (?, ?, ?, ?, ?, DATE_SUB(NOW(), INTERVAL ? MINUTE))`,
      [tipo, ubic, (lat + dLat).toFixed(6), (lng + dLng).toFixed(6), desc, min]
    );
  }
  await conn.end();
  console.log('Reportes de vías de ejemplo cargados.');
})().catch((e) => { console.error('Error:', e.message); process.exit(1); });
