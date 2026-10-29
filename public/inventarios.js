(() => {
  window.CBM = window.CBM || {};
  window.CBM.vistas = window.CBM.vistas || {};

  const ESTADOS = { activo: 'Activo', en_uso: 'En uso', en_mantenimiento: 'En mantenimiento', baja: 'Dado de baja' };
  const COLOR = { verde: 'verde', amarillo: 'ambar', rojo: 'rojo' };
  const ESTADO_VEH = { prestado: ['Prestado', 'prestado'], inactivo_temporal: ['Temporalmente inactivo', 'inactivo'], en_mantenimiento: ['En mantenimiento', 'inactivo'], en_uso: ['En servicio', 'prestado'] };
  const TIPO_EVENTO = { ingreso: 'Ingreso', edicion: 'Edición', traslado: 'Traslado', estado: 'Estado', responsable: 'Responsable', reporte: 'Reporte', prestamo: 'Préstamo', cantidad: 'Se agregó', retiro: 'Se quitó' };
  let raiz = null;
  let opciones = null;
  let filtros = {};
  let detalleId = null;

  const fecha = (f) => (f ? f.split('-').reverse().join('/') : '—');
  const plazo = (d) => (d === null || d === undefined ? '' : d < 0 ? `venció hace ${-d} d` : d === 0 ? 'vence hoy' : `en ${d} d`);
  const opts = (lista, valor, etiqueta, sel) => lista.map((o) => `<option value="${o[valor]}"${String(o[valor]) === String(sel ?? '') ? ' selected' : ''}>${CBM.esc(o[etiqueta])}</option>`).join('');
  const nombreUnidad = (id) => (id === 'almacen' ? 'Almacén' : (opciones.vehiculos.find((v) => String(v.id) === String(id)) || {}).nombre || '');

  window.CBM.vistas.inventarios = async (el) => {
    raiz = el;
    opciones = await CBM.api('/equipos/opciones');
    filtros = { page: 1 };
    detalleId = null;
    armar();
    await cargarLista();
  };

  // Lo usa el dashboard para abrir un equipo desde una alerta
  window.CBM.abrirEquipo = async (id) => { await CBM.abrirModulo('inventarios'); await abrirDetalle(id); };

  function armar() {
    const { puede } = CBM;
    raiz.innerHTML = `
      <div id="inv-unidades" class="unidades"></div>
      <div class="panel">
        <div class="barra">
          <input id="f-q" type="search" placeholder="Buscar por nombre (ej. motobomba, hacha, camilla)" aria-label="Buscar por nombre">
          <select id="f-vehiculo" aria-label="Vehículo o almacén"><option value="">Todas las ubicaciones</option><option value="almacen">Almacén</option>${opts(opciones.vehiculos, 'id', 'nombre')}</select>
          <select id="f-categoria" aria-label="Categoría"><option value="">Todas las categorías</option>${opts(opciones.categorias, 'id', 'nombre')}</select>
          <select id="f-estado" aria-label="Estado"><option value="">Estados activos</option>${Object.entries(ESTADOS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
          ${puede('inventarios', 'registro') ? '<button id="inv-nuevo" class="btn primario">Agregar elemento</button>' : ''}
        </div>
        <div id="inv-lista"></div>
      </div>
      ${puede('inventarios', 'total') ? `<form id="form-semaforo" class="panel fila-acciones">
        <span>El semáforo de fechas pasa a amarillo cuando faltan</span>
        <input id="f-dias" type="number" min="1" max="365" value="${opciones.dias_por_vencer}" style="width:80px" aria-label="Días para vencer">
        <span>días o menos.</span><button class="btn" type="submit">Guardar</button></form>` : ''}
      <div id="inv-detalle"></div>`;

    const q = raiz.querySelector('#f-q');
    let esperaQ = null;
    q.addEventListener('input', () => { clearTimeout(esperaQ); esperaQ = setTimeout(() => { filtros.q = q.value.trim(); filtros.page = 1; cargarLista(); }, 300); });
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(esperaQ); filtros.q = q.value.trim(); filtros.page = 1; cargarLista(); } });
    q.addEventListener('search', () => { filtros.q = q.value.trim(); filtros.page = 1; cargarLista(); });
    [['f-vehiculo', 'vehiculo_id'], ['f-categoria', 'categoria_id'], ['f-estado', 'estado']].forEach(([id, clave]) => {
      raiz.querySelector('#' + id).addEventListener('change', (e) => { filtros[clave] = e.target.value; filtros.page = 1; cargarLista(); });
    });
    raiz.querySelector('#inv-nuevo')?.addEventListener('click', () => formularioNuevo());
    raiz.querySelector('#form-semaforo')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const r = await CBM.api('/equipos/config', { method: 'PUT', body: { dias_por_vencer: Number(raiz.querySelector('#f-dias').value) } });
        opciones.dias_por_vencer = r.dias_por_vencer;
        CBM.aviso('Semáforo actualizado.');
        await cargarLista();
      } catch (err) { CBM.aviso(err.message, true); }
    });
    raiz.querySelector('#inv-unidades').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-veh]');
      if (!b) return;
      filtros.vehiculo_id = filtros.vehiculo_id === b.dataset.veh ? '' : b.dataset.veh;
      filtros.page = 1;
      raiz.querySelector('#f-vehiculo').value = filtros.vehiculo_id;
      raiz.querySelector('#inv-detalle').innerHTML = '';
      cargarLista();
    });
    raiz.querySelector('#inv-lista').addEventListener('click', alClicLista);
  }

  async function alClicLista(e) {
    const pag = e.target.closest('button[data-pag]');
    if (pag) { filtros.page = Number(pag.dataset.pag); cargarLista(); return; }
    const acc = e.target.closest('button[data-acc]');
    if (acc) { e.stopPropagation(); await accionFila(acc.dataset.acc, acc.dataset.id); return; }
    const fila = e.target.closest('[data-id]');
    if (fila && !e.target.closest('summary')) abrirDetalle(fila.dataset.id);
  }

  async function accionFila(acc, id) {
    try {
      const e = await CBM.api('/equipos/' + id);
      if (acc === 'mas') formAgregar(e); else if (acc === 'menos') formQuitar(e); else await abrirDetalle(id);
    } catch (err) { CBM.aviso(err.message, true); }
  }

  const chipEstado = (e) => `<span class="chip ${e.semaforo ? COLOR[e.semaforo] : ''}">${CBM.esc(e.estado_fecha)}</span>${e.estado !== 'activo' && e.estado !== 'baja' ? `<small>${ESTADOS[e.estado]}</small>` : ''}${e.prestadas > 0 ? `<small><span class="chip ambar">${e.prestadas} prestada(s)</span></small>` : ''}${e.vehiculo_estado === 'prestado' ? '<small><span class="chip ambar">Prestado con el vehículo</span></small>' : ''}${e.vehiculo_estado === 'inactivo_temporal' ? '<small><span class="chip rojo">Vehículo temporalmente inactivo</span></small>' : ''}`;

  async function cargarLista() {
    const { esc, puede } = CBM;
    try {
      const porUnidad = !!filtros.vehiculo_id;
      const qs = new URLSearchParams(Object.entries({ ...filtros, ...(porUnidad ? { limit: 100, page: 1 } : {}) }).filter(([, v]) => v !== '' && v !== undefined)).toString();
      const [lista, unidades] = await Promise.all([CBM.api('/equipos?' + qs), CBM.api('/vehiculos')]);

      const tarjeta = (id, nombre, u) => `<button class="unidad${String(filtros.vehiculo_id) === String(id) ? ' activa' : ''}" data-veh="${id}">
          <strong>${esc(nombre)}</strong>${ESTADO_VEH[u.estado] ? `<span class="estado-veh ${ESTADO_VEH[u.estado][1]}">${ESTADO_VEH[u.estado][0]}</span>` : ''}<span>${u.equipos} unidades · ${u.tipos} elementos${u.prestadas ? ` · ${u.prestadas} prestadas` : ''}</span>
          <span>${u.vencidos ? `<i class="sem rojo"></i>${u.vencidos} ` : ''}${u.por_vencer ? `<i class="sem amarillo"></i>${u.por_vencer}` : ''}${!u.vencidos && !u.por_vencer ? '<i class="sem verde"></i>Al día' : ''}</span></button>`;
      raiz.querySelector('#inv-unidades').innerHTML =
        unidades.vehiculos.map((v) => tarjeta(v.id, v.nombre, v)).join('') + tarjeta('almacen', 'Almacén', unidades.almacen);

      const cont = raiz.querySelector('#inv-lista');
      if (!lista.equipos.length) {
        cont.innerHTML = '<p class="vacio">No hay elementos con esos filtros. Cambia la búsqueda o agrega un elemento nuevo.</p>';
        return;
      }
      const reg = puede('inventarios', 'registro');

      // Una unidad seleccionada: lista desplegable con todo lo que tiene, agrupado por categoría
      if (porUnidad) {
        const grupos = {};
        lista.equipos.forEach((e) => { (grupos[e.categoria] = grupos[e.categoria] || []).push(e); });
        const filas = (e) => `<div class="inv-fila" data-id="${e.id}">
            <div class="nombre fila-click" tabindex="0"><strong>${esc(e.nombre)}</strong><small>${esc([e.descripcion, e.lote_serie ? 'Serie ' + e.lote_serie : ''].filter(Boolean).join(' · ') || '—')}</small></div>
            <div class="cant" title="Cantidad disponible">${e.cantidad}${e.prestadas ? `<small>+${e.prestadas} prestadas</small>` : ''}</div>
            <div class="donde"><small>${esc(e.area || 'Sin ubicación específica')}</small>${e.fecha_clave ? `<small>${fecha(e.fecha_clave)} · ${plazo(e.dias_restantes)}</small>` : ''}</div>
            <div class="inv-acciones">${chipEstado(e)}${reg ? `<button class="btn chico" data-acc="mas" data-id="${e.id}" title="Agregar unidades">＋ Agregar</button><button class="btn chico" data-acc="menos" data-id="${e.id}" title="Quitar unidades">－ Quitar</button>` : ''}</div></div>`;
        cont.innerHTML = `<div class="inv-unidad">
          ${avisoUnidad(unidades)}
          <div class="inv-cab"><h3>${esc(nombreUnidad(filtros.vehiculo_id))} · ${lista.unidades} unidades en ${lista.total} elementos${lista.prestadas ? ` (${lista.prestadas} prestadas)` : ''}</h3>
            ${reg ? `<button class="btn primario" id="inv-nuevo-aqui">Agregar a ${esc(nombreUnidad(filtros.vehiculo_id))}</button>` : ''}</div>
          ${Object.entries(grupos).map(([cat, items], i) => `<details class="inv-cat"${i === 0 || filtros.q ? ' open' : ''}><summary><span>${esc(cat)}</span><small>${items.reduce((s, x) => s + x.cantidad, 0)} unidades</small></summary>${items.map(filas).join('')}</details>`).join('')}
        </div>`;
        cont.querySelector('#inv-nuevo-aqui')?.addEventListener('click', () => formularioNuevo(filtros.vehiculo_id));
        return;
      }

      // Sin unidad seleccionada: tabla general
      const filas = lista.equipos.map((e) => `<tr class="fila-click" data-id="${e.id}" tabindex="0">
          <td><strong>${esc(e.nombre)}</strong><small>${esc(e.descripcion || '')}</small></td>
          <td><strong>${e.cantidad}</strong>${e.prestadas ? `<small>+${e.prestadas} prestadas</small>` : ''}</td><td>${esc(e.categoria)}</td>
          <td>${esc(e.ubicacion === 'Almacén' ? 'Almacén' : (opciones.vehiculos.find((v) => v.id === e.vehiculo_id) || {}).nombre || e.ubicacion)}<small>${esc(e.area || '')}</small></td>
          <td>${e.fecha_clave ? `${fecha(e.fecha_clave)}<small>${e.tipo_fecha === 'recarga' ? 'Recarga · ' : ''}${plazo(e.dias_restantes)}</small>` : '—'}</td>
          <td>${chipEstado(e)}</td></tr>`).join('');
      const paginas = Math.max(Math.ceil(lista.total / lista.limit), 1);
      cont.innerHTML = `<div class="tabla-wrap"><table><thead><tr><th>Elemento</th><th>Cant.</th><th>Categoría</th><th>Ubicación</th><th>Fecha clave</th><th>Estado</th></tr></thead><tbody>${filas}</tbody></table></div>
           <div class="paginacion"><small>Mostrando ${lista.equipos.length} de ${lista.total} elementos (${lista.unidades} unidades${lista.prestadas ? ` y ${lista.prestadas} prestadas` : ''}). Toca una tarjeta de arriba para ver todo lo que tiene un vehículo o el almacén.</small><span>
             <button class="btn" data-pag="${lista.page - 1}" ${lista.page <= 1 ? 'disabled' : ''}>Anterior</button>
             <small>Página ${lista.page} de ${paginas}</small>
             <button class="btn" data-pag="${lista.page + 1}" ${lista.page >= paginas ? 'disabled' : ''}>Siguiente</button></span></div>`;
    } catch (err) { CBM.aviso(err.message, true); }
  }

  function avisoUnidad(unidades) {
    const v = unidades.vehiculos.find((x) => String(x.id) === String(filtros.vehiculo_id));
    if (!v) return '';
    if (v.estado === 'prestado') return '<div class="aviso-info"><strong>Vehículo prestado.</strong> Salió con todos los elementos de esta lista; vuelven cuando se registre la devolución en Préstamos.</div>';
    if (v.estado === 'inactivo_temporal') return '<div class="aviso-info"><strong>Vehículo temporalmente inactivo</strong> (dañado o en revisión). No sale a emergencias ni se presta hasta que vuelva a estar Activo.</div>';
    return '';
  }

  const ir = () => raiz.querySelector('#inv-detalle').scrollIntoView({ behavior: 'smooth', block: 'start' });
  const cancelar = () => { raiz.querySelector('#inv-detalle').innerHTML = ''; };

  // ---------- Agregar al inventario: se busca el elemento por nombre; si no existe, se crea una sola vez ----------
  function formularioNuevo(vehiculoId) {
    detalleId = null;
    const { esc } = CBM;
    const pre = vehiculoId === undefined ? filtros.vehiculo_id : vehiculoId;
    let sel = null; // elemento del catálogo elegido
    raiz.querySelector('#inv-detalle').innerHTML = `
      <form id="form-equipo" class="panel"><h3>Agregar elemento al inventario</h3>
        <div class="campo"><span>Nombre del elemento (busca por nombre)</span>
          <input id="el-buscar" maxlength="120" placeholder="Escribe para buscar: motobomba, hacha, camilla…" aria-label="Buscar elemento por nombre"></div>
        <small>Si el elemento ya existe, elígelo de la lista y solo escribe la cantidad. Si no existe, la lista te ofrece crearlo.</small>

        <div id="bloque-crear" class="bloque-crear" hidden>
          <strong>Crear elemento nuevo</strong>
          <div class="form-grid cols2">
            <label>Nombre<input name="nuevo_nombre" maxlength="120"></label>
            <label>Categoría<select name="nuevo_categoria">${opts(opciones.categorias, 'id', 'nombre')}</select></label>
            <label>¿Tiene fecha?<select name="nuevo_fecha"><option value="">No tiene fecha</option><option value="vencimiento">Sí, fecha de vencimiento</option><option value="recarga">Sí, fecha de recarga</option></select></label>
            <label>¿Lleva serie o lote?<select name="nuevo_serie"><option value="0">No</option><option value="1">Sí, pedir serie o lote</option></select></label>
          </div>
          <small>Esto se guarda una sola vez: la próxima vez que lo agregues, el sistema ya sabrá si pide fecha o serie.</small>
          <div class="fila-acciones"><button class="btn primario" type="button" id="guardar-catalogo">Guardar elemento y continuar</button><button class="btn" type="button" id="cancelar-catalogo">Volver a buscar</button></div>
        </div>

        <div id="bloque-datos" hidden>
          <div id="resumen-el" class="aviso-info"></div>
          <div class="form-grid cols2">
            <label>Cantidad<input name="cantidad" type="number" min="1" max="9999" value="1" required></label>
            <label>Ubicación<select name="vehiculo_id"><option value="">Almacén</option>${opts(opciones.vehiculos, 'id', 'nombre', pre && pre !== 'almacen' ? pre : '')}</select></label>
            <label>Sitio dentro de la ubicación (gabinete, lado…)<input name="area" maxlength="60" placeholder="Ej.: Gabinete izquierdo"></label>
            <label>Estado<select name="estado">${Object.entries(ESTADOS).filter(([k]) => k !== 'baja').map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
            <label>Descripción (color, modelo, observaciones)<input name="descripcion" maxlength="255"></label>
            <label id="l-serie" hidden>Serie o lote<input name="lote_serie" maxlength="60"></label>
            <label id="l-fecha" hidden><span id="t-fecha">Fecha</span><input name="fecha_clave" type="date"></label>
            <label>Responsable<select name="responsable_id"><option value="">Sin responsable</option>${opts(opciones.usuarios, 'id', 'nombre')}</select></label>
          </div>
          <div class="fila-acciones"><button class="btn primario" type="submit">Agregar al inventario</button><button class="btn" type="button" id="cancelar-equipo">Cancelar</button></div>
        </div>
        <div class="fila-acciones" id="solo-cancelar"><button class="btn" type="button" id="cancelar-equipo-2">Cancelar</button></div>
      </form>`;
    const f = raiz.querySelector('#form-equipo');
    const buscar = f.querySelector('#el-buscar');
    const bloqueCrear = f.querySelector('#bloque-crear');
    const bloqueDatos = f.querySelector('#bloque-datos');

    function elegirElemento(c) {
      sel = c;
      bloqueCrear.hidden = true;
      bloqueDatos.hidden = false;
      f.querySelector('#solo-cancelar').hidden = true;
      buscar.value = c.nombre;
      f.querySelector('#resumen-el').innerHTML = `<strong>${esc(c.nombre)}</strong> · ${esc(c.categoria)} · ${c.tiene_fecha ? `Lleva fecha de ${c.tipo_fecha === 'recarga' ? 'recarga' : 'vencimiento'}` : 'Sin fecha de vencimiento'}${c.pide_serie ? ' · Lleva serie o lote' : ''}${c.en_inventario ? ` · Ya hay ${c.en_inventario} en el inventario` : ''}`;
      const lf = f.querySelector('#l-fecha');
      lf.hidden = !c.tiene_fecha;
      f.fecha_clave.required = !!c.tiene_fecha;
      f.fecha_clave.value = '';
      f.querySelector('#t-fecha').textContent = c.tipo_fecha === 'recarga' ? 'Fecha de próxima recarga' : 'Fecha de vencimiento';
      const ls = f.querySelector('#l-serie');
      ls.hidden = !c.pide_serie;
      f.lote_serie.required = !!c.pide_serie;
      f.lote_serie.value = '';
      f.cantidad.focus();
    }
    function olvidar() {
      sel = null;
      bloqueDatos.hidden = true;
      f.querySelector('#solo-cancelar').hidden = false;
    }

    CBM.combo(buscar, {
      buscar: (t) => CBM.api('/catalogo?q=' + encodeURIComponent(t)),
      nombreDe: (c) => c.nombre,
      render: (c) => `<span>${esc(c.nombre)}</span><small>${esc(c.categoria)} · ${c.tiene_fecha ? (c.tipo_fecha === 'recarga' ? 'con fecha de recarga' : 'con vencimiento') : 'sin fecha'}${c.en_inventario ? ` · ${c.en_inventario} en inventario` : ''}</small>`,
      alElegir: elegirElemento,
      alEscribir: () => { olvidar(); bloqueCrear.hidden = true; },
      crear: { etiqueta: (t) => `＋ Crear elemento «${t}»`, alCrear: (t) => { olvidar(); bloqueCrear.hidden = false; f.nuevo_nombre.value = t; f.nuevo_categoria.focus(); } },
    });

    buscar.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') ev.preventDefault(); });
    f.querySelector('#guardar-catalogo').addEventListener('click', async () => {
      try {
        const c = await CBM.api('/catalogo', { method: 'POST', body: {
          nombre: f.nuevo_nombre.value, categoria_id: f.nuevo_categoria.value,
          tiene_fecha: !!f.nuevo_fecha.value, tipo_fecha: f.nuevo_fecha.value || 'vencimiento', pide_serie: f.nuevo_serie.value === '1',
        } });
        CBM.aviso('Elemento creado. Ahora escribe la cantidad.');
        elegirElemento(c);
      } catch (err) { CBM.aviso(err.message, true); }
    });
    f.querySelector('#cancelar-catalogo').addEventListener('click', () => { bloqueCrear.hidden = true; buscar.focus(); });
    f.querySelector('#cancelar-equipo').addEventListener('click', cancelar);
    f.querySelector('#cancelar-equipo-2').addEventListener('click', cancelar);
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!sel) { CBM.aviso('Elige un elemento de la lista o créalo.', true); return; }
      try {
        const datos = Object.fromEntries(new FormData(f));
        const r = await CBM.api('/equipos', { method: 'POST', body: {
          catalogo_id: sel.id, cantidad: datos.cantidad, vehiculo_id: datos.vehiculo_id, area: datos.area, estado: datos.estado,
          descripcion: datos.descripcion, lote_serie: datos.lote_serie, fecha_clave: datos.fecha_clave, responsable_id: datos.responsable_id,
        } });
        CBM.aviso(r.sumado ? `Listo. Se sumó a lo que ya había: ahora son ${r.cantidad}.` : 'Elemento agregado al inventario.');
        cancelar();
        await cargarLista();
      } catch (err) { CBM.aviso(err.message, true); }
    });
    ir();
    buscar.focus();
  }

  // ---------- Aumentar la cantidad de un elemento ----------
  function formAgregar(e) {
    raiz.querySelector('#inv-detalle').innerHTML = `
      <form id="form-mas" class="panel"><h3>Agregar unidades · ${CBM.esc(e.nombre)}</h3>
        <small>Hay ${e.cantidad} en ${CBM.esc(e.ubicacion)}${e.area ? ' (' + CBM.esc(e.area) + ')' : ''}.</small>
        <div class="cols2"><label>Cuántas unidades llegan<input name="cantidad" type="number" min="1" max="9999" value="1" required></label>
          <label>De dónde vienen o nota (opcional)<input name="detalle" maxlength="140" placeholder="Compra, donación, devolución…"></label></div>
        <div class="fila-acciones"><button class="btn primario" type="submit">Agregar unidades</button><button class="btn" type="button" id="cancelar-mas">Cancelar</button></div></form>`;
    raiz.querySelector('#cancelar-mas').addEventListener('click', cancelar);
    raiz.querySelector('#form-mas').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      try {
        const r = await CBM.api(`/equipos/${e.id}/agregar`, { method: 'POST', body: Object.fromEntries(new FormData(ev.target)) });
        CBM.aviso(`Listo. Ahora hay ${r.cantidad}.`);
        cancelar();
        await cargarLista();
      } catch (err) { CBM.aviso(err.message, true); }
    });
    ir();
  }

  // ---------- Quitar unidades: siempre se reporta el porqué ----------
  function formQuitar(e) {
    raiz.querySelector('#inv-detalle').innerHTML = `
      <form id="form-menos" class="panel"><h3>Quitar del inventario · ${CBM.esc(e.nombre)}</h3>
        <small>Hay ${e.cantidad} en ${CBM.esc(e.ubicacion)}${e.area ? ' (' + CBM.esc(e.area) + ')' : ''}. Si es un daño o una pérdida, también queda como alerta en el dashboard.</small>
        <div class="cols2">
          <label>Cuántas unidades se quitan<input name="cantidad" type="number" min="1" max="${e.cantidad}" value="1" required></label>
          <label>Por qué se quita<select name="motivo" required><option value="">Elige un motivo…</option>${Object.entries(opciones.motivos).map(([k, v]) => `<option value="${k}">${CBM.esc(v)}</option>`).join('')}</select></label>
        </div>
        <label>Qué pasó (obligatorio)<textarea name="detalle" rows="3" maxlength="255" required placeholder="Ej.: Se dañó el motor en la emergencia del barrio X / Se perdió en el incendio de la vereda Y"></textarea></label>
        <div class="fila-acciones"><button class="btn primario" type="submit">Quitar y reportar</button><button class="btn" type="button" id="cancelar-menos">Cancelar</button></div></form>`;
    raiz.querySelector('#cancelar-menos').addEventListener('click', cancelar);
    raiz.querySelector('#form-menos').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      try {
        const r = await CBM.api(`/equipos/${e.id}/quitar`, { method: 'POST', body: Object.fromEntries(new FormData(ev.target)) });
        CBM.aviso(r.cantidad ? `Listo. Quedan ${r.cantidad}.` : 'Listo. Ya no quedan unidades; el elemento se dio de baja.');
        cancelar();
        await cargarLista();
      } catch (err) { CBM.aviso(err.message, true); }
    });
    ir();
  }

  // ---------- Hoja de vida; responsable y estado ----------
  async function abrirDetalle(id) {
    const { esc, puede } = CBM;
    try {
      const e = await CBM.api('/equipos/' + id);
      detalleId = e.id;
      const registro = puede('inventarios', 'registro');
      const eventos = e.eventos.map((ev) => `<li><strong>${TIPO_EVENTO[ev.tipo]}</strong> ${esc(ev.detalle)}<small>${esc(ev.creado_en.slice(0, 16))}${ev.usuario ? ' · ' + esc(ev.usuario) : ''}</small></li>`).join('');
      raiz.querySelector('#inv-detalle').innerHTML = `
        <div class="panel"><div class="fila-cab"><h3>Hoja de vida · ${esc(e.nombre)}</h3><button class="btn" id="cerrar-detalle">Cerrar</button></div>
          <dl class="datos">
            <div><dt>Cantidad disponible</dt><dd>${e.cantidad}${e.prestadas ? ` · ${e.prestadas} prestada(s)` : ''}</dd></div><div><dt>Categoría</dt><dd>${esc(e.categoria)}</dd></div>
            <div><dt>Ubicación</dt><dd>${esc(e.ubicacion)}${e.area ? ' · ' + esc(e.area) : ''}</dd></div><div><dt>Serie o lote</dt><dd>${esc(e.lote_serie || '—')}</dd></div>
            <div><dt>Descripción</dt><dd>${esc(e.descripcion || '—')}</dd></div>
            <div><dt>${e.tipo_fecha === 'recarga' ? 'Próxima recarga' : 'Vencimiento'}</dt><dd>${fecha(e.fecha_clave)} ${plazo(e.dias_restantes)}</dd></div>
            <div><dt>Fecha de ingreso</dt><dd>${fecha(e.fecha_ingreso)}</dd></div>
            <div><dt>Responsable</dt><dd>${esc(e.responsable || '—')}</dd></div>
            <div><dt>Estado</dt><dd><span class="chip ${e.semaforo ? COLOR[e.semaforo] : ''}">${esc(e.estado_fecha)}</span> ${ESTADOS[e.estado]}</dd></div>
          </dl>
          ${registro ? `<div class="fila-acciones"><button class="btn" id="d-mas">＋ Agregar unidades</button><button class="btn" id="d-menos"${e.cantidad < 1 ? ' disabled' : ''}>－ Quitar unidades</button></div>
          <div class="cols2">
            <form id="form-resp" class="form-grid"><h3>Sitio y responsable</h3>
              <label>Sitio dentro de la ubicación<input name="area" value="${esc(e.area || '')}" maxlength="60"></label>
              <label>Responsable<select name="responsable_id"><option value="">Sin responsable</option>${opts(opciones.usuarios, 'id', 'nombre', e.responsable_id)}</select></label>
              <button class="btn" type="submit">Guardar</button></form>
            <form id="form-estado" class="form-grid"><h3>Estado del elemento</h3>
              <label>Estado<select name="estado">${Object.entries(ESTADOS).map(([k, v]) => `<option value="${k}"${k === e.estado ? ' selected' : ''}${k === 'baja' && !puede('inventarios', 'total') ? ' disabled' : ''}>${v}</option>`).join('')}</select></label>
              <label>Motivo (opcional)<input name="motivo" maxlength="120"></label>
              <button class="btn" type="submit">Guardar estado</button></form></div>` : ''}
          <h3>Historial</h3>
          <ul class="eventos">${eventos || '<li>Sin eventos.</li>'}</ul>
        </div>`;
      ir();
      raiz.querySelector('#cerrar-detalle').addEventListener('click', cancelar);
      raiz.querySelector('#d-mas')?.addEventListener('click', () => formAgregar(e));
      raiz.querySelector('#d-menos')?.addEventListener('click', () => formQuitar(e));
      raiz.querySelector('#form-resp')?.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const f = Object.fromEntries(new FormData(ev.target));
        try {
          await CBM.api(`/equipos/${e.id}/responsable`, { method: 'PATCH', body: { area: f.area, responsable_id: f.responsable_id || null } });
          CBM.aviso('Datos actualizados.');
          await cargarLista(); await abrirDetalle(e.id);
        } catch (err) { CBM.aviso(err.message, true); }
      });
      raiz.querySelector('#form-estado')?.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        try {
          await CBM.api(`/equipos/${e.id}/estado`, { method: 'PATCH', body: Object.fromEntries(new FormData(ev.target)) });
          CBM.aviso('Estado actualizado.');
          await cargarLista(); await abrirDetalle(e.id);
        } catch (err) { CBM.aviso(err.message, true); }
      });
    } catch (err) { CBM.aviso(err.message, true); }
  }
})();
