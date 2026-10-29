// Tipos de catástrofe que se pueden marcar en el mapa. Cada uno tiene su dibujo (icono) y una definición
// que se muestra al poner el cursor encima de la zona afectada.
const CATEGORIAS = {
  geologica: 'Geológicas (movimientos de masa y corteza)',
  hidrometeorologica: 'Hidrometeorológicas y climáticas',
  biologica: 'Biológicas (salud y ecosistemas)',
  astronomica: 'Astronómicas (espacio exterior)',
  otro: 'Otros',
};

const TIPOS = {
  terremoto: { nombre: 'Terremoto (sismo)', categoria: 'geologica', icono: '🏚️', definicion: 'Sacudidas bruscas de la corteza terrestre por liberación de energía tectónica.' },
  erupcion: { nombre: 'Erupción volcánica', categoria: 'geologica', icono: '🌋', definicion: 'Expulsión violenta de magma, cenizas, flujos piroclásticos y gases desde el interior de la Tierra.' },
  tsunami: { nombre: 'Tsunami (maremoto)', categoria: 'geologica', icono: '🌊', definicion: 'Olas gigantescas generadas por desplazamientos verticales del fondo marino, usualmente tras un sismo subterráneo.' },
  deslizamiento: { nombre: 'Deslizamiento de tierra', categoria: 'geologica', icono: '⛰️', definicion: 'Desplazamiento ladera abajo de grandes masas de tierra, rocas o escombros.' },
  flujo_lodo: { nombre: 'Flujo de lodo (alud torrencial)', categoria: 'geologica', icono: '🟤', definicion: 'Mezcla rápida y fluida de agua, sedimentos y escombros que desciende por cauces o montañas tras lluvias intensas.' },
  hundimiento: { nombre: 'Hundimiento de tierra (socavón)', categoria: 'geologica', icono: '🕳️', definicion: 'Colapso de la superficie debido a la erosión o disolución subterránea del suelo.' },
  avalancha: { nombre: 'Avalancha', categoria: 'geologica', icono: '🏔️', definicion: 'Desprendimiento y descenso violento de capas de nieve, hielo y rocas en zonas montañosas.' },

  inundacion: { nombre: 'Inundación', categoria: 'hidrometeorologica', icono: '💧', definicion: 'Acumulación descontrolada de agua que cubre zonas terrestres, por desbordamiento de ríos, lluvias torrenciales o subidas del mar.' },
  huracan: { nombre: 'Huracán (ciclón o tifón)', categoria: 'hidrometeorologica', icono: '🌀', definicion: 'Sistema de tormentas tropicales con vientos destructivos en rotación y lluvias masivas.' },
  tornado: { nombre: 'Tornado', categoria: 'hidrometeorologica', icono: '🌪️', definicion: 'Columna de aire que gira violentamente y conecta una nube de tormenta con el suelo.' },
  sequia: { nombre: 'Sequía', categoria: 'hidrometeorologica', icono: '🏜️', definicion: 'Ausencia prolongada de precipitaciones que causa un déficit severo de agua en el suelo y los ecosistemas.' },
  incendio_forestal: { nombre: 'Incendio forestal', categoria: 'hidrometeorologica', icono: '🔥', definicion: 'Fuego fuera de control en áreas naturales, iniciado por factores ambientales como rayos o calor extremo combinado con sequía.' },
  tormenta: { nombre: 'Tormenta severa', categoria: 'hidrometeorologica', icono: '⛈️', definicion: 'Fenómeno atmosférico que incluye granizadas, tormentas eléctricas extremas y ventiscas de nieve.' },
  ola_temperatura: { nombre: 'Ola de calor o de frío', categoria: 'hidrometeorologica', icono: '🌡️', definicion: 'Periodo prolongado con temperaturas extremadamente altas o bajas que superan los promedios normales de la región.' },

  pandemia: { nombre: 'Pandemia o epidemia', categoria: 'biologica', icono: '🦠', definicion: 'Brote masivo y descontrolado de una enfermedad infecciosa (virus o bacterias) que afecta a una población regional o global.' },
  plaga: { nombre: 'Plaga', categoria: 'biologica', icono: '🦗', definicion: 'Proliferación desmedida de insectos o animales (como las langostas) que destruyen cultivos, vegetación y fuentes de alimento.' },

  meteorito: { nombre: 'Impacto de meteorito', categoria: 'astronomica', icono: '☄️', definicion: 'Choque de cuerpos celestes o fragmentos de roca espacial contra la superficie terrestre.' },
  tormenta_solar: { nombre: 'Tormenta solar (geomagnética)', categoria: 'astronomica', icono: '☀️', definicion: 'Emisión masiva de radiación y partículas solares que impacta la magnetosfera y puede colapsar satélites y redes eléctricas.' },

  otro: { nombre: 'Otra emergencia', categoria: 'otro', icono: '⚠️', definicion: 'Evento de emergencia que no está en las categorías anteriores.' },
};

const catalogo = () => ({
  categorias: Object.entries(CATEGORIAS).map(([id, nombre]) => ({ id, nombre })),
  tipos: Object.entries(TIPOS).map(([id, t]) => ({ id, ...t })),
});

module.exports = { CATEGORIAS, TIPOS, catalogo };
