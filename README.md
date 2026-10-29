# Bomberos Voluntarios de Facatativá · Épicas 1 a 9 (Épicas 1 a 5: base, inventarios, vehículos y mantenimientos, dashboard y emergencias, personas desaparecidas)

API en Node.js + Express con MySQL, y una interfaz web mínima que funciona sin internet (servidor local).

## Historias incluidas

| HU | Qué hace | Dónde está |
| --- | --- | --- |
| 1.1 | Inicio de sesión por rol, menú según permisos, encabezado con nombre, rol y turno | `routes/auth.js`, `middleware/auth.js`, `public/` |
| 1.2 | Crear, editar, buscar y desactivar usuarios | `routes/usuarios.js` |
| 1.3 | Roles (Administrativo, Operativo, Jefe de máquina) y permisos por módulo | `routes/roles.js`, tabla `permisos` |
| 1.4 | Turnos y turno activo | `routes/turnos.js` |
| 1.5 | Registro de entrada y salida | `routes/asistencia.js` |
| 1.6 | Servidor local sin internet y estado del servidor | `routes/health.js`, `public/` sin CDN |

## Puesta en marcha

Requisitos: Node.js 18 o superior y MySQL 8.

```bash
npm install
cp .env.example .env      # edita DB_USER, DB_PASSWORD y JWT_SECRET
npm run db:init           # crea la base, tablas, roles, turnos y el usuario administrador
npm start                 # http://localhost:3000
```

Usuario inicial: el de `ADMIN_USUARIO` / `ADMIN_PASSWORD` del `.env` (por defecto `admin` / `Cambiar123*`). Cámbiala al entrar.

## API

Todas las rutas, salvo `health` y `login`, exigen `Authorization: Bearer <token>`.

| Método | Ruta | Permiso | Descripción |
| --- | --- | --- | --- |
| GET | `/api/health` | — | Estado del servidor y la base de datos |
| POST | `/api/auth/login` | — | `{ usuario, password }` → token, permisos, turno activo |
| GET | `/api/auth/me` | sesión | Datos de la sesión |
| GET | `/api/usuarios?q=&situacion=` | configuracion: consulta | Listado |
| GET | `/api/usuarios/resumen` | configuracion: consulta | Activos, en turno y roles |
| POST | `/api/usuarios` | configuracion: total | Crear |
| PUT | `/api/usuarios/:id` | configuracion: total | Editar (nombre, rol, turno, situación, contraseña) |
| PATCH | `/api/usuarios/:id/estado` | configuracion: total | `{ estado: "activo" \| "inactivo" }` |
| GET | `/api/roles` | configuracion: consulta | Roles, módulos y niveles |
| GET / PUT | `/api/roles/:id/permisos` | consulta / total | Ver y cambiar permisos por módulo |
| GET | `/api/turnos`, `/api/turnos/activo` | consulta / sesión | Turnos |
| POST / PUT | `/api/turnos`, `/api/turnos/:id` | configuracion: total | Crear y editar |
| POST | `/api/turnos/:id/activar` | configuracion: total | Activa un turno (solo uno a la vez) |
| POST | `/api/asistencia/entrada` y `/salida` | sesión | Marca al usuario (un administrativo puede enviar `usuario_id`) |
| GET | `/api/asistencia/mia` | sesión | ¿Tengo una entrada abierta? |
| GET | `/api/asistencia?fecha=YYYY-MM-DD` | configuracion: consulta | Control del día |

Niveles de permiso por módulo: `ninguno < consulta < registro < total`.

## Sprint 2 · Épica 2: inventarios y equipos

