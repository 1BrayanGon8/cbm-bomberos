CREATE TABLE IF NOT EXISTS roles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(50) NOT NULL UNIQUE,
  descripcion VARCHAR(120) NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS permisos (
  rol_id INT NOT NULL,
  modulo VARCHAR(30) NOT NULL,
  nivel ENUM('ninguno','consulta','registro','total') NOT NULL DEFAULT 'ninguno',
  PRIMARY KEY (rol_id, modulo),
  FOREIGN KEY (rol_id) REFERENCES roles(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS turnos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(50) NOT NULL UNIQUE,
  hora_inicio TIME NOT NULL,
  hora_fin TIME NOT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 0
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS usuarios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL,
  usuario VARCHAR(50) NOT NULL UNIQUE,
  password_hash VARCHAR(100) NOT NULL,
  rol_id INT NOT NULL,
  turno_id INT NULL,
  estado ENUM('activo','inactivo') NOT NULL DEFAULT 'activo',
  situacion ENUM('en_turno','fuera_de_turno','licencia') NOT NULL DEFAULT 'fuera_de_turno',
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (rol_id) REFERENCES roles(id),
  FOREIGN KEY (turno_id) REFERENCES turnos(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS asistencia (
  id INT AUTO_INCREMENT PRIMARY KEY,
  usuario_id INT NOT NULL,
  turno_id INT NULL,
  entrada DATETIME NOT NULL,
  salida DATETIME NULL,
  INDEX idx_asistencia_usuario (usuario_id, salida),
  INDEX idx_asistencia_entrada (entrada),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
  FOREIGN KEY (turno_id) REFERENCES turnos(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ===== Épica 2: inventarios y equipos =====
CREATE TABLE IF NOT EXISTS ajustes (
  clave VARCHAR(50) PRIMARY KEY,
  valor VARCHAR(100) NOT NULL
) ENGINE=InnoDB;

-- Versión mínima de vehículos para ubicar equipos; se amplía en la Épica 3 (HU-3.7).
CREATE TABLE IF NOT EXISTS vehiculos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  codigo VARCHAR(20) NOT NULL UNIQUE,
  nombre VARCHAR(80) NOT NULL,
  tipo ENUM('maquina','ambulancia','rescate','otro') NOT NULL DEFAULT 'maquina',
  activo TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS categorias (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(60) NOT NULL UNIQUE
) ENGINE=InnoDB;

-- vehiculo_id NULL significa que el equipo está en el almacén.
CREATE TABLE IF NOT EXISTS equipos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  codigo VARCHAR(40) NOT NULL UNIQUE,
  nombre VARCHAR(120) NOT NULL,
  categoria_id INT NOT NULL,
  vehiculo_id INT NULL,
  lote_serie VARCHAR(60) NULL,
  tipo_fecha ENUM('vencimiento','recarga') NOT NULL DEFAULT 'vencimiento',
  fecha_clave DATE NULL,
  responsable_id INT NULL,
  area VARCHAR(60) NULL,
  estado ENUM('activo','en_uso','en_mantenimiento','baja') NOT NULL DEFAULT 'activo',
  fecha_ingreso DATE NOT NULL,
  INDEX idx_equipos_vehiculo (vehiculo_id),
  INDEX idx_equipos_categoria (categoria_id),
  INDEX idx_equipos_fecha (fecha_clave),
  INDEX idx_equipos_estado (estado),
  FOREIGN KEY (categoria_id) REFERENCES categorias(id),
  FOREIGN KEY (vehiculo_id) REFERENCES vehiculos(id) ON DELETE SET NULL,
  FOREIGN KEY (responsable_id) REFERENCES usuarios(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Hoja de vida: cada cambio importante de un equipo deja un evento.
CREATE TABLE IF NOT EXISTS equipo_eventos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  equipo_id INT NOT NULL,
  tipo ENUM('ingreso','edicion','traslado','estado','responsable','reporte','prestamo') NOT NULL,
  detalle VARCHAR(255) NOT NULL,
  usuario_id INT NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_eventos_equipo (equipo_id, creado_en),
  FOREIGN KEY (equipo_id) REFERENCES equipos(id) ON DELETE CASCADE,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ===== Épica 3: vehículos y mantenimientos =====
-- Los campos nuevos de vehiculos (placa, estado, km_actual, horas_actuales) los agrega scripts/init-db.js.
CREATE TABLE IF NOT EXISTS vehiculo_campos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(60) NOT NULL UNIQUE,
  tipo ENUM('texto','numero','fecha') NOT NULL DEFAULT 'texto',
  activo TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS vehiculo_campo_valores (
  vehiculo_id INT NOT NULL,
  campo_id INT NOT NULL,
  valor VARCHAR(255) NULL,
  PRIMARY KEY (vehiculo_id, campo_id),
  FOREIGN KEY (vehiculo_id) REFERENCES vehiculos(id) ON DELETE CASCADE,
  FOREIGN KEY (campo_id) REFERENCES vehiculo_campos(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS uso_vehiculo (
  id INT AUTO_INCREMENT PRIMARY KEY,
  vehiculo_id INT NOT NULL,
  km INT NULL,
  horas DECIMAL(8,1) NULL,
  usuario_id INT NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_uso_vehiculo (vehiculo_id, creado_en),
  FOREIGN KEY (vehiculo_id) REFERENCES vehiculos(id) ON DELETE CASCADE,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Frecuencia de mantenimientos y chequeos: por días, kilómetros u horas de uso.
CREATE TABLE IF NOT EXISTS planes_mantenimiento (
  id INT AUTO_INCREMENT PRIMARY KEY,
  vehiculo_id INT NOT NULL,
  nombre VARCHAR(80) NOT NULL,
  tipo ENUM('preventivo','inspeccion','chequeo') NOT NULL DEFAULT 'preventivo',
  cada_dias INT NULL,
  cada_km INT NULL,
  cada_horas INT NULL,
  ultima_fecha DATE NULL,
  ultimo_km INT NULL,
  ultimas_horas DECIMAL(8,1) NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  INDEX idx_planes_vehiculo (vehiculo_id),
  FOREIGN KEY (vehiculo_id) REFERENCES vehiculos(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS mantenimientos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  vehiculo_id INT NOT NULL,
  tipo ENUM('preventivo','correctivo','inspeccion','danos') NOT NULL,
  descripcion VARCHAR(255) NOT NULL,
  fecha DATE NOT NULL,
  hora TIME NULL,
  km INT NULL,
  horas DECIMAL(8,1) NULL,
  estado ENUM('programado','realizado','cancelado') NOT NULL DEFAULT 'realizado',
  plan_id INT NULL,
  usuario_id INT NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_mant_fecha (fecha),
  INDEX idx_mant_vehiculo (vehiculo_id, fecha),
  FOREIGN KEY (vehiculo_id) REFERENCES vehiculos(id),
  FOREIGN KEY (plan_id) REFERENCES planes_mantenimiento(id) ON DELETE SET NULL,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS llantas_cambios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  vehiculo_id INT NOT NULL,
  posicion VARCHAR(30) NOT NULL,
  fecha DATE NOT NULL,
  km INT NULL,
  horas DECIMAL(8,1) NULL,
  marca VARCHAR(60) NULL,
  notas VARCHAR(255) NULL,
  usuario_id INT NULL,
  INDEX idx_llantas_vehiculo (vehiculo_id, fecha),
  FOREIGN KEY (vehiculo_id) REFERENCES vehiculos(id) ON DELETE CASCADE,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS danos_vehiculo (
  id INT AUTO_INCREMENT PRIMARY KEY,
  vehiculo_id INT NOT NULL,
  descripcion VARCHAR(255) NOT NULL,
  estado ENUM('pendiente','atendido') NOT NULL DEFAULT 'pendiente',
  usuario_id INT NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_danos_vehiculo (vehiculo_id, estado),
  FOREIGN KEY (vehiculo_id) REFERENCES vehiculos(id) ON DELETE CASCADE,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ===== Épica 4: dashboard y emergencias =====
CREATE TABLE IF NOT EXISTS emergencias (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tipo VARCHAR(40) NOT NULL,
  ubicacion VARCHAR(160) NOT NULL,
  descripcion VARCHAR(255) NULL,
  estado ENUM('abierta','cerrada') NOT NULL DEFAULT 'abierta',
  fecha_salida DATETIME NOT NULL,
  fecha_cierre DATETIME NULL,
  creado_por INT NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_emergencias_estado (estado),
  INDEX idx_emergencias_fecha (fecha_salida),
  FOREIGN KEY (creado_por) REFERENCES usuarios(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS emergencia_unidades (
  emergencia_id INT NOT NULL,
  vehiculo_id INT NOT NULL,
  PRIMARY KEY (emergencia_id, vehiculo_id),
  FOREIGN KEY (emergencia_id) REFERENCES emergencias(id) ON DELETE CASCADE,
  FOREIGN KEY (vehiculo_id) REFERENCES vehiculos(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS emergencia_personal (
  id INT AUTO_INCREMENT PRIMARY KEY,
  emergencia_id INT NOT NULL,
  usuario_id INT NOT NULL,
  cargo ENUM('jefe_de_maquina','conductor','bombero','paramedico') NOT NULL,
  estado ENUM('confirmado','por_confirmar') NOT NULL DEFAULT 'por_confirmar',
  UNIQUE KEY uq_emergencia_usuario (emergencia_id, usuario_id),
  FOREIGN KEY (emergencia_id) REFERENCES emergencias(id) ON DELETE CASCADE,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
) ENGINE=InnoDB;

-- Equipos reportados como dañados o perdidos; generan alerta en el dashboard.
CREATE TABLE IF NOT EXISTS reportes_equipo (
  id INT AUTO_INCREMENT PRIMARY KEY,
  equipo_id INT NOT NULL,
  tipo ENUM('danado','perdido') NOT NULL,
  descripcion VARCHAR(255) NOT NULL,
  estado ENUM('pendiente','atendido') NOT NULL DEFAULT 'pendiente',
  usuario_id INT NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_reportes_equipo (equipo_id, estado),
  FOREIGN KEY (equipo_id) REFERENCES equipos(id) ON DELETE CASCADE,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ===== Épica 5: personas desaparecidas =====
CREATE TABLE IF NOT EXISTS desaparecidos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL,
  edad SMALLINT NULL,
  descripcion VARCHAR(255) NULL,
  urgencia ENUM('alta','media','seguimiento') NOT NULL DEFAULT 'media',
  estado ENUM('activo','resuelto') NOT NULL DEFAULT 'activo',
  ultima_ubicacion VARCHAR(160) NOT NULL,
  latitud DECIMAL(9,6) NULL,
  longitud DECIMAL(9,6) NULL,
  ultima_vez DATETIME NOT NULL,
  fecha_resolucion DATETIME NULL,
  foto MEDIUMBLOB NULL,
  foto_tipo VARCHAR(20) NULL,
  creado_por INT NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_desaparecidos_estado (estado, urgencia),
  FOREIGN KEY (creado_por) REFERENCES usuarios(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ===== Épica 7: préstamos de equipos =====
CREATE TABLE IF NOT EXISTS prestamos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  equipo_id INT NOT NULL,
  persona_nombre VARCHAR(100) NOT NULL,
  persona_telefono VARCHAR(30) NOT NULL,
  persona_direccion VARCHAR(160) NOT NULL,
  prestado_por INT NULL,
  fecha_prestamo DATETIME NOT NULL,
  fecha_limite DATETIME NOT NULL,
  notas VARCHAR(255) NULL,
  estado ENUM('activo','devuelto') NOT NULL DEFAULT 'activo',
  fecha_devolucion DATETIME NULL,
  condicion_devolucion ENUM('bueno','danado') NULL,
  notas_devolucion VARCHAR(255) NULL,
  recibido_por INT NULL,
  INDEX idx_prestamos_estado (estado, fecha_limite),
  INDEX idx_prestamos_equipo (equipo_id),
  FOREIGN KEY (equipo_id) REFERENCES equipos(id),
  FOREIGN KEY (prestado_por) REFERENCES usuarios(id) ON DELETE SET NULL,
  FOREIGN KEY (recibido_por) REFERENCES usuarios(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ===== Épica 8: entrega de turno y novedades =====
-- La entrega guarda una "foto" (resumen) de cómo estaba la estación en ese momento.
CREATE TABLE IF NOT EXISTS entregas_turno (
  id INT AUTO_INCREMENT PRIMARY KEY,
  turno_id INT NULL,
  turno_nombre VARCHAR(50) NULL,
  entrega_por INT NOT NULL,
  recibe_por INT NOT NULL,
  estado ENUM('pendiente','recibida') NOT NULL DEFAULT 'pendiente',
  fecha_entrega DATETIME NOT NULL,
  fecha_recepcion DATETIME NULL,
  recibido_por INT NULL,
  observaciones VARCHAR(500) NULL,
  notas_recepcion VARCHAR(255) NULL,
  resumen LONGTEXT NOT NULL,
  INDEX idx_entregas_estado (estado, recibe_por),
  INDEX idx_entregas_fecha (fecha_entrega),
  FOREIGN KEY (turno_id) REFERENCES turnos(id) ON DELETE SET NULL,
  FOREIGN KEY (entrega_por) REFERENCES usuarios(id),
  FOREIGN KEY (recibe_por) REFERENCES usuarios(id),
  FOREIGN KEY (recibido_por) REFERENCES usuarios(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS novedades (
  id INT AUTO_INCREMENT PRIMARY KEY,
  descripcion VARCHAR(500) NOT NULL,
  turno_id INT NULL,
  usuario_id INT NULL,
  entrega_id INT NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_novedades_pendientes (entrega_id, creado_en),
  FOREIGN KEY (turno_id) REFERENCES turnos(id) ON DELETE SET NULL,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL,
  FOREIGN KEY (entrega_id) REFERENCES entregas_turno(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ===== Épica 9: reporte de vías y accidentes =====
CREATE TABLE IF NOT EXISTS reportes_via (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tipo ENUM('obstruccion','accidente') NOT NULL,
  ubicacion VARCHAR(160) NOT NULL,
  latitud DECIMAL(9,6) NULL,
  longitud DECIMAL(9,6) NULL,
  descripcion VARCHAR(255) NOT NULL,
  estado ENUM('activa','despejada') NOT NULL DEFAULT 'activa',
  ocurrido_en DATETIME NOT NULL,
  emergencia_id INT NULL,
  usuario_id INT NULL,
  fecha_despeje DATETIME NULL,
  despejado_por INT NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_vias_estado (estado, tipo),
  INDEX idx_vias_fecha (ocurrido_en),
  FOREIGN KEY (emergencia_id) REFERENCES emergencias(id) ON DELETE SET NULL,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL,
  FOREIGN KEY (despejado_por) REFERENCES usuarios(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ===== Búsqueda de personas en catástrofes (portal público + bomberos) =====
-- Zonas afectadas que los bomberos marcan en el mapa (el tipo sale de src/config/catastrofes.js).
CREATE TABLE IF NOT EXISTS eventos_catastrofe (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tipo VARCHAR(30) NOT NULL,
  titulo VARCHAR(120) NOT NULL,
  descripcion VARCHAR(500) NULL,
  latitud DECIMAL(9,6) NOT NULL,
  longitud DECIMAL(9,6) NOT NULL,
  radio_m INT NOT NULL DEFAULT 1000,
  estado ENUM('activo','cerrado') NOT NULL DEFAULT 'activo',
  creado_por INT NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fecha_cierre DATETIME NULL,
  INDEX idx_eventos_estado (estado),
  FOREIGN KEY (creado_por) REFERENCES usuarios(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Reportes de posibles desaparecidos que envía el público sin iniciar sesión.
CREATE TABLE IF NOT EXISTS reportes_desaparecido (
  id INT AUTO_INCREMENT PRIMARY KEY,
  codigo VARCHAR(12) NOT NULL UNIQUE,
  evento_id INT NULL,
  nombre VARCHAR(100) NOT NULL,
  edad SMALLINT NULL,
  sexo ENUM('mujer','hombre','otro','no_se') NOT NULL DEFAULT 'no_se',
  descripcion VARCHAR(500) NULL,
  ultima_ubicacion VARCHAR(160) NULL,
  contacto_nombre VARCHAR(100) NOT NULL,
  contacto_telefono VARCHAR(30) NULL,
  contacto_correo VARCHAR(120) NULL,
  estado ENUM('nuevo','en_revision','resuelto') NOT NULL DEFAULT 'nuevo',
  notas_bomberos VARCHAR(500) NULL,
  atendido_por INT NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fecha_resolucion DATETIME NULL,
  INDEX idx_reportes_desap_estado (estado, creado_en),
  INDEX idx_reportes_desap_evento (evento_id),
  FOREIGN KEY (evento_id) REFERENCES eventos_catastrofe(id) ON DELETE SET NULL,
  FOREIGN KEY (atendido_por) REFERENCES usuarios(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Personas que los bomberos ya ubicaron; el público las ve cuando coinciden con su reporte.
CREATE TABLE IF NOT EXISTS personas_halladas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  evento_id INT NULL,
  nombre VARCHAR(100) NULL,
  tipo_persona ENUM('nino','adolescente','adulto','adulto_mayor') NOT NULL,
  edad_aprox SMALLINT NULL,
  sexo ENUM('mujer','hombre','otro','no_se') NOT NULL DEFAULT 'no_se',
  descripcion VARCHAR(500) NULL,
  condicion ENUM('ilesa','herida','hospitalizada') NOT NULL DEFAULT 'ilesa',
  ubicacion_actual VARCHAR(160) NOT NULL,
  latitud DECIMAL(9,6) NULL,
  longitud DECIMAL(9,6) NULL,
  estado ENUM('publicada','entregada') NOT NULL DEFAULT 'publicada',
  creado_por INT NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fecha_entrega DATETIME NULL,
  INDEX idx_halladas_estado (estado),
  FOREIGN KEY (evento_id) REFERENCES eventos_catastrofe(id) ON DELETE SET NULL,
  FOREIGN KEY (creado_por) REFERENCES usuarios(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ===== Turnos de 24 h: refuerzos (horas extras) =====
-- Un integrante de otro turno que trabaja horas extras en este turno, para el ciclo que inicia en "fecha" a las 8:00.
CREATE TABLE IF NOT EXISTS turno_refuerzos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  turno_id INT NOT NULL,
  usuario_id INT NOT NULL,
  fecha DATE NOT NULL,
  horas DECIMAL(4,1) NULL,
  notas VARCHAR(160) NULL,
  creado_por INT NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_refuerzo (turno_id, usuario_id, fecha),
  INDEX idx_refuerzo_fecha (fecha),
  FOREIGN KEY (turno_id) REFERENCES turnos(id) ON DELETE CASCADE,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  FOREIGN KEY (creado_por) REFERENCES usuarios(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ===== Catálogo de elementos del inventario =====
-- Cada elemento se crea una sola vez: aquí queda guardado si lleva fecha (vencimiento o recarga) y si pide serie o lote.
-- Al agregar al inventario solo se elige el elemento y se pide la cantidad y los datos que ese elemento exige.
CREATE TABLE IF NOT EXISTS catalogo_elementos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(120) NOT NULL UNIQUE,
  categoria_id INT NOT NULL,
  tiene_fecha TINYINT(1) NOT NULL DEFAULT 0,
  tipo_fecha ENUM('vencimiento','recarga') NOT NULL DEFAULT 'vencimiento',
  pide_serie TINYINT(1) NOT NULL DEFAULT 0,
  descripcion VARCHAR(255) NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (categoria_id) REFERENCES categorias(id)
) ENGINE=InnoDB;

-- Movimientos de inventario (préstamos, devoluciones, daños, pérdidas y vencidos); alimentan la analítica.
CREATE TABLE IF NOT EXISTS inventario_movimientos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  equipo_id INT NULL,
  vehiculo_id INT NULL,
  tipo ENUM('ingreso','prestamo','devolucion','danado','perdido','vencido','otro_retiro') NOT NULL,
  cantidad INT NOT NULL DEFAULT 1,
  usuario_id INT NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_mov_fecha (creado_en, tipo),
  INDEX idx_mov_equipo (equipo_id)
) ENGINE=InnoDB;

-- ===== Catálogo de mantenimientos =====
-- Cada tipo de mantenimiento o chequeo se crea una sola vez; cada vehículo lo toma de la lista y llena su propia frecuencia.
CREATE TABLE IF NOT EXISTS catalogo_mantenimientos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(80) NOT NULL UNIQUE,
  tipo ENUM('preventivo','correctivo','inspeccion','chequeo','danos') NOT NULL DEFAULT 'preventivo',
  cada_dias INT NULL,
  cada_km INT NULL,
  cada_horas INT NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ===== Registro de eliminaciones y bajas de la flota =====
-- Guarda quién eliminó o dio de baja algo, qué fue y por qué. Los datos del vehículo se copian para que el registro no dependa de él.
CREATE TABLE IF NOT EXISTS bitacora_flota (
  id INT AUTO_INCREMENT PRIMARY KEY,
  vehiculo_codigo VARCHAR(20) NULL,
  vehiculo_nombre VARCHAR(80) NULL,
  accion VARCHAR(40) NOT NULL,
  detalle VARCHAR(255) NOT NULL,
  motivo VARCHAR(255) NOT NULL,
  usuario_id INT NULL,
  usuario_nombre VARCHAR(100) NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_bitacora_fecha (creado_en),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL
) ENGINE=InnoDB;
