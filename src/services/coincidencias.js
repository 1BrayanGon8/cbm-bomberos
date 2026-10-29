// Compara un reporte del público con las personas que los bomberos ya ubicaron.
// No usa inteligencia artificial: suma puntos por nombre, edad, sexo y palabras de la descripción.
const PARASITAS = new Set(['con', 'sin', 'una', 'uno', 'unos', 'unas', 'del', 'los', 'las', 'que', 'por', 'para', 'tiene', 'tenia', 'lleva', 'llevaba', 'color', 'persona', 'estaba', 'viste', 'vestia', 'puesta', 'puesto']);

const limpiar = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, ' ');
const palabras = (t, min) => [...new Set(limpiar(t).split(/\s+/).filter((p) => p.length >= min && !PARASITAS.has(p)))];

function puntaje(reporte, hallada) {
  let p = 0;
  const motivos = [];

  const a = palabras(reporte.nombre, 3);
  const b = palabras(hallada.nombre, 3);
  const comunes = a.filter((x) => b.includes(x)).length;
  if (comunes) { p += Math.min(60, 35 + 20 * (comunes - 1)); motivos.push('nombre'); }

  if (reporte.edad != null && hallada.edad_aprox != null) {
    const d = Math.abs(Number(reporte.edad) - Number(hallada.edad_aprox));
    if (d <= 3) { p += 20; motivos.push('edad'); } else if (d <= 8) { p += 10; motivos.push('edad'); } else if (d > 20) p -= 25;
  }

  if (reporte.sexo !== 'no_se' && hallada.sexo !== 'no_se') {
    if (reporte.sexo === hallada.sexo) { p += 10; motivos.push('sexo'); } else p -= 30;
  }

  const da = palabras(reporte.descripcion, 4);
  const db = palabras(hallada.descripcion, 4);
  const iguales = da.filter((x) => db.includes(x)).length;
  if (iguales) { p += Math.min(30, iguales * 10); motivos.push('descripción'); }

  if (reporte.evento_id && hallada.evento_id && reporte.evento_id === hallada.evento_id) { p += 15; motivos.push('mismo evento'); }
  return { puntos: p, motivos };
}

// Devuelve las halladas parecidas, de más a menos probable. Con menos de 30 puntos no se considera parecida.
function buscarCoincidencias(reporte, halladas, { minimo = 30, max = 10 } = {}) {
  return halladas
    .map((h) => ({ h, ...puntaje(reporte, h) }))
    .filter((x) => x.puntos >= minimo)
    .sort((x, y) => y.puntos - x.puntos)
    .slice(0, max)
    .map((x) => ({ ...x.h, puntos: x.puntos, parecido: x.puntos >= 70 ? 'alto' : x.puntos >= 45 ? 'medio' : 'bajo', coincide_en: x.motivos }));
}

module.exports = { buscarCoincidencias, puntaje };