| HU | Qué hace | Dónde está |
| --- | --- | --- |
| 2.1 | Registrar equipo: código único, nombre, categoría, ubicación (vehículo o almacén), lote o serie, fecha clave (vencimiento o recarga) y responsable | `POST /api/equipos` |
| 2.2 | Buscar por código, equipo, lote o responsable; filtrar por ubicación, categoría y estado; paginación | `GET /api/equipos` |
| 2.3 | Estado según la fecha clave: Vigente, Atención, Disponible, Retirar de unidad, Programar recarga | `src/services/inventario.js` |
| 2.4 | Hoja de vida: datos, fecha de ingreso, responsable e historial de eventos | `GET /api/equipos/:id` |
| 2.8 | Semáforo verde, amarillo y rojo por fecha de vencimiento, con días configurables | `PUT /api/equipos/config` |
| 2.9 | Inventario por máquina o ambulancia, ordenado por categoría (manual, eléctrica, a gasolina, etc.) | `GET /api/vehiculos`, filtro `vehiculo_id` |
| 2.10 | Área y responsable por herramienta (cada cambio queda en la hoja de vida) | `PATCH /api/equipos/:id/responsable` |
| 2.11 | Estado del equipo: Activo, En uso, En mantenimiento y Dado de baja (la baja requiere permiso total) | `PATCH /api/equipos/:id/estado` |

Para actualizar una base que ya tenía el Sprint 1, ejecuta otra vez `npm run db:init` (no borra datos). Para probar el semáforo con equipos de ejemplo: `npm run db:demo`.

Los vehículos se cargan con el `db:init` (M-01, M-02, M-03, AMB-01, AMB-02, R-01) y se podrán crear y editar desde la pantalla en la Épica 3 (HU-3.7).

Reglas del semáforo: rojo si la fecha clave ya pasó, amarillo si faltan los días configurados o menos (30 por defecto), verde en los demás casos. Un equipo dado de baja no muestra semáforo y no aparece en los listados salvo que se filtre por ese estado.

| Método | Ruta | Permiso (inventarios) |
| --- | --- | --- |
| GET | `/api/equipos?q=&vehiculo_id=&categoria_id=&estado=&semaforo=&page=&limit=` | consulta (`vehiculo_id=almacen` filtra el almacén) |
| GET | `/api/equipos/opciones` | consulta |
| GET | `/api/equipos/:id` | consulta |
| POST / PUT | `/api/equipos`, `/api/equipos/:id` | registro |
| PATCH | `/api/equipos/:id/responsable`, `/api/equipos/:id/estado` | registro (baja: total) |
| PUT | `/api/equipos/config` | total |
| GET | `/api/vehiculos` | consulta |

## Sprint 3 · Épica 3: vehículos y mantenimientos

| HU | Qué hace | Dónde está |
| --- | --- | --- |
| 3.7 | Crear vehículo con campos base (código, nombre, placa, tipo) y campos personalizables que se agregan sin tocar el código | `POST /api/flota/vehiculos`, `/api/flota/campos` |
| 3.8 | Estado del vehículo: Activo, En uso, En mantenimiento y Dado de baja (conserva el historial) | `PATCH /api/flota/vehiculos/:id/estado` |
| 3.1 | Registrar mantenimiento (preventivo, correctivo, inspección, daños) con vehículo, fecha, hora, km u horas y descripción | `POST /api/mantenimientos` |
| 3.2 | Calendario mensual y próximos mantenimientos | `GET /api/mantenimientos/calendario?mes=AAAA-MM` |
| 3.3 | Estado de alistamiento: Lista, Atención o Fuera de servicio, con el próximo recordatorio | `GET /api/flota/vehiculos` |
| 3.4 | Recordatorios por días, kilómetros u horas de uso, con avisos configurables | `GET /api/flota/recordatorios`, `/api/flota/config` |
| 3.5 | Historial por vehículo (mantenimientos, llantas y daños) con filtro por tipo | `GET /api/flota/vehiculos/:id/historial` |
| 3.9 | Horas de servicio y kilometraje en cada entrada de la unidad | `POST /api/flota/vehiculos/:id/uso` |
| 3.10 | Cambio de llantas (posición, fecha, km u horas, marca) | `POST /api/flota/vehiculos/:id/llantas` |
| 3.11 | Chequeos periódicos con frecuencia propia; al marcarlos realizados quedan en el historial | `POST /api/flota/planes`, `/planes/:id/realizar` |
| 3.12 | Reporte de daños a la máquina, con estado pendiente o atendido | `POST /api/flota/vehiculos/:id/danos`, `GET /api/flota/danos` |

