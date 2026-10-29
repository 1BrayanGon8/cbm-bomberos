// Carga el inventario real de la estación (bodega, MB02 y RAM) a partir del listado entregado por los bomberos.
// Es seguro ejecutarlo más de una vez: cada elemento tiene un código fijo (INV-001…) y no se duplica.
// Los nombres, cantidades y lugares se pueden cambiar después desde la pantalla Inventarios.
require('dotenv').config();
const mysql = require('mysql2/promise');
const { sincronizarCatalogo } = require('../src/services/catalogo');

const ALM = null; // null = Almacén
const MB = 'MB-02';
const RAM = 'RAM';

const VEHICULOS = [
  [MB, 'Máquina extintora MB02 (350)', 'maquina'],
  [RAM, 'Máquina extintora RAM', 'maquina'],
];

// [nombre, cantidad, categoría, lugar (código de vehículo o null = Almacén), sitio dentro del lugar, descripción, lote/serie]
const BOMBAS = 'Bombas y plantas', GAS = 'Herramienta a gasolina', MAN = 'Herramienta manual', CAMP = 'Forestal y campo';
const MANG = 'Mangueras y accesorios', CAM = 'Camillas y rescate', LAZ = 'Cuerdas y lazos';

const ITEMS = [
  // ----- Bodega / almacén -----
  ['Bomba sumergible Geiser QSB JH 8003p', 1, BOMBAS, ALM, null, 'Azul rey con plateado'],
  ['Motobomba sumergible Barmesa 2AHS-101A', 1, BOMBAS, ALM, null, 'Azul claro con negro'],
  ['Motobomba sumergible Geiser QSB JH 900B', 1, BOMBAS, ALM, null, null],
  ['Motobomba sumergible verde', 1, BOMBAS, ALM, null, 'La viejita, pesada'],
  ['Motobomba sumergible QT37', 1, BOMBAS, ALM, null, 'Naranja con negro, sin flotador', '2025040830041'],
  ['Motobomba sumergible QT37', 1, BOMBAS, ALM, null, 'Naranja con negro, sin flotador', '2025040830025'],
  ['Planta eléctrica FORTE', 1, BOMBAS, ALM, null, '120 a 240 voltios'],
  ['Marullama a gasolina', 1, BOMBAS, ALM, null, null],
  ['Motobomba estacionaria diésel', 1, BOMBAS, ALM, null, '4 pulgadas'],
  ['Motobomba de ultrapresión a gasolina', 1, BOMBAS, ALM, null, null],
  ['Sopladora grande STIHL', 2, GAS, ALM, null, null],
  ['Sopladora pequeña STIHL', 1, GAS, ALM, null, null],
  ['Fumigadora de espalda', 1, CAMP, ALM, null, '20 litros'],
  ['Fumigadora de carrito', 1, CAMP, ALM, null, '30 litros'],
  ['Palas', 6, CAMP, ALM, null, null],
  ['Rastrillos', 3, CAMP, ALM, null, null],
  ['Azadones', 8, CAMP, ALM, null, null],
  ['Palines', 3, CAMP, ALM, null, null],
  ['Remo', 1, CAMP, ALM, null, null],
  ['Aholladora', 1, CAMP, ALM, null, null],
  ['Batifuegos', 2, CAMP, ALM, null, null],
  ['Lazo de 30 metros de media pulgada', 1, LAZ, ALM, null, 'Amarillo y azul'],
  ['Lazo de 30 metros de 1 pulgada', 1, LAZ, ALM, null, 'Amarillo y verde'],
  ['Prensas de gas pequeñas', 4, MAN, ALM, null, null],
  ['Prensas de gas grandes', 2, MAN, ALM, null, 'Una sin varilla'],
  ['Ganchos de 3 puntas', 3, MAN, ALM, null, null],
  ['Ganchos de extensión', 2, MAN, ALM, null, null],
  ['Ganchos normales', 2, MAN, ALM, null, null],
  ['Camilla de vacío', 1, CAM, ALM, null, null],
  ['Camillas de madera', 25, CAM, ALM, null, null],
  ['Manguera para marullama', 1, MANG, ALM, null, 'Amarilla'],
  ['Tensor', 1, MAN, ALM, null, null],
  ['Moto', 1, GAS, ALM, null, null],
  ['Tanque de agua con motobomba', 1, BOMBAS, ALM, null, null],
  ['Banco de trabajo', 1, MAN, ALM, null, null],
  ['Camilla de cuchara', 1, CAM, ALM, null, null],
  ['Carretel con manguera del tanque de agua', 1, MANG, ALM, null, null],
  ['Tramos de la bomba de agua', 2, MANG, ALM, null, null],
  ['Rastrillos de plástico', 2, CAMP, ALM, null, null],
  ['Llave de piso', 1, MANG, ALM, null, null],
  ['Camilla de ambulancia', 1, CAM, ALM, null, null],

  // ----- Máquina extintora MB02 (350) -----
  ['Tramos de manguera de 1/2', 3, MANG, MB, 'Gabinete izquierdo', null],
  ['Tramos de manguera de 1/2', 4, MANG, MB, 'Gabinete derecho', null],
  ['Tramo de manguera de 2/2', 1, MANG, MB, 'Gabinete del centro', null],
  ['Pitones de 1/2', 2, MANG, MB, null, null],
  ['Llave de piso', 1, MANG, MB, null, null],
  ['Llaves spanner', 4, MANG, MB, null, null],
  ['Hachas', 2, MAN, MB, null, null],
  ['Boquilla de 1/2', 1, MANG, MB, null, null],
  ['Escalera', 1, MAN, MB, 'Lado derecho', null],
  ['Canecas de espuma', 2, MANG, MB, null, null],
  ['Reductora', 1, MANG, MB, null, null],
  ['Guíos', 2, MAN, MB, null, null],

  // ----- Máquina extintora RAM -----
  ['Guíos', 2, MAN, RAM, null, null],
  ['Escalera', 1, MAN, RAM, 'Lado derecho', null],
  ['Siamesa', 1, MANG, RAM, null, null],
  ['Pitones de 1/2', 2, MANG, RAM, null, null],
  ['Machetes', 2, MAN, RAM, null, null],
  ['Boquilla', 1, MANG, RAM, null, null],
  ['Llave spanner', 1, MANG, RAM, null, null],
  ['Pitón de japonesa antigua', 1, MANG, RAM, null, null],
  ['Pitón de 2/2', 1, MANG, RAM, null, null],
  ['Tramos de manguera de 1/2', 1, MANG, RAM, 'Lado izquierdo · gabinete pequeño', null],
  ['Tramos de manguera de 1/2', 3, MANG, RAM, 'Lado izquierdo · gabinete grande', null],
  ['Tramos de manguera de 1/2', 3, MANG, RAM, 'Lado derecho · gabinete grande', null],
  ['Tramos de manguera de 1/2', 2, MANG, RAM, 'Lado derecho · gabinete pequeño', null],
];

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'cbm_bomberos',
  });

  for (const c of [BOMBAS, GAS, MAN, CAMP, MANG, CAM, LAZ]) await conn.query('INSERT IGNORE INTO categorias (nombre) VALUES (?)', [c]);
  for (const [codigo, nombre, tipo] of VEHICULOS) await conn.query('INSERT IGNORE INTO vehiculos (codigo, nombre, tipo) VALUES (?, ?, ?)', [codigo, nombre, tipo]);

  const veh = Object.fromEntries((await conn.query('SELECT id, codigo FROM vehiculos'))[0].map((v) => [v.codigo, v.id]));
  const cat = Object.fromEntries((await conn.query('SELECT id, nombre FROM categorias'))[0].map((c) => [c.nombre, c.id]));

  let creados = 0;
  for (const [i, [nombre, cantidad, categoria, lugar, area, descripcion, serie]] of ITEMS.entries()) {
    const codigo = `INV-${String(i + 1).padStart(3, '0')}`;
    const [r] = await conn.query(
      `INSERT IGNORE INTO equipos (codigo, nombre, categoria_id, vehiculo_id, lote_serie, area, cantidad, descripcion, estado, fecha_ingreso)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'activo', CURDATE())`,
      [codigo, nombre, cat[categoria], lugar ? veh[lugar] : null, serie || null, area, cantidad, descripcion]
    );
    if (r.affectedRows) {
      creados += 1;
      await conn.query("INSERT INTO equipo_eventos (equipo_id, tipo, detalle) VALUES (?, 'ingreso', ?)", [r.insertId, `Ingreso de ${cantidad} a ${lugar || 'Almacén'}${area ? ' (' + area + ')' : ''}`]);
    }
  }
  await sincronizarCatalogo(conn);
  await conn.end();
  console.log(`Inventario real: ${creados} elementos nuevos (${ITEMS.length - creados} ya existían).`);
})().catch((e) => { console.error('Error:', e.message); process.exit(1); });
