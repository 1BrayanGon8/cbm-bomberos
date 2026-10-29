// Carga 24 emergencias cerradas repartidas en los últimos 30 días para probar la analítica. Es opcional.
// Solo actúa si todavía no hay emergencias registradas.
require('dotenv').config();
const mysql = require('mysql2/promise');

const TIPOS = ['Incendio estructural', 'Rescate', 'Accidente de tránsito', 'Emergencia médica', 'Incendio forestal', 'Materiales peligrosos'];
const LUGARES = ['Barrio San Pedro', 'Vereda Puente Piedra', 'Parque principal', 'Barrio El Sosiego', 'Vía a Bogotá', 'Zona industrial'];

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'cbm_bomberos',
  });
  const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM emergencias');
  if (n > 0) { console.log('Ya hay emergencias registradas; no se cargó nada.'); await conn.end(); return; }
  const [vehiculos] = await conn.query("SELECT id FROM vehiculos WHERE activo = 1 ORDER BY codigo");
  if (!vehiculos.length) { console.log('No hay vehículos. Ejecuta primero npm run db:init.'); await conn.end(); return; }

  const total = 24;
  for (let i = 0; i < total; i += 1) {
    const minutosAtras = Math.floor((i + 0.5) * ((30 * 1440) / total));
    const respuestaSeg = 240 + ((i * 97) % 420);          // entre 4 y 11 minutos
    const duracionMin = 25 + ((i * 13) % 90);
    const [r] = await conn.query(
      `INSERT INTO emergencias (tipo, ubicacion, estado, fecha_salida, fecha_cierre, creado_en)
       VALUES (?, ?, 'cerrada', DATE_SUB(NOW(), INTERVAL ? MINUTE), DATE_SUB(NOW(), INTERVAL ? MINUTE), DATE_SUB(NOW(), INTERVAL ? SECOND))`,
      [TIPOS[i % TIPOS.length], LUGARES[(i * 5) % LUGARES.length], minutosAtras, Math.max(minutosAtras - duracionMin, 0), minutosAtras * 60 + respuestaSeg]
    );
    await conn.query('INSERT INTO emergencia_unidades (emergencia_id, vehiculo_id) VALUES (?, ?)', [r.insertId, vehiculos[i % vehiculos.length].id]);
  }
  await conn.end();
  console.log(`Emergencias de ejemplo cargadas: ${total}`);
})().catch((e) => { console.error('Error:', e.message); process.exit(1); });
