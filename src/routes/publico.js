// Portal público: se usa SIN iniciar sesión. Solo permite ver el mapa de eventos activos,
// reportar una posible persona desaparecida y consultar si los bomberos ya ubicaron a alguien parecido.
const crypto = require('crypto');
const router = require('express').Router();
const db = require('../config/db');
const { ah } = require('../middleware/auth');
const { bad, nulo, numero } = require('../services/validar');
const { configMapa } = require('../services/mapa');
const { catalogo } = require('../config/catastrofes');
const { buscarCoincidencias } = require('../services/coincidencias');

const SEXOS = ['mujer', 'hombre', 'otro', 'no_se'];
const TEL = /^[0-9+()\-\s]{7,20}$/;
const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sin letras ni números que se confunden

// Límite sencillo por dirección IP para frenar el abuso del formulario (en memoria).
const intentos = new Map();
function limite(clave, max, ventanaMs) {
  return (req, res, next) => {
    const k = `${clave}:${req.ip}`;
    const ahora = Date.now();
    const recientes = (intentos.get(k) || []).filter((t) => ahora - t < ventanaMs);
    if (recientes.length >= max) return res.status(429).json({ error: 'Has hecho demasiados intentos. Espera un rato o llama a la línea de emergencias 123.' });
    recientes.push(ahora);
    intentos.set(k, recientes);
    next();
  };
}
setInterval(() => { const ahora = Date.now(); for (const [k, v] of intentos) if (!v.some((t) => ahora - t < 3600e3)) intentos.delete(k); }, 600e3).unref();

const codigoNuevo = () => 'DES-' + Array.from(crypto.randomBytes(6), (b) => ALFABETO[b % ALFABETO.length]).join('');

// Del público solo se publica lo necesario para reconocer a la persona y saber dónde está.
const publicas = (lista) => lista.map((h) => ({
  id: h.id, nombre: h.nombre, tipo_persona: h.tipo_persona, edad_aprox: h.edad_aprox, sexo: h.sexo, descripcion: h.descripcion,
  condicion: h.condicion, ubicacion_actual: h.ubicacion_actual, parecido: h.parecido, coincide_en: h.coincide_en,
  latitud: h.latitud === null ? null : Number(h.latitud), longitud: h.longitud === null ? null : Number(h.longitud), publicada_en: h.creado_en,
}));

async function halladasPublicadas() {
  const [filas] = await db.query("SELECT * FROM personas_halladas WHERE estado = 'publicada' ORDER BY creado_en DESC LIMIT 500");
  return filas;
}

router.get('/catalogo', (req, res) => res.json(catalogo()));

router.get('/mapa', ah(async (req, res) => {
  const [eventos] = await db.query(
    "SELECT id, tipo, titulo, descripcion, latitud, longitud, radio_m, creado_en FROM eventos_catastrofe WHERE estado = 'activo' ORDER BY creado_en DESC LIMIT 100"
  );
  res.json({
    centro: await configMapa(),
    eventos: eventos.map((e) => ({ ...e, latitud: Number(e.latitud), longitud: Number(e.longitud) })),
  });
}));

router.post('/reportes', limite('reporte', 8, 3600e3), ah(async (req, res) => {
  const b = req.body || {};
  // Campo trampa para robots: una persona real nunca lo ve ni lo llena.
  if (b.sitio_web) return res.status(201).json({ codigo: 'DES-' + 'X'.repeat(6), coincidencias: [] });
  if (!b.consentimiento) throw bad('Debes aceptar el tratamiento de tus datos para enviar el reporte.');
  const evento = Number(b.evento_id);
  const [[ev]] = await db.query("SELECT id FROM eventos_catastrofe WHERE id = ? AND estado = 'activo'", [evento || 0]);
  if (!ev) throw bad('Toca la zona afectada en el mapa para indicar dónde ocurrió el evento.');

  const nombre = (b.nombre || '').trim();
  if (!nombre) throw bad('Escribe el nombre de la persona.');
  const edad = numero(b.edad, 'La edad', { entero: true });
  if (edad !== null && edad > 120) throw bad('La edad no es válida.');
  const sexo = b.sexo || 'no_se';
  if (!SEXOS.includes(sexo)) throw bad('El sexo indicado no es válido.');
  const contacto = (b.contacto_nombre || '').trim();
  if (!contacto) throw bad('Escribe tu nombre para que los bomberos sepan con quién hablar.');
  const tel = (b.contacto_telefono || '').trim();
  const correo = (b.contacto_correo || '').trim();
  if (!tel && !correo) throw bad('Escribe un teléfono o un correo para avisarte.');
  if (tel && !TEL.test(tel)) throw bad('El teléfono no es válido.');
  if (correo && !CORREO.test(correo)) throw bad('El correo no es válido.');

  const reporte = {
    evento_id: ev.id, nombre: nombre.slice(0, 100), edad, sexo,
    descripcion: nulo((b.descripcion || '').trim().slice(0, 500)),
    ultima_ubicacion: nulo((b.ultima_ubicacion || '').trim().slice(0, 160)),
  };
  let codigo;
  for (let i = 0; i < 5; i += 1) {
    codigo = codigoNuevo();
    try {
      await db.query(
        `INSERT INTO reportes_desaparecido (codigo, evento_id, nombre, edad, sexo, descripcion, ultima_ubicacion, contacto_nombre, contacto_telefono, contacto_correo)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [codigo, reporte.evento_id, reporte.nombre, edad, sexo, reporte.descripcion, reporte.ultima_ubicacion, contacto.slice(0, 100), nulo(tel), nulo(correo.slice(0, 120))]
      );
      break;
    } catch (e) {
      if (e.code !== 'ER_DUP_ENTRY' || i === 4) throw e;
    }
  }
  const coincidencias = buscarCoincidencias(reporte, await halladasPublicadas());
  res.status(201).json({ codigo, coincidencias: publicas(coincidencias) });
}));

// Volver a consultar con el código de seguimiento (los bomberos pueden publicar nuevas personas después).
router.get('/reportes/:codigo/coincidencias', limite('consulta', 60, 3600e3), ah(async (req, res) => {
  const [[r]] = await db.query(
    'SELECT evento_id, nombre, edad, sexo, descripcion, estado, creado_en FROM reportes_desaparecido WHERE codigo = ?',
    [String(req.params.codigo || '').toUpperCase().trim()]
  );
  if (!r) throw bad('No encontramos un reporte con ese código.', 404);
  res.json({ estado: r.estado, nombre: r.nombre, creado_en: r.creado_en, coincidencias: publicas(buscarCoincidencias(r, await halladasPublicadas())) });
}));

module.exports = router;

