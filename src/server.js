require('dotenv').config();

if (!process.env.JWT_SECRET) {
  console.error('Falta JWT_SECRET en el archivo .env');
  process.exit(1);
}

const app = require('./app');
const port = Number(process.env.PORT) || 3000;

app.listen(port, '0.0.0.0', () => {
  if (process.env.MODO_DEMO === '1') console.warn('ATENCIÓN: MODO_DEMO activo. Se entra sin usuario ni contraseña. Desactívalo fuera de la presentación.');
  console.log(`Servidor local activo en http://localhost:${port}`);
});
