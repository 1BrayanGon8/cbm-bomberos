const codigo = (id) => 'EM-' + String(id).padStart(4, '0');

const SELECT = `SELECT e.id, e.tipo, e.ubicacion, e.descripcion, e.estado, e.fecha_salida, e.fecha_cierre, u.nombre AS creado_por,
    (SELECT GROUP_CONCAT(v.codigo ORDER BY v.codigo SEPARATOR ', ')
       FROM emergencia_unidades eu JOIN vehiculos v ON v.id = eu.vehiculo_id WHERE eu.emergencia_id = e.id) AS unidades,
    (SELECT COUNT(*) FROM emergencia_personal p WHERE p.emergencia_id = e.id) AS personal_total,
    (SELECT COUNT(*) FROM emergencia_personal p WHERE p.emergencia_id = e.id AND p.estado = 'confirmado') AS personal_confirmado
  FROM emergencias e LEFT JOIN usuarios u ON u.id = e.creado_por`;

const mapear = (e) => ({ ...e, codigo: codigo(e.id), personal_total: Number(e.personal_total), personal_confirmado: Number(e.personal_confirmado) });

module.exports = { codigo, SELECT, mapear };