Para actualizar una base existente, ejecuta otra vez `npm run db:init` (agrega las tablas y columnas nuevas sin borrar datos). Para probar con datos de ejemplo: `npm run db:demo-flota`.

Reglas de alistamiento: **Fuera de servicio** si el vehículo está En mantenimiento o Dado de baja; **Atención** si tiene un recordatorio próximo o vencido, o un daño sin atender; **Lista** en los demás casos. Un recordatorio es **próximo** cuando falta el aviso configurado o menos (15 días, 500 km o 25 horas por defecto) y **vencido** cuando ya se pasó.

Permisos del módulo `mantenimientos`: consulta para ver; registro para registrar uso, llantas, daños, mantenimientos y marcar chequeos realizados; total para crear vehículos y campos, cambiar el estado del vehículo, programar chequeos y ajustar los avisos. Para que el rol Operativo pueda registrar, `db:init` le sube este módulo a `registro` una sola vez en bases creadas antes del Sprint 3.

Los reportes de daños quedan guardados con estado pendiente; la alerta en el dashboard llega con la Épica 4 (HU-4.4).

## Sprint 4 · Épica 4: dashboard y emergencias

| HU | Qué hace | Dónde está |
| --- | --- | --- |
| 4.1 | Registrar emergencia con consecutivo (EM-0001), tipo, ubicación, unidades y hora de salida; las unidades pasan a "En servicio"; se puede cerrar con hora de cierre | `POST /api/emergencias`, `PATCH /api/emergencias/:id/cerrar` |
| 4.2 | Asignar personal con su cargo (jefe de máquina, conductor, bombero, paramédico), estado Confirmado o Por confirmar y hora de salida estimada | `/api/emergencias/:id/personal`, `PATCH /api/emergencias/:id` |
| 4.3 | Resumen: vehículos operativos, en mantenimiento, alertas activas y emergencias del mes con su variación | `GET /api/dashboard` |
| 4.4 | Alertas automáticas ordenadas por criticidad, cada una con su acción directa | `src/services/alertas.js` |
| 4.5 | Estado de cada unidad: Disponible, En servicio, Fuera de servicio o Atención requerida | `GET /api/dashboard` |
| 4.6 | Reportar un equipo dañado o perdido: queda en su hoja de vida y genera una alerta | `POST /api/equipos/:id/reportes` |

Para actualizar una base existente, ejecuta otra vez `npm run db:init`.

Alertas que se generan solas: equipos vencidos o por vencer (con los días del semáforo de inventarios), mantenimientos y chequeos próximos o vencidos, daños a vehículos sin atender y equipos reportados como dañados o perdidos. Son **urgentes** las que ya vencieron o se perdieron, y esas son las que cuenta "requieren acción".

Acciones directas de cada alerta: **Retirar de unidad** (mueve el equipo al almacén), **Programar recarga** (pone el equipo en mantenimiento), **Marcar atendido** (daños y reportes), **Agendar taller** (abre Mantenimientos) y **Revisar equipo** (abre su hoja de vida).

Estado de las unidades: **En servicio** mientras una emergencia abierta la use (se libera al cerrar la emergencia, salvo que otra emergencia abierta también la use); **Fuera de servicio** si está en mantenimiento o dada de baja; **Atención requerida** si tiene recordatorios próximos o vencidos o un daño sin atender; **Disponible** en los demás casos. Solo se pueden despachar unidades en estado Activo.

Permisos del módulo `dashboard`: consulta para ver; registro para registrar emergencias, asignar personal y cerrarlas. Reportar un equipo requiere `inventarios` en registro.

## Modo demo (presentaciones)

