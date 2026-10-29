// Carga equipos de ejemplo con fechas relativas a hoy, para probar el semáforo. Es opcional.
require('dotenv').config();
const mysql = require('mysql2/promise');
const { sincronizarCatalogo } = require('../src/services/catalogo');

// [código, nombre, categoría, vehículo, lote/serie, tipo de fecha, días desde hoy (null = sin fecha)]
const EQUIPOS = [
  ['OX-MED-10L', 'Cilindro oxígeno 10 L', 'Oxígeno medicinal', 'AMB-02', 'OX2406', 'vencimiento', 3],
  ['EXT-PQS-20', 'Extintor PQS 20 lb', 'Extintores', 'M-03', 'EX8831', 'recarga', -1],
  ['CAS-MSA-04', 'Casco estructural MSA', 'Protección personal', 'M-01', null, 'vencimiento', 400],
  ['BOT-AMB-18', 'Botiquín trauma avanzado', 'Insumos médicos', 'AMB-01', 'BT2502', 'vencimiento', 120],
  ['MAN-25-07', 'Manguera 2½″ × 30 m', 'Mangueras y accesorios', null, null, 'vencimiento', null],
  ['HAC-BOM-01', 'Hacha de bombero', 'Herramienta manual', 'M-01', null, 'vencimiento', null],
  ['TAL-PER-02', 'Taladro percutor', 'Herramienta eléctrica', 'M-02', 'TP-5521', 'vencimiento', null],
  ['MOT-SER-01', 'Motosierra de rescate', 'Herramienta a gasolina', 'M-02', 'MS-0097', 'vencimiento', 20],
];

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'cbm_bomberos',
  });
  let creados = 0;
  for (const [codigo, nombre, categoria, vehiculo, lote, tipo, dias] of EQUIPOS) {
    const [[cat]] = await conn.query('SELECT id FROM categorias WHERE nombre = ?', [categoria]);
    const [[veh]] = vehiculo ? await conn.query('SELECT id FROM vehiculos WHERE codigo = ?', [vehiculo]) : [[{ id: null }]];
    const [r] = await conn.query(
      `INSERT IGNORE INTO equipos (codigo, nombre, categoria_id, vehiculo_id, lote_serie, tipo_fecha, fecha_clave, fecha_ingreso)
       VALUES (?, ?, ?, ?, ?, ?, ${dias === null ? 'NULL' : 'DATE_ADD(CURDATE(), INTERVAL ? DAY)'}, CURDATE())`,
      dias === null ? [codigo, nombre, cat.id, veh.id, lote, tipo] : [codigo, nombre, cat.id, veh.id, lote, tipo, dias]
    );
    if (r.affectedRows) {
      creados += 1;
      await conn.query("INSERT INTO equipo_eventos (equipo_id, tipo, detalle) VALUES (?, 'ingreso', ?)", [r.insertId, `Ingreso a ${vehiculo || 'Almacén'}`]);
    }
  }
  await sincronizarCatalogo(conn);
  await conn.end();
  console.log(`Equipos de ejemplo creados: ${creados}`);
})().catch((e) => { console.error('Error:', e.message); process.exit(1); });
