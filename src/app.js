const path = require('path');
const express = require('express');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));

app.use('/api/health', require('./routes/health'));
app.use('/api/publico', require('./routes/publico'));
app.use('/api/mapa', require('./routes/mapa'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/usuarios', require('./routes/usuarios'));
app.use('/api/roles', require('./routes/roles'));
app.use('/api/turnos', require('./routes/turnos'));
app.use('/api/asistencia', require('./routes/asistencia'));
app.use('/api/catalogo', require('./routes/catalogo'));
app.use('/api/equipos', require('./routes/equipos'));
app.use('/api/vehiculos', require('./routes/vehiculos'));
app.use('/api/flota', require('./routes/flota'));
app.use('/api/mantenimientos', require('./routes/mantenimientos'));
app.use('/api/emergencias', require('./routes/emergencias'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/desaparecidos', require('./routes/desaparecidos'));
app.use('/api/busqueda', require('./routes/busqueda'));
app.use('/api/prestamos', require('./routes/prestamos'));
app.use('/api/entregas', require('./routes/entregas'));
app.use('/api/analitica', require('./routes/analitica'));
app.use('/api/vias', require('./routes/vias'));

// Interfaz web (archivos estáticos, sin dependencias externas para funcionar sin internet)
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.status) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Ocurrió un error en el servidor. Inténtalo de nuevo.' });
});

module.exports = app;