Para mostrar el sistema sin pasar por el inicio de sesión, pon `MODO_DEMO=1` en el `.env` y reinicia (`npm start`). Al abrir el navegador se entra directo como el primer usuario Administrativo, con todos los módulos visibles. Para volver al login normal, pon `MODO_DEMO=0` o quita la línea. La base de datos y `npm run db:init` siguen siendo necesarios, porque ahí está el usuario administrador.

**No lo dejes activo fuera de la presentación:** cualquiera que abra la página entra como administrador.

## Sprint 5 · Épica 5: personas desaparecidas

| HU | Qué hace | Dónde está |
| --- | --- | --- |
| 5.1 | Registrar caso: foto, nombre, edad, descripción (ropa), última ubicación, fecha y hora y nivel de urgencia | `POST /api/desaparecidos` |
| 5.2 | Lista de casos activos ordenada por urgencia (alta, media, en seguimiento) y por la última vez visto | `GET /api/desaparecidos` |
| 5.3 | Mapa sin conexión con la última ubicación de cada caso; los marcadores llevan el mismo número que la lista | `public/desaparecidos.js`, `GET /api/desaparecidos/mapa` |
| 5.4 | Actualizar urgencia, ubicación o datos; cerrar como resuelto (o reabrir); cuenta en las estadísticas del mes | `PATCH /api/desaparecidos/:id`, `PATCH /api/desaparecidos/:id/estado` |

Para actualizar una base existente, ejecuta otra vez `npm run db:init`. Para probar con tres casos de ejemplo: `npm run db:demo-desaparecidos`.

**Sobre el mapa.** Es un mapa esquemático: ubica cada caso según sus latitud y longitud sobre una cuadrícula con centro, norte y escala, y, cuando están disponibles, dibuja debajo las calles de Facatativá (ver «Mapa de calles de Facatativá»). Sin las calles sigue funcionando como cuadrícula, sin internet. El centro y el alcance (por defecto Facatativá, Cundinamarca y 12 km) son aproximados y se ajustan desde la vista Mapa con un usuario Administrativo. Para marcar la ubicación al registrar un caso se toca el mapa; también se puede registrar sin coordenadas.

**Fotos.** Se reducen en el navegador (máximo 640 px) y se guardan en la base de datos de este servidor. Solo se pueden ver con una sesión iniciada. Son datos sensibles, sobre todo cuando se trata de menores: conviene limitar quién tiene acceso al módulo.

Permisos del módulo `desaparecidos`: consulta para ver; registro para registrar, actualizar y cerrar casos; total para ajustar el centro del mapa. El Dashboard ahora muestra la tarjeta de desaparecidos activos.

## Épica 7: préstamos de equipos

| HU | Qué hace | Dónde está |
| --- | --- | --- |
| 7.1 | Registrar préstamo: equipo, nombre, teléfono y dirección de quien recibe, tiempo del préstamo y quién lo prestó; el equipo pasa a "En uso" | `POST /api/prestamos` |
| 7.2 | Registrar la devolución con el estado en que regresa; el equipo vuelve a "Activo" | `PATCH /api/prestamos/:id/devolver` |
| 7.3 | Préstamos activos y vencidos con el tiempo restante; los vencidos salen en rojo y generan una alerta en el dashboard | `GET /api/prestamos`, `src/services/alertas.js` |
| 7.4 (parcial) | Historial: el listado se filtra por Devueltos o Todos y se busca por equipo, código, persona o teléfono | `GET /api/prestamos?estado=&q=` |

Para actualizar una base existente, ejecuta otra vez `npm run db:init`. Agrega el módulo **Préstamos** a los permisos (Administrativo: total, Operativo: registro, Jefe de máquina: consulta) y la tabla `prestamos`.

Reglas: solo se pueden prestar equipos en estado **Activo** (no los que están En uso, En mantenimiento o Dados de baja, así un mismo equipo no se presta dos veces). El tiempo del préstamo se escribe en horas o días y de ahí se calcula la fecha límite. Si el equipo regresa **con daños**, se crea automáticamente un reporte de equipo dañado (aparece como alerta en el dashboard). Cada préstamo y cada devolución quedan en la hoja de vida del equipo.

