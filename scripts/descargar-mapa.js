// Descarga de antemano las calles de la zona para poder verlas sin internet.
// Uso:  npm run mapa:descargar            (radio 6 km alrededor del centro del mapa, zoom 12 a 15)
//       npm run mapa:descargar -- --radio=8 --zmin=12 --zmax=16
// Son pocas teselas a propósito: el proveedor por defecto (OpenStreetMap) pide no hacer descargas masivas.
require('dotenv').config();
const db = require('../src/config/db');
const { configMapa } = require('../src/services/mapa');
const { teselasDe, obtenerTile } = require('../src/services/tiles');

const arg = (nombre, defecto) => {
  const a = process.argv.find((x) => x.startsWith(`--${nombre}=`));
  return a ? Number(a.split('=')[1]) : defecto;
};
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const radio = arg('radio', 6);
  const zmin = arg('zmin', 12);
  const zmax = arg('zmax', 15);
  const forzar = process.argv.includes('--forzar');
  const c = await configMapa();

  const lista = [];
  for (let z = zmin; z <= zmax; z += 1) {
    const r = teselasDe(c.lat, c.lng, radio, z);
    for (let x = r.x0; x <= r.x1; x += 1) for (let y = r.y0; y <= r.y1; y += 1) lista.push([z, x, y]);
  }
  console.log(`Centro del mapa: ${c.lat}, ${c.lng}. Radio ${radio} km, zoom ${zmin} a ${zmax}: ${lista.length} teselas.`);
  if (lista.length > 600 && !forzar) {
    console.log('Son demasiadas teselas. Baja el radio o el zoom máximo (o agrega --forzar si usas tu propio servidor de mapas).');
    await db.end();
    return;
  }

  let nuevas = 0;
  let guardadas = 0;
  let fallidas = 0;
  for (const [z, x, y] of lista) {
    try {
      const t = await obtenerTile(z, x, y);
      if (t.deCache) guardadas += 1; else { nuevas += 1; await dormir(300); }
    } catch (e) {
      fallidas += 1;
      if (fallidas === 1) console.log(`No se pudo descargar una tesela: ${e.message}`);
    }
  }
  console.log(`Listo. Descargadas ahora: ${nuevas}. Ya estaban guardadas: ${guardadas}. Fallidas: ${fallidas}.`);
  if (fallidas) console.log('Si hubo fallas, revisa la conexión a internet y vuelve a ejecutar el comando: solo pedirá las que falten.');
  await db.end();
})().catch((e) => { console.error('Error:', e.message); process.exit(1); });
