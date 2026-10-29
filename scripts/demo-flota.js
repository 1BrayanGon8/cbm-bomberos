// Carga datos de ejemplo de la flota (km, horas, frecuencias y mantenimientos) para probar la pantalla.
// Es opcional y solo actúa si todavía no hay mantenimientos registrados.
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
  const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM mantenimientos');
  if (n > 0) { console.log('Ya hay mantenimientos registrados; no se cargó nada.'); await conn.end(); return; }

  const id = async (codigo) => (await conn.query('SELECT id FROM vehiculos WHERE codigo = ?', [codigo]))[0][0].id;
  const uso = [['M-01', 24680, 410], ['M-02', 31570, 520], ['M-03', 18400, 300], ['AMB-01', 9800, 250], ['AMB-02', 12000, 280], ['R-01', 5200, 482]];
  for (const [codigo, km, horas] of uso) await conn.query('UPDATE vehiculos SET km_actual = ?, horas_actuales = ? WHERE codigo = ?', [km, horas, codigo]);
  await conn.query("UPDATE vehiculos SET estado = 'en_mantenimiento' WHERE codigo = 'M-03'");

  // [vehículo, nombre, tipo, cada_dias, cada_km, cada_horas, días desde la última vez, km base, horas base]
  const planes = [
    ['M-01', 'Mantenimiento preventivo', 'preventivo', 180, 10000, null, 148, 20000, null],
    ['M-02', 'Cambio de aceite', 'preventivo', null, 5000, null, 30, 27000, null],
    ['R-01', 'Inspección general', 'inspeccion', null, null, 500, 60, null, 0],
    ['AMB-01', 'Preventivo 10.000 km', 'preventivo', null, 10000, null, 90, 0, null],
    ['AMB-02', 'Chequeo de llantas', 'chequeo', 30, null, null, 10, null, null],
  ];
  for (const [veh, nombre, tipo, dias, km, horas, hace, kmBase, hBase] of planes) {
    await conn.query(
      `INSERT INTO planes_mantenimiento (vehiculo_id, nombre, tipo, cada_dias, cada_km, cada_horas, ultima_fecha, ultimo_km, ultimas_horas)
       VALUES (?, ?, ?, ?, ?, ?, DATE_SUB(CURDATE(), INTERVAL ? DAY), ?, ?)`,
      [await id(veh), nombre, tipo, dias, km, horas, hace, kmBase, hBase]
    );
  }

  // [vehículo, tipo, descripción, días desde hoy, hora, estado]
  const mants = [
    ['M-03', 'correctivo', 'Sistema de frenos', 0, '14:00', 'programado'],
    ['AMB-01', 'preventivo', 'Preventivo · 10.000 km', 6, '08:00', 'programado'],
    ['R-01', 'inspeccion', 'Inspección · 500 horas', 13, '10:30', 'programado'],
    ['M-01', 'preventivo', 'Cambio de filtros', -20, '09:00', 'realizado'],
  ];
  for (const [veh, tipo, desc, dias, hora, estado] of mants) {
    await conn.query(
      'INSERT INTO mantenimientos (vehiculo_id, tipo, descripcion, fecha, hora, estado) VALUES (?, ?, ?, DATE_ADD(CURDATE(), INTERVAL ? DAY), ?, ?)',
      [await id(veh), tipo, desc, dias, hora, estado]
    );
  }
  await conn.end();
  console.log('Datos de ejemplo de la flota cargados.');
})().catch((e) => { console.error('Error:', e.message); process.exit(1); });