Permisos del módulo `prestamos`: consulta para ver; registro para registrar préstamos y devoluciones.

## Épica 8: entrega de turno y novedades

| HU | Qué hace | Dónde está |
| --- | --- | --- |
| 8.1 | Entregar el turno con un resumen de la estación (unidades, equipos y daños reportados, préstamos, emergencias, novedades); queda con hora y firma de quien entrega y de quien recibe | `POST /api/entregas`, `PATCH /api/entregas/:id/recibir` |
| 8.2 | Registrar novedades durante el turno (descripción, fecha, hora y autor); pasan a la entrega cuando se envía | `POST /api/entregas/novedades` |
| 8.3 | Historial de entregas con filtro por fecha y turno; cada entrega se abre completa | `GET /api/entregas`, `GET /api/entregas/:id` |

Para actualizar una base existente, ejecuta otra vez `npm run db:init`. Agrega el módulo **Entrega de turno** a los permisos (Administrativo: total, Operativo y Jefe de máquina: registro) y las tablas `entregas_turno` y `novedades`.

**Cómo funciona la firma.** Quien entrega es la persona con la sesión iniciada. Al enviar, elige quién recibe y queda como *Pendiente*. La otra persona entra con su propia cuenta, ve el aviso "Turnos que te entregaron y debes recibir" y confirma con un botón; ahí queda su hora. Un administrativo puede confirmar en su nombre y queda anotado quién lo hizo. No se pide contraseña extra porque cada persona ya se identificó al iniciar sesión.

**Qué incluye el resumen.** Se guarda tal como estaba en el momento de la entrega, así que no cambia aunque la estación cambie después. Contiene el estado de cada unidad con su aviso, equipos reportados como dañados o perdidos, daños de vehículos sin atender, préstamos activos (con los vencidos marcados), emergencias abiertas, novedades del turno y cuántas alertas urgentes había. Las novedades que entran en una entrega quedan asociadas a ella y no vuelven a aparecer en la siguiente.

Permisos del módulo `entregas`: consulta para ver; registro para anotar novedades, entregar y recibir turnos.

## Épica 6: analítica operativa y reportes

| HU | Qué hace | Dónde está |
| --- | --- | --- |
| 6.1 | Elegir el periodo (por defecto, los últimos 30 días; atajos de 7, 30 y 90 días); todo se recalcula | `GET /api/analitica?desde=&hasta=` |
| 6.2 | Indicadores: emergencias, respuesta promedio frente a la meta, inventario vigente y casos resueltos, con su variación | `src/services/analitica.js` |
| 6.3 | Exportar a Excel y a PDF el periodo elegido | `GET /api/analitica/excel`, `GET /api/analitica/pdf` |
| 6.4 | Gráficas: emergencias por semana, tiempos de respuesta, estado del inventario, mantenimiento por tipo y disponibilidad de flota | `public/analitica.js` |
| 6.5 | Casos de desaparecidos: resueltos, activos y porcentaje de resolución | `public/analitica.js` |

Después de actualizar, ejecuta `npm install` (se agregan `exceljs` y `pdfkit` para los archivos) y `npm run db:init`. Para ver la pantalla con datos de ejemplo: `npm run db:demo-analitica`.

**Cómo se calcula cada cosa**

- **Periodo anterior:** es el tramo inmediatamente anterior con la misma cantidad de días. La variación de emergencias y de casos resueltos se calcula contra él.
- **Tiempo de respuesta:** desde que se registra la emergencia hasta la hora de salida de la unidad. El sistema no tiene una hora de llegada al sitio, así que mide la salida, no la llegada. Se ignoran los valores negativos o de más de 6 horas (emergencias registradas mucho después del hecho). Para que el dato sea útil, la emergencia debe registrarse cuando entra el aviso. La meta por defecto es 8 minutos y la ajusta un administrativo desde la misma pantalla.
- **Inventario vigente:** estado de hoy. Vigente es el verde del semáforo, por vencer el amarillo y crítico el rojo (vencido); los equipos dados de baja no cuentan.
- **Disponibilidad de la flota:** estado de hoy. Operativa es toda unidad que no está fuera de servicio.
- **Mantenimiento por tipo:** mantenimientos del periodo que no están cancelados. Los daños reportados desde Flota se cuentan aparte, no aquí.
- **Porcentaje de resolución:** casos resueltos en el periodo entre (resueltos en el periodo + activos hoy).

