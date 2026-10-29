const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { bad } = require('./validar');

// Registro de lo que se elimina o se da de baja: qué, quién y por qué. No se puede editar desde la aplicación.
async function registrar({ vehiculo, accion, detalle, motivo, usuario }, conn = db) {
  await conn.query(
    `INSERT INTO bitacora_flota (vehiculo_codigo, vehiculo_nombre, accion, detalle, motivo, usuario_id, usuario_nombre)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [vehiculo ? vehiculo.codigo : null, vehiculo ? vehiculo.nombre : null, accion, String(detalle).slice(0, 255), motivo, usuario.id, usuario.nombre]
  );
}

// El motivo es obligatorio para poder eliminar o dar de baja.
function motivoDe(body) {
  const m = ((body && body.motivo) || '').trim();
  if (m.length < 5) throw bad('Escribe el motivo (mínimo 5 letras): queda registrado.');
  return m.slice(0, 255);
}

// Pide de nuevo la contraseña de quien está haciendo la acción (para dar de baja o reintegrar un vehículo).
const fallos = new Map();
async function verificarClave(req) {
  const clave = req.body && req.body.password;
  if (!clave) throw bad('Escribe tu contraseña de administrador.');
  const f = fallos.get(req.user.id);
  if (f && f.n >= 5 && Date.now() < f.hasta) throw bad('Demasiados intentos con la contraseña. Espera unos minutos.', 429);
  const [[u]] = await db.query("SELECT password_hash FROM usuarios WHERE id = ? AND estado = 'activo'", [req.user.id]);
  const ok = u && (await bcrypt.compare(String(clave), u.password_hash));
  if (!ok) {
    const n = f && Date.now() < f.hasta ? f.n + 1 : 1;
    fallos.set(req.user.id, { n, hasta: Date.now() + 10 * 60 * 1000 });
    throw bad('Contraseña incorrecta.', 403);
  }
  fallos.delete(req.user.id);
}

module.exports = { registrar, motivoDe, verificarClave };
