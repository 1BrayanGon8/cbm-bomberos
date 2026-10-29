const db = require('../config/db');

// Centro y alcance del mapa esquemático sin conexión (se ajustan desde Personas desaparecidas).
async function configMapa() {
  const [filas] = await db.query("SELECT clave, valor FROM ajustes WHERE clave IN ('mapa_lat', 'mapa_lng', 'mapa_radio_km')");
  const m = Object.fromEntries(filas.map((f) => [f.clave, Number(f.valor)]));
  return { lat: m.mapa_lat ?? 4.8147, lng: m.mapa_lng ?? -74.3547, radio_km: m.mapa_radio_km ?? 12 };
}

module.exports = { configMapa };