Permisos del módulo `analitica`: consulta para ver y exportar; total para ajustar la meta. Por defecto el Jefe de máquina no ve este módulo.

## Épica 9: reporte de vías y accidentes

| HU | Qué hace | Dónde está |
| --- | --- | --- |
| 9.1 | Reportar una obstrucción en la vía: ubicación, descripción, fecha y hora y autor; queda "Activa" | `POST /api/vias` |
| 9.2 | Reportar un accidente: ubicación, descripción, fecha y hora y autor; se puede vincular a una emergencia abierta | `POST /api/vias` (con `emergencia_id`) |
| 9.3 | Mapa con las obstrucciones y los accidentes activos; el rombo es obstrucción y el círculo, accidente | `public/vias.js` |
| 9.4 | Marcar un reporte como despejado (o volver a activarlo); queda en el historial con quién y cuándo | `PATCH /api/vias/:id/estado` |

Para actualizar una base existente, ejecuta otra vez `npm run db:init`. Agrega el módulo **Vías y accidentes** a los permisos (Administrativo: total; Operativo y Jefe de máquina: registro) y la tabla `reportes_via`. Para ver la pantalla con tres reportes de ejemplo: `npm run db:demo-vias`.

Los reportes activos aparecen como alertas en el Dashboard (el accidente con prioridad "Atención" y la obstrucción como "Revisar") y llevan al módulo con el botón "Ver vías". Se filtra por activos, despejados o todos y por tipo. Usa el mismo mapa de calles de Facatativá de Personas desaparecidas (zoom, arrastre y su mismo centro): cada reporte es una zona pequeña con su ícono, 🚧 para obstrucciones y 🚗 para accidentes, y al tocarlo se resalta su tarjeta en la lista.

Permisos del módulo `vias`: consulta para ver; registro para reportar y marcar como despejado.

## Mapa de calles de Facatativá

Debajo de cada mapa del sistema (Personas desaparecidas, Vías y accidentes y la página pública de búsqueda) se dibujan las calles de Facatativá. El navegador pide las imágenes al propio servidor (`/api/mapa/tiles/...`); el servidor las baja del proveedor de mapas (OpenStreetMap por defecto), **las guarda en la carpeta `data/tiles/`** y desde ahí las sirve. Lo que ya se descargó una vez se sigue viendo **sin internet**. Si una zona no está guardada y no hay internet, esa parte queda solo con la cuadrícula de siempre y el resto del mapa funciona igual.

**Para tener el mapa listo sin conexión**, con internet ejecuta una vez:

```powershell
npm run mapa:descargar
```

Por defecto baja unas 160 imágenes: radio de 6 km alrededor del centro del mapa, con zoom de 12 a 15 (de la vista general hasta las calles). Para cambiar el área: `npm run mapa:descargar -- --radio=8 --zmax=16`. Lo que ya está guardado no se vuelve a pedir, y si algo falla basta con repetir el comando. Además, cualquier zona que se mire en el mapa con internet queda guardada sola. Para llevar el mapa a otro equipo, copia la carpeta `data/tiles`.

**Condiciones del proveedor.** OpenStreetMap permite un uso ligero y pide no hacer descargas masivas; por eso el comando limita la cantidad de imágenes. Si el cliente va a usar el mapa de forma intensiva, conviene un proveedor propio o de pago: se cambia con `MAPA_TILES_URL` en el `.env` (con `{z}`, `{x}` y `{y}`). El mapa muestra la atribución «© OpenStreetMap contributors», que debe mantenerse.

