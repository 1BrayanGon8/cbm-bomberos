// Crea la base de datos, las tablas y los datos iniciales (roles, permisos, turnos, administrador).
// Es seguro ejecutarlo más de una vez.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const { MODULOS } = require('../src/config/permisos');
const { sincronizarCatalogo } = require('../src/services/catalogo');

const PERMISOS_INICIALES = {
  Administrativo: Object.fromEntries(MODULOS.map((m) => [m, 'total'])),
  Operativo: { dashboard: 'registro', inventarios: 'registro', mantenimientos: 'registro', prestamos: 'registro', entregas: 'registro', vias: 'registro', desaparecidos: 'registro', analitica: 'consulta', configuracion: 'ninguno' },
  'Jefe de máquina': { dashboard: 'consulta', inventarios: 'registro', mantenimientos: 'registro', prestamos: 'consulta', entregas: 'registro', vias: 'registro', desaparecidos: 'consulta', analitica: 'ninguno', configuracion: 'ninguno' },
};
const DESCRIPCIONES = {
  Administrativo: 'Acceso total',
  Operativo: 'Consulta y registro',
  'Jefe de máquina': 'Su vehículo y equipos vinculados',
};
// Cuatro turnos de 24 h: se reciben a las 8:00 y se entregan a las 8:00 del día siguiente.
const TURNOS = [
  ['Alfa', '08:00:00', '08:00:00'],
  ['Bravo', '08:00:00', '08:00:00'],
  ['Charlie', '08:00:00', '08:00:00'],
  ['Delta', '08:00:00', '08:00:00'],
];

const VEHICULOS = [
  ['M-01', 'Máquina 1', 'maquina'], ['M-02', 'Máquina 2', 'maquina'], ['M-03', 'Máquina 3', 'maquina'],
  ['AMB-01', 'Ambulancia 1', 'ambulancia'], ['AMB-02', 'Ambulancia 2', 'ambulancia'], ['R-01', 'Rescate 1', 'rescate'],
];
const CATEGORIAS = [
  'Herramienta manual', 'Herramienta eléctrica', 'Herramienta a gasolina', 'Extintores', 'Oxígeno medicinal',
  'Protección personal', 'Insumos médicos', 'Mangueras y accesorios',
  'Bombas y plantas', 'Camillas y rescate', 'Forestal y campo', 'Cuerdas y lazos',
];

async function asegurarColumna(conn, dbName, tabla, columna, definicion) {
  const [[r]] = await conn.query(
    'SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [dbName, tabla, columna]
  );
  if (!r.n) await conn.query(`ALTER TABLE \`${tabla}\` ADD COLUMN \`${columna}\` ${definicion}`);
}

