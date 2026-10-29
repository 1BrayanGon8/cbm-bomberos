const fs = require('fs');
const path = require('path');

// Mapa base de calles: se pide a un proveedor de "teselas" (por defecto OpenStreetMap) y se guarda en disco.
// Lo que ya se descargó una vez se sigue viendo sin internet.
const DIR = path.join(__dirname, '..', '..', 'data', 'tiles');
const URL_BASE = process.env.MAPA_TILES_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const AGENTE = 'CBM-Bomberos-Facatativa/1.0 (sistema local de la estacion de bomberos)';
const ZOOM_MIN = 8;
const ZOOM_MAX = 18;

// Proyección de las teselas (Web Mercator)
const tileX = (lng, z) => ((lng + 180) / 360) * 2 ** z;
const tileY = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};
const lngDeTile = (x, z) => (x / 2 ** z) * 360 - 180;
const latDeTile = (y, z) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;

// Teselas que cubren un cuadrado de ±radioKm alrededor de un punto
function teselasDe(lat, lng, radioKm, z) {
  const dLat = radioKm / 111.32;
  const dLng = radioKm / (111.32 * Math.cos((lat * Math.PI) / 180));
  return {
    x0: Math.floor(tileX(lng - dLng, z)), x1: Math.floor(tileX(lng + dLng, z)),
    y0: Math.floor(tileY(lat + dLat, z)), y1: Math.floor(tileY(lat - dLat, z)),
  };
}

// ¿La tesela toca el cuadrado de ±radioKm alrededor del centro? Evita que el servidor sirva de proxy abierto.
function dentroDelArea(z, x, y, centro, radioKm) {
  const dLat = radioKm / 111.32;
  const dLng = radioKm / (111.32 * Math.cos((centro.lat * Math.PI) / 180));
  const norte = latDeTile(y, z);
  const sur = latDeTile(y + 1, z);
  const oeste = lngDeTile(x, z);
  const este = lngDeTile(x + 1, z);
  return sur <= centro.lat + dLat && norte >= centro.lat - dLat && oeste <= centro.lng + dLng && este >= centro.lng - dLng;
}

async function existe(archivo) {
  try { await fs.promises.access(archivo); return true; } catch { return false; }
}

// Devuelve la ruta de la tesela, descargándola si todavía no está guardada.
async function obtenerTile(z, x, y) {
  const archivo = path.join(DIR, String(z), String(x), `${y}.png`);
  if (await existe(archivo)) return { archivo, deCache: true };

  const url = URL_BASE.replace('{z}', z).replace('{x}', x).replace('{y}', y);
  const r = await fetch(url, { headers: { 'User-Agent': AGENTE }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw Object.assign(new Error(`El proveedor de mapas respondió ${r.status}.`), { status: 502 });
  // Solo se guardan imágenes (una página de "inicia sesión" de una red WiFi no debe quedar como mapa)
  if (!(r.headers.get('content-type') || '').startsWith('image/')) throw Object.assign(new Error('El proveedor no devolvió una imagen.'), { status: 502 });
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 500 * 1024) throw Object.assign(new Error('La imagen del mapa es demasiado grande.'), { status: 502 });

  await fs.promises.mkdir(path.dirname(archivo), { recursive: true });
  const temporal = `${archivo}.${process.pid}.tmp`;
  await fs.promises.writeFile(temporal, buf);
  await fs.promises.rename(temporal, archivo);
  return { archivo, deCache: false };
}

module.exports = { DIR, ZOOM_MIN, ZOOM_MAX, tileX, tileY, lngDeTile, latDeTile, teselasDe, dentroDelArea, obtenerTile };