**Seguridad.** La ruta de imágenes es pública porque la página de búsqueda del público también dibuja el mapa. Solo entrega imágenes de la zona (hasta 60 km del centro del mapa, zoom de 8 a 18) y solo guarda respuestas que realmente sean imágenes. El centro del mapa se ajusta en Personas desaparecidas con un usuario Administrativo; si se cambia a otra región, se descarga de nuevo con `npm run mapa:descargar`.

## Escudo (logo)

El escudo de los Bomberos Voluntarios de Facatativá está en `public/img/logo.png` (portada y tarjeta de inicio de sesión, menú lateral y página pública de búsqueda) y `public/img/favicon.png` (ícono de la pestaña). Para cambiarlo, reemplaza esos dos archivos conservando el nombre: el PNG con fondo transparente se ve bien sobre el menú oscuro. Mide unos 350 px de alto, suficiente para pantallas de alta densidad.

## Pendiente para los siguientes sprints

- HU-1.7 copias de seguridad (el campo `ultimaCopia` de `/api/health` ya está reservado).
- Pantalla para editar permisos por rol (la API ya existe).
- Épica 7: enlace al historial de préstamos desde la hoja de vida del equipo (parte de HU-7.4, importancia S).
- Épica 5, importancia S: vincular casos a emergencias y recorridos (HU-5.5), historial de ubicaciones (HU-5.6), tiempo medio de activación (HU-5.7) y convenciones en los reportes (HU-5.8).
- Épica 4: actividad reciente (HU-4.7, importancia S) y la alerta de stock bajo (el inventario aún no maneja cantidades).
- Épica 3, importancia S: marcar el vehículo fuera de servicio automáticamente con un correctivo (HU-3.6). Editar un vehículo ya existe en la API (`PUT /api/flota/vehiculos/:id`) pero aún no tiene botón.
- Épica 2, importancia S: indicadores del inventario (HU-2.5), verificación (HU-2.6) y traslados con registro propio (HU-2.7).
- Límite de intentos de inicio de sesión y registro de auditoría (HU-1.10).


## Cambios recientes

**Portal público de búsqueda de personas** (`/buscar.html`, sin iniciar sesión). Los bomberos marcan en *Personas desaparecidas → Mapa y eventos* cada catástrofe (tipo, título, qué ocurrió y radio); aparece como zona roja con su dibujo y, al pasar el cursor, dice qué sucedió. El público solo puede tocar una zona marcada, dejar los datos de la persona y de contacto, y recibe un código de seguimiento con la lista de personas halladas parecidas (si los bomberos las publicaron) y dónde están. Los bomberos ven cuántos reportes hay (tarjeta, pestaña y alerta en el dashboard) y publican personas halladas con su tipo y ubicación. `npm run db:demo-busqueda` carga un ejemplo.

**Turnos de 24 h.** Alfa, Bravo, Charlie y Delta: reciben a las 8:00 y entregan a las 8:00 del día siguiente. Cada integrante tiene su turno (se cambia en Configuración) y se puede sumar a alguien de otro turno como *horas extras*. Al entregar y al recibir hay observaciones; al recibir, el turno de quien recibe pasa a ser el activo.

**Inventario por unidad.** Al elegir un vehículo o el almacén se despliega todo lo que tiene, por categoría, con cantidad, sitio y estado. Se puede agregar elementos o unidades y quitarlos indicando el porqué (si es daño o pérdida, genera alerta). La búsqueda es por nombre. `npm run db:inventario-real` carga el listado real de la estación (bodega, MB02 y RAM).

Después de actualizar, ejecuta `npm run db:init` una vez para aplicar los cambios a la base de datos.


## Catálogo de elementos, préstamos por nombre y estados de vehículos