async function main() {
  const dbName = process.env.DB_NAME || 'cbm_bomberos';
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true,
  });

  await conn.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await conn.query(`USE \`${dbName}\``);
  await conn.query(fs.readFileSync(path.join(__dirname, '../database/schema.sql'), 'utf8'));

  // Épica 3: campos nuevos de vehículos (MySQL no tiene ADD COLUMN IF NOT EXISTS)
  await asegurarColumna(conn, dbName, 'vehiculos', 'placa', 'VARCHAR(12) NULL UNIQUE');
  await asegurarColumna(conn, dbName, 'vehiculos', 'estado', "ENUM('activo','en_uso','en_mantenimiento','baja') NOT NULL DEFAULT 'activo'");
  await asegurarColumna(conn, dbName, 'vehiculos', 'km_actual', 'INT NOT NULL DEFAULT 0');
  await asegurarColumna(conn, dbName, 'vehiculos', 'horas_actuales', 'DECIMAL(8,1) NOT NULL DEFAULT 0');

  // Inventario por cantidades: cada elemento tiene cuántas unidades hay y una descripción (color, modelo, observaciones)
  await asegurarColumna(conn, dbName, 'equipos', 'cantidad', 'INT NOT NULL DEFAULT 1');
  await asegurarColumna(conn, dbName, 'equipos', 'descripcion', 'VARCHAR(255) NULL');

  // El historial de equipos admite eventos de reporte, préstamo, cantidad (se agregan unidades) y retiro (se quitan, con motivo)
  const [[col]] = await conn.query(
    "SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'equipo_eventos' AND COLUMN_NAME = 'tipo'",
    [dbName]
  );
  if (col && !col.t.includes("'retiro'")) {
    await conn.query("ALTER TABLE equipo_eventos MODIFY tipo ENUM('ingreso','edicion','traslado','estado','responsable','reporte','prestamo','cantidad','retiro') NOT NULL");
  }

  // Catálogo de elementos: cada equipo apunta a su elemento del catálogo (se crea a partir de los nombres que ya existían)
  await asegurarColumna(conn, dbName, 'equipos', 'catalogo_id', 'INT NULL');
  await sincronizarCatalogo(conn);

  // Préstamos de elementos por cantidad y de vehículos completos
  await conn.query('ALTER TABLE prestamos MODIFY equipo_id INT NULL');
  await asegurarColumna(conn, dbName, 'prestamos', 'vehiculo_id', 'INT NULL');
  await asegurarColumna(conn, dbName, 'prestamos', 'cantidad', 'INT NOT NULL DEFAULT 1');
  await asegurarColumna(conn, dbName, 'prestamos', 'incluye_unidades', 'INT NULL');
  await asegurarColumna(conn, dbName, 'prestamos', 'cant_buena', 'INT NULL');
  await asegurarColumna(conn, dbName, 'prestamos', 'cant_danada', 'INT NULL');
  await asegurarColumna(conn, dbName, 'prestamos', 'cant_perdida', 'INT NULL');
  await conn.query("ALTER TABLE prestamos MODIFY condicion_devolucion ENUM('bueno','danado','revision') NULL");

  // Vehículos: prestado y temporalmente inactivo (dañado o en revisión)
  const [[colV]] = await conn.query(
    "SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'vehiculos' AND COLUMN_NAME = 'estado'", [dbName]
  );
  if (colV && !colV.t.includes("'prestado'")) {
    await conn.query("ALTER TABLE vehiculos MODIFY estado ENUM('activo','en_uso','en_mantenimiento','baja','prestado','inactivo_temporal') NOT NULL DEFAULT 'activo'");
  }

  // Una sola vez: los préstamos activos de antes se hacían sobre la fila completa; ahora el inventario se descuenta por cantidad.
  const [[mig3]] = await conn.query("SELECT COUNT(*) AS n FROM ajustes WHERE clave = 'migracion_prestamos_cantidades'");
  if (!mig3.n) {
    await conn.query(
      "UPDATE prestamos p JOIN equipos e ON e.id = p.equipo_id SET p.cantidad = e.cantidad WHERE p.estado = 'activo' AND e.estado = 'en_uso'"
    );
    await conn.query(
      "UPDATE equipos SET cantidad = 0, estado = 'activo' WHERE estado = 'en_uso' AND id IN (SELECT equipo_id FROM (SELECT equipo_id FROM prestamos WHERE estado = 'activo' AND equipo_id IS NOT NULL) t)"
    );
    await conn.query("INSERT INTO ajustes (clave, valor) VALUES ('migracion_prestamos_cantidades', '1')");
  }

  // Calendario: cuándo se reparó un daño de vehículo
  await asegurarColumna(conn, dbName, 'danos_vehiculo', 'atendido_en', 'DATETIME NULL');

  // Catálogo de mantenimientos: unos básicos y los que ya estaban programados en los vehículos
  for (const [nombre, tipo] of [['Cambio de aceite', 'preventivo'], ['Cambio de filtros', 'preventivo'], ['Revisión de frenos', 'inspeccion'],
    ['Revisión de llantas', 'inspeccion'], ['Revisión de batería', 'inspeccion'], ['Chequeo general de la unidad', 'chequeo'], ['Revisión de luces y sirena', 'chequeo'], ['Cambio de llantas', 'preventivo'], ['SOAT', 'chequeo'], ['Revisión técnico-mecánica', 'chequeo']]) {
    await conn.query('INSERT IGNORE INTO catalogo_mantenimientos (nombre, tipo) VALUES (?, ?)', [nombre, tipo]);
  }
  await conn.query('INSERT IGNORE INTO catalogo_mantenimientos (nombre, tipo) SELECT nombre, MIN(tipo) FROM planes_mantenimiento GROUP BY nombre');

  // Las llantas dejan de ser un botón aparte: pasan a ser un tema más de Mantenimientos (se puede quitar y volver a agregar)
  const [[migL]] = await conn.query("SELECT COUNT(*) AS n FROM ajustes WHERE clave = 'migracion_llantas_tema'");
  if (!migL.n) {
    await conn.query(
      `INSERT INTO planes_mantenimiento (vehiculo_id, nombre, tipo)
       SELECT v.id, 'Cambio de llantas', 'preventivo' FROM vehiculos v
        WHERE v.estado <> 'baja' AND NOT EXISTS (SELECT 1 FROM planes_mantenimiento p WHERE p.vehiculo_id = v.id AND p.nombre = 'Cambio de llantas')`
    );
    await conn.query("INSERT INTO ajustes (clave, valor) VALUES ('migracion_llantas_tema', '1')");
  }

  // Las notas de quien recibe el turno pasan a 500 caracteres, igual que las de quien entrega
  await conn.query('ALTER TABLE entregas_turno MODIFY notas_recepcion VARCHAR(500) NULL');

  for (const [nombre, permisos] of Object.entries(PERMISOS_INICIALES)) {
    await conn.query('INSERT IGNORE INTO roles (nombre, descripcion) VALUES (?, ?)', [nombre, DESCRIPCIONES[nombre]]);
    const [[rol]] = await conn.query('SELECT id FROM roles WHERE nombre = ?', [nombre]);
    for (const modulo of MODULOS) {
      await conn.query('INSERT IGNORE INTO permisos (rol_id, modulo, nivel) VALUES (?, ?, ?)', [rol.id, modulo, permisos[modulo] || 'ninguno']);
    }
  }

  for (const [nombre, ini, fin] of TURNOS) {
    await conn.query('INSERT IGNORE INTO turnos (nombre, hora_inicio, hora_fin) VALUES (?, ?, ?)', [nombre, ini, fin]);
  }
  const [[activo]] = await conn.query('SELECT COUNT(*) AS n FROM turnos WHERE activo = 1');
  if (activo.n === 0) await conn.query("UPDATE turnos SET activo = 1 WHERE nombre = 'Alfa'");

  for (const [codigo, nombre, tipo] of VEHICULOS) {
    await conn.query('INSERT IGNORE INTO vehiculos (codigo, nombre, tipo) VALUES (?, ?, ?)', [codigo, nombre, tipo]);
  }
  for (const nombre of CATEGORIAS) {
    await conn.query('INSERT IGNORE INTO categorias (nombre) VALUES (?)', [nombre]);
  }
  await conn.query("INSERT IGNORE INTO ajustes (clave, valor) VALUES ('dias_por_vencer', '30')");
  for (const [clave, valor] of [['aviso_dias', '15'], ['aviso_km', '500'], ['aviso_horas', '25'], ['mapa_lat', '4.8147'], ['mapa_lng', '-74.3547'], ['mapa_radio_km', '12'], ['meta_respuesta_min', '8']]) {
    await conn.query('INSERT IGNORE INTO ajustes (clave, valor) VALUES (?, ?)', [clave, valor]);
  }
  // Una sola vez: en bases creadas antes del Sprint 3, el rol Operativo pasa a "registro" en mantenimientos.
  const [[mig]] = await conn.query("SELECT COUNT(*) AS n FROM ajustes WHERE clave = 'migracion_s3_operativo'");
  if (!mig.n) {
    await conn.query(
      `UPDATE permisos p JOIN roles r ON r.id = p.rol_id SET p.nivel = 'registro'
        WHERE r.nombre = 'Operativo' AND p.modulo = 'mantenimientos' AND p.nivel = 'consulta'`
    );
    await conn.query("INSERT INTO ajustes (clave, valor) VALUES ('migracion_s3_operativo', '1')");
  }

  // Una sola vez: bases anteriores con turnos de 8 h pasan a turnos de 24 h (8:00 a 8:00) y el mapa se centra en Facatativá.
  const [[mig2]] = await conn.query("SELECT COUNT(*) AS n FROM ajustes WHERE clave = 'migracion_turnos_24h'");
  if (!mig2.n) {
    await conn.query("UPDATE turnos SET hora_inicio = '08:00:00', hora_fin = '08:00:00' WHERE nombre IN ('Alfa', 'Bravo', 'Charlie', 'Delta')");
    await conn.query(
      "UPDATE ajustes SET valor = '4.8147' WHERE clave = 'mapa_lat' AND valor = '4.7333'"
    );
    await conn.query(
      "UPDATE ajustes SET valor = '-74.3547' WHERE clave = 'mapa_lng' AND valor = '-74.2667'"
    );
    await conn.query("INSERT INTO ajustes (clave, valor) VALUES ('migracion_turnos_24h', '1')");
  }

  const usuario = process.env.ADMIN_USUARIO || 'admin';
  const [[existe]] = await conn.query('SELECT COUNT(*) AS n FROM usuarios WHERE usuario = ?', [usuario]);
  if (existe.n === 0) {
    const [[rolAdmin]] = await conn.query("SELECT id FROM roles WHERE nombre = 'Administrativo'");
    const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'Cambiar123*', 10);
    await conn.query('INSERT INTO usuarios (nombre, usuario, password_hash, rol_id) VALUES (?, ?, ?, ?)', [
      process.env.ADMIN_NOMBRE || 'Administrador', usuario, hash, rolAdmin.id,
    ]);
    console.log(`Usuario administrador creado: ${usuario}`);
  }

  await conn.end();
  console.log(`Base de datos "${dbName}" lista.`);
}

main().catch((e) => { console.error('Error al inicializar la base de datos:', e.message); process.exit(1); });
