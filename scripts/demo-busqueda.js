// Carga datos de ejemplo para probar el portal público: un evento en el mapa y dos personas halladas. Es opcional.
require('dotenv').config();
const mysql = require('mysql2/promise');

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '', database: process.env.DB_NAME || 'cbm_bomberos',
  });
  const [[ya]] = await conn.query("SELECT COUNT(*) AS n FROM eventos_catastrofe WHERE titulo = 'Vereda de ejemplo (demo)'");
  if (ya.n) { console.log('Los datos de ejemplo ya existen.'); await conn.end(); return; }
  const [r] = await conn.query(
    "INSERT INTO eventos_catastrofe (tipo, titulo, descripcion, latitud, longitud, radio_m) VALUES ('deslizamiento', 'Vereda de ejemplo (demo)', 'Deslizamiento de tierra que dejó varias viviendas incomunicadas.', 4.8260, -74.3380, 1500)"
  );
  await conn.query(
    `INSERT INTO personas_halladas (evento_id, nombre, tipo_persona, edad_aprox, sexo, descripcion, condicion, ubicacion_actual) VALUES
     (?, 'María López', 'adulto', 35, 'mujer', 'Chaqueta roja, jean azul, cabello negro largo', 'ilesa', 'Albergue del coliseo municipal'),
     (?, NULL, 'adulto_mayor', 72, 'hombre', 'Sombrero, ruana café, usa bastón', 'hospitalizada', 'Hospital San Rafael de Facatativá')`,
    [r.insertId, r.insertId]
  );
  await conn.end();
  console.log('Listo: evento de ejemplo y 2 personas halladas. Abre http://localhost:3000/buscar.html');
})().catch((e) => { console.error('Error:', e.message); process.exit(1); });
