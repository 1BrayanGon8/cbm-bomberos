// Mantiene el catálogo de elementos al día: crea un elemento por cada nombre de equipo que aún no esté
// y enlaza cada equipo con su elemento. Lo usan init-db y los scripts que cargan inventario.
async function sincronizarCatalogo(conn) {
  await conn.query(
    `INSERT IGNORE INTO catalogo_elementos (nombre, categoria_id, tiene_fecha, tipo_fecha, pide_serie)
     SELECT nombre, MIN(categoria_id), MAX(fecha_clave IS NOT NULL), MIN(tipo_fecha), MAX(lote_serie IS NOT NULL) FROM equipos GROUP BY nombre`
  );
  await conn.query('UPDATE equipos e JOIN catalogo_elementos c ON c.nombre = e.nombre SET e.catalogo_id = c.id WHERE e.catalogo_id IS NULL');
}

module.exports = { sincronizarCatalogo };