| Qué | Cómo funciona | Dónde está |
| --- | --- | --- |
| Catálogo | Cada elemento se crea una sola vez: nombre, categoría, si lleva fecha (vencimiento o recarga) y si pide serie o lote. Al agregar al inventario se busca por nombre, se elige y se pide la cantidad y solo lo que ese elemento exige | `routes/catalogo.js`, `public/combo.js`, `public/inventarios.js` |
| Agregar | Si ya hay una fila igual (misma ubicación, sitio, serie, fecha y estado) la cantidad se suma | `POST /api/equipos` |
| Préstamos | Se elige por nombre de una lista con búsqueda (elementos con unidades disponibles y vehículos activos). Al prestar un elemento se descuenta la cantidad; un vehículo sale prestado con todo lo que lleva | `routes/prestamos.js`, `public/prestamos.js` |
| Devolución | Elemento: unidades buenas / dañadas / perdidas (solo las buenas vuelven al inventario; las otras generan reporte y alerta). Vehículo: bueno vuelve a Activo; dañado o en revisión queda Temporalmente inactivo | `PATCH /api/prestamos/:id/devolver` |
| Retiros | Daño, pérdida, vencido, consumo, etc. restan del inventario y quedan en la analítica | `POST /api/equipos/:id/quitar` |
| Vehículos | Estados nuevos: Prestado y Temporalmente inactivo (no salen a emergencias ni se prestan) | `routes/flota.js`, `services/flota.js` |
| Analítica | Unidades vigentes / por vencer / críticas, unidades prestadas, y movimientos del periodo (prestadas, devueltas, dañadas, perdidas, vencidas); también en Excel y PDF | `services/analitica.js` |

Después de actualizar, ejecuta `npm run db:init` una vez: crea las tablas nuevas, agrega las columnas y llena el catálogo con los nombres de elementos que ya tenías.


## Mantenimientos por vehículo, calendario completo y eliminar vehículo

| Qué | Cómo funciona | Dónde está |
| --- | --- | --- |
| Catálogo de mantenimientos | Se elige de una lista con búsqueda (cambio de aceite, frenos…) o se crea uno nuevo, que queda para todos los vehículos | `GET/POST /api/flota/catalogo-mantenimientos` |
| Agregar y quitar | Cada vehículo tiene su botón **Mantenimientos**: agrega uno de la lista con su propia frecuencia (días, km u horas) y la última vez que se hizo, o lo quita. Quitar no borra el historial | `POST /api/flota/planes`, `DELETE /api/flota/planes/:id` |
| Recurrentes | Con "cada 60 días" el recordatorio sale en el calendario cada 60 días. Al marcarlo como realizado la cuenta vuelve a empezar desde la fecha en que se hizo; si no se marca, queda como vencido | `GET /api/mantenimientos/calendario` |
| Calendario | Muestra mantenimientos realizados y programados, daños (día en que ocurrieron y día en que se repararon), cambios de llantas y recordatorios. Al tocar un día se ve el detalle | `public/mantenimientos.js` |
| Eliminar / reintegrar vehículo | Solo con permiso total (administrador): una ventana pregunta si desea eliminarlo y pide motivo y la contraseña del administrador. Sus elementos pasan al Almacén. Reintegrar pide lo mismo y el vehículo vuelve sin los elementos que tenía | `POST /api/flota/vehiculos/:id/baja`, `/reintegrar` |
| Eliminar mantenimientos, llantas y km | Se pueden eliminar (el historial no se edita). Siempre piden el motivo y queda registrado quién lo hizo | `DELETE /api/flota/planes/:id`, `/llantas/:id`, `/uso/:id` |
| Registro | Tabla `bitacora_flota`: fecha, quién, vehículo, qué y por qué. El administrador la ve al final de la pestaña Flota | `GET /api/flota/bitacora` |

Ejecuta `npm run db:init` una vez: crea el catálogo de mantenimientos (con algunos básicos y los que ya tenías programados) y la fecha de reparación de daños.

Las llantas ya no tienen botón aparte: son un tema de **Mantenimientos** como SOAT, técnico-mecánica o cambio de aceite. Cada vehículo tiene su lista; se agregan desde una lista desplegable (o se crean nuevos) y se pregunta si es recurrente, cada cuántos días, km u horas (todo opcional). Los cambios de llantas registrados antes siguen apareciendo en el historial y el calendario.
