(() => {
  window.CBM = window.CBM || {};
  window.CBM.vistas = window.CBM.vistas || {};

  const TIPOS = { preventivo: 'Preventivo', correctivo: 'Correctivo', inspeccion: 'Inspección', danos: 'Daños', llantas: 'Llantas' };
  const TIPOS_PLAN = { preventivo: 'Preventivo', inspeccion: 'Inspección', chequeo: 'Chequeo' };
  const TIPOS_CAT = { preventivo: 'Preventivo', correctivo: 'Correctivo', inspeccion: 'Inspección', chequeo: 'Chequeo', danos: 'Daños' };
  const TIPOS_MANT = { preventivo: 'Preventivo', correctivo: 'Correctivo', inspeccion: 'Inspección', danos: 'Daños' };
  const aTipoPlan = (t) => (TIPOS_PLAN[t] ? t : 'preventivo');
  const aTipoMant = (t) => (t === 'chequeo' ? 'inspeccion' : t);
  const ACCION_BITACORA = { eliminar_mantenimiento: 'Mantenimiento eliminado', cancelar_mantenimiento: 'Mantenimiento cancelado', eliminar_llanta: 'Cambio de llantas eliminado', eliminar_uso: 'Registro de uso eliminado', eliminar_vehiculo: 'Vehículo eliminado', reintegro_vehiculo: 'Vehículo reintegrado' };
  const CLASE_CAL = { mantenimiento: 'Mantenimiento', dano: 'Daño', reparado: 'Reparado', llantas: 'Llantas', recordatorio: 'Recordatorio' };
  const ESTADO_VEH = { activo: 'Activo', en_uso: 'En uso', en_mantenimiento: 'En mantenimiento', baja: 'Dado de baja', prestado: 'Prestado', inactivo_temporal: 'Temporalmente inactivo' };
  const ALIST = { lista: ['Lista', 'verde'], atencion: ['Atención', 'ambar'], fuera_de_servicio: ['Fuera de servicio', 'rojo'] };
  const COLOR_PLAN = { ok: 'verde', proximo: 'ambar', vencido: 'rojo' };
  const ESTADO_MANT = { programado: 'Programado', realizado: 'Realizado', cancelado: 'Cancelado' };
  const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

  let raiz = null;
  let tab = 'flota';
  let mes = '';
  let flota = [];
  let eventosMes = [];

  const E = (v) => CBM.esc(v);
  const $ = (s) => raiz.querySelector(s);
  const num = (n) => Number(n).toLocaleString('es-CO');
  const fecha = (f) => (f ? f.split('-').reverse().join('/') : '—');
  const hoyISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const opts = (lista, valor, etiqueta, sel) => lista.map((o) => `<option value="${o[valor]}"${String(o[valor]) === String(sel ?? '') ? ' selected' : ''}>${E(typeof etiqueta === 'function' ? etiqueta(o) : o[etiqueta])}</option>`).join('');
  const kmHoras = (km, h) => [km != null ? `${num(km)} km` : '', h != null ? `${Number(h)} h` : ''].filter(Boolean).join(' · ') || '—';
  const frecuencia = (p) => [p.cada_dias && `cada ${p.cada_dias} días`, p.cada_km && `cada ${num(p.cada_km)} km`, p.cada_horas && `cada ${Number(p.cada_horas)} h`].filter(Boolean).join(' · ') || 'No se repite';
  const panel = (html) => { const d = $('#man-detalle'); d.innerHTML = html; d.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  const aviso = (m, mal) => CBM.aviso(m, mal);
  const falla = (e) => aviso(e.message, true);

  window.CBM.vistas.mantenimientos = async (el) => {
    el.innerHTML = '<div id="man-raiz"></div>';
    raiz = el.querySelector('#man-raiz'); // contenedor propio: el clic no se duplica al volver a abrir la pantalla
    tab = 'flota';
    mes = hoyISO().slice(0, 7);
    raiz.innerHTML = `
      <div class="pestanas" role="tablist">
        <button class="pestana" data-tab="flota">Flota y alistamiento</button>
        <button class="pestana" data-tab="calendario">Calendario</button>
        <button class="pestana" data-tab="chequeos">Chequeos y recordatorios</button>
      </div>
      <div id="man-tab"></div><div id="man-detalle"></div>`;
    raiz.addEventListener('click', alClic);
    raiz.addEventListener('keydown', (ev) => { const d = ev.target.closest && ev.target.closest('[data-a="dia"]'); if (d && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); verDia(d.dataset.f); } });
    await mostrar();
  };

  async function mostrar() {
    raiz.querySelectorAll('.pestana').forEach((b) => b.classList.toggle('activa', b.dataset.tab === tab));
    $('#man-detalle').innerHTML = '';
    try {
      if (tab === 'flota') await tabFlota();
      else if (tab === 'calendario') await tabCalendario();
      else await tabChequeos();
    } catch (e) { falla(e); }
  }

  function alClic(ev) {
    const b = ev.target.closest('[data-tab], [data-a]');
    if (!b) return;
    if (b.dataset.tab) { tab = b.dataset.tab; mostrar(); return; }
    const { a, id } = b.dataset;
    const accion = {
      historial: () => verHistorial(id), uso: () => formUso(id), dano: () => formDano(id),
      estado: () => formEstadoVeh(id), 'nuevo-veh': () => formNuevoVehiculo(), 'mant-nuevo': () => formMantenimiento(),
      realizar: () => formRealizar(id),
      mantenimientos: () => verMantenimientos(id),
      'plan-veh-sel': () => { const v = $('#sel-veh-plan'); if (v && v.value) verMantenimientos(v.value); },
      'plan-quitar': () => quitarPlan(id, b.dataset.veh),
      'uso-eliminar': () => eliminarUso(id, b.dataset.veh),
      'veh-baja': () => darDeBaja(id),
      'veh-reintegrar': () => reintegrar(id),
      dia: () => verDia(b.dataset.f),
      mes: () => { const [y, m] = mes.split('-').map(Number); const d = new Date(y, m - 1 + Number(b.dataset.delta), 1); mes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; mostrar(); },
      'mant-estado': () => cambiarEstadoMant(id, b.dataset.estado),
    }[a];
    if (accion) accion();
  }

  // ---------- Flota y alistamiento (HU-3.3, 3.7, 3.8, 3.9, 3.10, 3.12) ----------
  async function tabFlota() {
    flota = await CBM.api('/flota/vehiculos');
    const n = (k) => flota.filter((v) => v.alistamiento === k).length;
    const total = CBM.puede('mantenimientos', 'total');
    const registro = CBM.puede('mantenimientos', 'registro');
    const filas = flota.map((v) => {
      const [txt, color] = ALIST[v.alistamiento];
      return `<tr>
        <td><strong>${E(v.codigo)}</strong><small>${E(v.nombre)}${v.placa ? ' · ' + E(v.placa) : ''}</small></td>
        <td>${ESTADO_VEH[v.estado]}</td>
        <td><span class="chip ${color}">${txt}</span>${v.danos_pendientes ? `<small>${v.danos_pendientes} daño(s) sin atender</small>` : ''}</td>
        <td>${v.proximo ? `${E(v.proximo.nombre)}<small><span class="chip ${COLOR_PLAN[v.proximo.estado]}">${E(v.proximo.texto)}</span></small>` : '<small>Sin recordatorios</small>'}</td>
        <td>${kmHoras(v.km_actual, v.horas_actuales)}</td>
        <td><div class="fila-acciones">
          <button class="btn" data-a="historial" data-id="${v.id}">Historial</button>
          ${registro ? `<button class="btn" data-a="mantenimientos" data-id="${v.id}">Mantenimientos</button><button class="btn" data-a="uso" data-id="${v.id}">Registrar uso</button><button class="btn" data-a="dano" data-id="${v.id}">Reportar daño</button>` : ''}
          ${total ? `<button class="btn" data-a="estado" data-id="${v.id}">Estado</button><button class="btn peligro" data-a="veh-baja" data-id="${v.id}">Eliminar</button>` : ''}
        </div></td></tr>`;
    }).join('');
    let bajas = [];
    let registroElim = [];
    if (total) {
      const todos = await CBM.api('/flota/vehiculos?incluir_bajas=1');
      bajas = todos.filter((v) => v.estado === 'baja');
      registroElim = await CBM.api('/flota/bitacora');
    }
    const panelBajas = total ? `
      <div class="panel"><h3>Vehículos eliminados</h3>
        ${bajas.length ? `<div class="tabla-wrap"><table><thead><tr><th>Unidad</th><th></th></tr></thead><tbody>${bajas.map((v) => `<tr><td><strong>${E(v.codigo)}</strong><small>${E(v.nombre)}${v.placa ? ' · ' + E(v.placa) : ''}</small></td>
          <td><button class="btn" data-a="veh-reintegrar" data-id="${v.id}">Reintegrar</button></td></tr>`).join('')}</tbody></table></div>
        <small>Reintegrar pide un motivo y tu contraseña. El vehículo vuelve como Activo con su historial, pero sin los elementos que tenía antes de eliminarlo.</small>` : '<p class="vacio">No hay vehículos eliminados.</p>'}</div>
      <div class="panel"><h3>Registro de eliminaciones y bajas</h3>
        ${registroElim.length ? `<div class="tabla-wrap"><table><thead><tr><th>Fecha</th><th>Quién</th><th>Vehículo</th><th>Qué</th><th>Por qué</th></tr></thead><tbody>${registroElim.map((r) => `<tr>
          <td>${fecha(String(r.creado_en).slice(0, 10))}<small>${E(String(r.creado_en).slice(11, 16))}</small></td><td>${E(r.usuario_nombre || '—')}</td>
          <td>${r.vehiculo_codigo ? `<strong>${E(r.vehiculo_codigo)}</strong>` : '—'}</td><td>${E(ACCION_BITACORA[r.accion] || r.accion)}<small>${E(r.detalle)}</small></td><td>${E(r.motivo)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="vacio">Aún no se ha eliminado nada.</p>'}</div>` : '';
    $('#man-tab').innerHTML = `
      <div class="tarjetas">
        <div class="tarjeta"><div class="num">${n('lista')}</div><span>Unidades listas</span></div>
        <div class="tarjeta"><div class="num">${n('atencion')}</div><span>Requieren atención</span></div>
        <div class="tarjeta"><div class="num">${n('fuera_de_servicio')}</div><span>Fuera de servicio</span></div>
      </div>
      <div class="panel">
        <div class="fila-cab"><h3>Estado de alistamiento y recordatorios</h3>${total ? '<button class="btn primario" data-a="nuevo-veh">Crear vehículo</button>' : ''}</div>
        ${flota.length ? `<div class="tabla-wrap"><table><thead><tr><th>Unidad</th><th>Estado</th><th>Alistamiento</th><th>Próximo recordatorio</th><th>Km · horas</th><th></th></tr></thead><tbody>${filas}</tbody></table></div>` : '<p class="vacio">Aún no hay vehículos. Crea el primero.</p>'}
      </div>${panelBajas}`;
  }

  async function verHistorial(id, tipo = '') {
    const v = flota.find((x) => String(x.id) === String(id));
    const h = await CBM.api(`/flota/vehiculos/${id}/historial?limit=50${tipo ? '&tipo=' + tipo : ''}`);
    const filas = h.items.map((i) => `<tr><td>${fecha(i.fecha)}</td><td>${TIPOS[i.tipo]}</td><td>${E(i.detalle)}</td><td>${kmHoras(i.km, i.horas)}</td>
      <td>${i.estado === 'programado' || i.estado === 'pendiente' ? `<span class="chip ambar">${E(i.estado === 'pendiente' ? 'Pendiente' : 'Programado')}</span>` : ''}</td><td>${E(i.usuario || '—')}</td></tr>`).join('');
    panel(`<div class="panel"><div class="fila-cab"><h3>Historial · ${E(v ? v.codigo : '')}</h3>
      <select id="f-tipo-h" aria-label="Tipo">${'<option value="">Todos los tipos</option>' + Object.entries(TIPOS).map(([k, t]) => `<option value="${k}"${k === tipo ? ' selected' : ''}>${t}</option>`).join('')}</select></div>
      ${h.items.length ? `<div class="tabla-wrap"><table><thead><tr><th>Fecha</th><th>Tipo</th><th>Detalle</th><th>Km · horas</th><th></th><th>Registró</th></tr></thead><tbody>${filas}</tbody></table></div><small>Mostrando ${h.items.length} de ${h.total}</small>` : '<p class="vacio">Todavía no hay registros para este vehículo.</p>'}</div>`);
    $('#f-tipo-h').addEventListener('change', (e) => verHistorial(id, e.target.value).catch(falla));
  }

  function enviar(form, ruta, opciones, exito, despues) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await CBM.api(ruta, { ...opciones, body: Object.fromEntries(new FormData(form)) });
        aviso(exito);
        await despues();
      } catch (err) { falla(err); }
    });
  }

  async function formUso(id) {
    const v = flota.find((x) => String(x.id) === String(id));
    const previos = await CBM.api(`/flota/vehiculos/${id}/uso`);
    const registro = CBM.puede('mantenimientos', 'registro');
    panel(`<form id="f-uso" class="panel"><h3>Registrar uso · ${E(v.codigo)}</h3>
      <small>Actual: ${kmHoras(v.km_actual, v.horas_actuales)}. Se registra cada vez que la unidad entra a la estación.</small>
      <div class="cols2"><label>Kilometraje<input name="km" type="number" min="${v.km_actual}" step="1"></label>
      <label>Horas de servicio<input name="horas" type="number" min="${v.horas_actuales}" step="0.1"></label></div>
      <div class="fila-acciones"><button class="btn primario" type="submit">Guardar</button></div>
      ${previos.length ? `<h3>Registros anteriores</h3><ul class="eventos">${previos.map((u) => `<li>${kmHoras(u.km, u.horas)}<small>${fecha(String(u.creado_en).slice(0, 10))}${u.usuario ? ' · ' + E(u.usuario) : ''}</small>
        ${registro ? `<div class="fila-acciones"><button class="btn peligro" type="button" data-a="uso-eliminar" data-id="${u.id}" data-veh="${v.id}">Eliminar</button></div>` : ''}</li>`).join('')}</ul>` : ''}</form>`);
    enviar($('#f-uso'), `/flota/vehiculos/${id}/uso`, { method: 'POST' }, 'Uso registrado.', mostrar);
  }

  function formDano(id) {
    const v = flota.find((x) => String(x.id) === String(id));
    panel(`<form id="f-dano" class="panel"><h3>Reportar daño · ${E(v.codigo)}</h3>
      <label>Descripción del daño<textarea name="descripcion" rows="3" required maxlength="255"></textarea></label>
      <div class="fila-acciones"><button class="btn primario" type="submit">Enviar reporte</button></div></form>`);
    enviar($('#f-dano'), `/flota/vehiculos/${id}/danos`, { method: 'POST' }, 'Daño reportado.', mostrar);
  }

  function formEstadoVeh(id) {
    const v = flota.find((x) => String(x.id) === String(id));
    panel(`<form id="f-estado-v" class="panel"><h3>Estado del vehículo · ${E(v.codigo)}</h3>
      <label>Estado<select name="estado">${Object.entries(ESTADO_VEH).filter(([k]) => (k !== 'prestado' || v.estado === 'prestado') && k !== 'baja').map(([k, t]) => `<option value="${k}"${k === v.estado ? ' selected' : ''}${k === 'prestado' ? ' disabled' : ''}>${t}</option>`).join('')}</select></label>
      <small>Temporalmente inactivo: el vehículo está dañado o en revisión y no sale a emergencias ni se presta hasta que vuelva a Activo. Para quitar un vehículo usa el botón Eliminar (pide motivo y contraseña). El préstamo de vehículos se registra en el módulo Préstamos.</small>
      <div class="fila-acciones"><button class="btn primario" type="submit">Guardar estado</button></div></form>`);
    enviar($('#f-estado-v'), `/flota/vehiculos/${id}/estado`, { method: 'PATCH' }, 'Estado actualizado.', mostrar);
  }

  // HU-3.7: crear vehículo con campos base y campos personalizables
  async function formNuevoVehiculo() {
    const campos = await CBM.api('/flota/campos');
    const input = (c) => `<label>${E(c.nombre)}<input name="campo_${c.id}" type="${c.tipo === 'numero' ? 'number' : c.tipo === 'fecha' ? 'date' : 'text'}" step="any" maxlength="255"></label>`;
    panel(`<form id="f-veh" class="panel"><h3>Crear vehículo</h3>
        <div class="cols2">
          <label>Código de la unidad<input name="codigo" required maxlength="20" placeholder="M-04"></label>
          <label>Nombre<input name="nombre" required maxlength="80"></label>
          <label>Placa<input name="placa" maxlength="12"></label>
          <label>Tipo<select name="tipo"><option value="maquina">Máquina</option><option value="ambulancia">Ambulancia</option><option value="rescate">Rescate</option><option value="otro">Otro</option></select></label>
          <label>Kilometraje actual<input name="km_actual" type="number" min="0" step="1" value="0"></label>
          <label>Horas de servicio actuales<input name="horas_actuales" type="number" min="0" step="0.1" value="0"></label>
        </div>
        ${campos.length ? `<h3>Campos personalizados</h3><div class="cols2">${campos.map(input).join('')}</div>` : '<small>Aún no hay campos personalizados. Agrégalos abajo.</small>'}
        <div class="fila-acciones"><button class="btn primario" type="submit">Crear vehículo</button></div></form>
      <form id="f-campo" class="panel"><h3>Agregar un campo personalizado</h3>
        <div class="cols2"><label>Nombre del campo<input name="nombre" required maxlength="60" placeholder="Ej. Capacidad de agua (L)"></label>
        <label>Tipo<select name="tipo"><option value="texto">Texto</option><option value="numero">Número</option><option value="fecha">Fecha</option></select></label></div>
        <div class="fila-acciones"><button class="btn" type="submit">Agregar campo</button></div>
        ${campos.length ? `<small>Campos actuales: ${campos.map((c) => E(c.nombre)).join(', ')}.</small>` : ''}</form>`);
    $('#f-veh').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      const valores = {};
      Object.keys(f).filter((k) => k.startsWith('campo_')).forEach((k) => { valores[k.slice(6)] = f[k]; delete f[k]; });
      try { await CBM.api('/flota/vehiculos', { method: 'POST', body: { ...f, campos: valores } }); aviso('Vehículo creado.'); await mostrar(); } catch (err) { falla(err); }
    });
    enviar($('#f-campo'), '/flota/campos', { method: 'POST' }, 'Campo agregado.', formNuevoVehiculo);
  }

  // ---------- Mantenimientos de un vehículo: agregar (de la lista o nuevo) y quitar ----------
  async function verMantenimientos(id) {
    const v = flota.find((x) => String(x.id) === String(id));
    if (!v) return;
    const planes = await CBM.api('/flota/planes?vehiculo_id=' + id);
    const registro = CBM.puede('mantenimientos', 'registro');
    const filas = planes.map((p) => `<tr><td><strong>${E(p.nombre)}</strong><small>${TIPOS_PLAN[p.tipo]}</small></td><td>${E(frecuencia(p))}</td>
      <td>${p.ultima_fecha ? fecha(p.ultima_fecha) : '—'}</td>
      <td><span class="chip ${COLOR_PLAN[p.estado]}">${E(p.texto)}</span></td>
      <td>${registro ? `<div class="fila-acciones"><button class="btn" data-a="realizar" data-id="${p.id}">Marcar realizado</button><button class="btn peligro" data-a="plan-quitar" data-id="${p.id}" data-veh="${v.id}">Eliminar</button></div>` : ''}</td></tr>`).join('');
    panel(`<div class="panel"><div class="fila-cab"><h3>Mantenimientos de ${E(v.codigo)} · ${E(v.nombre)}</h3><button class="btn" data-a="historial" data-id="${v.id}">Ver historial</button></div>
        ${planes.length ? `<div class="tabla-wrap"><table><thead><tr><th>Mantenimiento</th><th>Se repite</th><th>Última vez</th><th>Próximo</th><th></th></tr></thead><tbody>${filas}</tbody></table></div>` : '<p class="vacio">Este vehículo aún no tiene mantenimientos. Agrega el primero abajo.</p>'}
        <small>Eliminar un mantenimiento pide el motivo y queda registrado. Solo deja de recordarlo y de mostrarlo en el calendario: lo que ya se hizo sigue en el historial.</small></div>
      ${registro ? `<form id="f-plan" class="panel"><h3>Agregar nuevo mantenimiento a ${E(v.codigo)}</h3>
        <div class="campo"><span>Mantenimiento (elige de la lista o escribe para buscar)</span><input id="pl-buscar" maxlength="80" placeholder="Ej.: SOAT, técnico-mecánica, cambio de aceite, llantas…" aria-label="Buscar mantenimiento"></div>
        <small>Si ya existe, elígelo de la lista. Si no existe, la lista te ofrece crearlo y queda disponible para todos los vehículos.</small>
        <div id="pl-crear" class="bloque-crear" hidden>
          <strong>Crear mantenimiento nuevo</strong>
          <div class="cols2"><label>Nombre<input name="n_nombre" maxlength="80"></label>
            <label>Tipo<select name="n_tipo">${Object.entries(TIPOS_CAT).map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select></label></div>
          <div class="fila-acciones"><button class="btn primario" type="button" id="pl-guardar-cat">Guardar y continuar</button><button class="btn" type="button" id="pl-volver">Volver a buscar</button></div>
        </div>
        <div id="pl-datos" hidden>
          <div id="pl-info" class="aviso-info"></div>
          <div class="cols2">
            <label>¿Es recurrente?<select name="recurrente"><option value="no">No, solo se registra cuando se hace</option><option value="si">Sí, se repite</option></select></label>
            <label>Tipo<select name="tipo">${Object.entries(TIPOS_PLAN).map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select></label>
          </div>
          <div id="pl-freq" class="cols2" hidden>
            <label>Cada cuántos días (opcional)<input name="cada_dias" type="number" min="1"></label>
            <label>Cada cuántos km (opcional)<input name="cada_km" type="number" min="1"></label>
            <label>Cada cuántas horas de uso (opcional)<input name="cada_horas" type="number" min="1"></label>
            <label>Última vez que se hizo (opcional)<input name="ultima_fecha" type="date" max="${hoyISO()}"></label>
          </div>
          <small>Todo es opcional. Con "cada X días" el mantenimiento aparece en el calendario cada X días; al marcarlo como realizado, la cuenta vuelve a empezar desde ese día. Si no es recurrente, solo queda en la lista para registrarlo cuando se haga.</small>
          <div class="fila-acciones"><button class="btn primario" type="submit">Agregar al vehículo</button></div>
        </div></form>` : ''}`);
    const f = $('#f-plan');
    if (!f) return;
    let sel = null;
    const buscar = f.querySelector('#pl-buscar');
    const elegir = (c) => {
      sel = c;
      f.querySelector('#pl-crear').hidden = true;
      f.querySelector('#pl-datos').hidden = false;
      buscar.value = c.nombre;
      f.querySelector('#pl-info').innerHTML = `<strong>${E(c.nombre)}</strong>: define cada cuánto se repite en <strong>${E(v.codigo)}</strong> y cuándo se hizo por última vez.`;
      f.tipo.value = aTipoPlan(c.tipo);
      f.cada_dias.value = c.cada_dias || '';
      f.cada_km.value = c.cada_km || '';
      f.cada_horas.value = c.cada_horas || '';
      f.ultima_fecha.value = '';
      f.recurrente.value = c.cada_dias || c.cada_km || c.cada_horas ? 'si' : 'no';
      verFrecuencia();
    };
    const verFrecuencia = () => {
      const si = f.recurrente.value === 'si';
      f.querySelector('#pl-freq').hidden = !si;
      if (si && !f.ultima_fecha.value) f.ultima_fecha.value = hoyISO();
      if (!si) f.ultima_fecha.value = '';
    };
    f.recurrente.addEventListener('change', verFrecuencia);
    CBM.combo(buscar, {
      buscar: (t) => CBM.api('/flota/catalogo-mantenimientos?q=' + encodeURIComponent(t)),
      nombreDe: (c) => c.nombre,
      render: (c) => `<span>${E(c.nombre)}</span><small>${TIPOS_CAT[c.tipo]}${[c.cada_dias && `cada ${c.cada_dias} días`, c.cada_km && `cada ${num(c.cada_km)} km`, c.cada_horas && `cada ${c.cada_horas} h`].filter(Boolean).map((x) => ' · ' + x).join('')}</small>`,
      alElegir: elegir,
      alEscribir: () => { sel = null; f.querySelector('#pl-datos').hidden = true; f.querySelector('#pl-crear').hidden = true; },
      crear: { etiqueta: (t) => `＋ Crear mantenimiento «${t}»`, alCrear: (t) => { f.querySelector('#pl-datos').hidden = true; f.querySelector('#pl-crear').hidden = false; f.n_nombre.value = t; f.n_tipo.focus(); } },
    });
    buscar.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') ev.preventDefault(); });
    f.querySelector('#pl-volver').addEventListener('click', () => { f.querySelector('#pl-crear').hidden = true; buscar.focus(); });
    f.querySelector('#pl-guardar-cat').addEventListener('click', async () => {
      try {
        const c = await CBM.api('/flota/catalogo-mantenimientos', { method: 'POST', body: { nombre: f.n_nombre.value, tipo: f.n_tipo.value } });
        aviso('Mantenimiento creado. Ahora dinos si es recurrente.');
        elegir(c);
      } catch (err) { falla(err); }
    });
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!sel) { aviso('Elige un mantenimiento de la lista o créalo.', true); return; }
      try {
        await CBM.api('/flota/planes', { method: 'POST', body: f.recurrente.value === 'si'
          ? { vehiculo_id: v.id, nombre: sel.nombre, tipo: f.tipo.value, cada_dias: f.cada_dias.value, cada_km: f.cada_km.value, cada_horas: f.cada_horas.value, ultima_fecha: f.ultima_fecha.value }
          : { vehiculo_id: v.id, nombre: sel.nombre, tipo: f.tipo.value } });
        aviso('Mantenimiento agregado.');
        await verMantenimientos(id);
      } catch (err) { falla(err); }
    });
  }

  // Ventana que pide el motivo (y la contraseña cuando hace falta) antes de eliminar o dar de baja algo
  function pedir({ titulo, mensaje, boton = 'Confirmar', clave = false }) {
    return new Promise((resolve) => {
      const d = document.createElement('dialog');
      d.className = 'modal-cbm';
      d.innerHTML = `<form method="dialog"><h3>${E(titulo)}</h3><p>${mensaje}</p>
        <label>Motivo (obligatorio, queda registrado)<textarea name="motivo" rows="3" minlength="5" maxlength="255" required></textarea></label>
        ${clave ? '<label>Tu contraseña de administrador<input name="password" type="password" required autocomplete="current-password"></label>' : ''}
        <div class="fila-acciones"><button class="btn peligro" value="ok">${E(boton)}</button><button class="btn" value="no" formnovalidate>Cancelar</button></div></form>`;
      d.addEventListener('close', () => {
        const f = d.querySelector('form');
        resolve(d.returnValue === 'ok' ? { motivo: f.motivo.value.trim(), password: f.password ? f.password.value : undefined } : null);
        d.remove();
      });
      document.body.append(d);
      d.showModal();
      d.querySelector('textarea').focus();
    });
  }

  async function quitarPlan(id, vehiculoId) {
    const r = await pedir({ titulo: 'Eliminar mantenimiento', mensaje: 'Dejará de recordarse y de salir en el calendario. Lo que ya se hizo sigue en el historial.', boton: 'Eliminar' });
    if (!r) return;
    try {
      await CBM.api(`/flota/planes/${id}`, { method: 'DELETE', body: { motivo: r.motivo } });
      aviso('Mantenimiento eliminado. Quedó registrado.');
      await verMantenimientos(vehiculoId);
    } catch (e) { falla(e); }
  }

  // Registros de uso (km y horas)
  async function eliminarUso(id, vehiculoId) {
    const r = await pedir({ titulo: 'Eliminar registro de uso', mensaje: 'Se quita de la lista del vehículo y queda anotado quién lo eliminó y por qué.', boton: 'Eliminar' });
    if (!r) return;
    try {
      await CBM.api(`/flota/uso/${id}`, { method: 'DELETE', body: { motivo: r.motivo } });
      aviso('Eliminado. Quedó registrado.');
      flota = await CBM.api('/flota/vehiculos');
      await formUso(vehiculoId);
    } catch (e) { falla(e); }
  }

  async function cambiarEstadoMant(id, estado) {
    let motivo;
    if (estado === 'cancelado') {
      const r = await pedir({ titulo: 'Cancelar mantenimiento', mensaje: 'Sale del calendario y queda anotado quién lo canceló y por qué.', boton: 'Cancelar mantenimiento' });
      if (!r) return;
      motivo = r.motivo;
    }
    try {
      await CBM.api(`/mantenimientos/${id}/estado`, { method: 'PATCH', body: { estado, motivo } });
      aviso('Mantenimiento actualizado.');
      await mostrar();
    } catch (e) { falla(e); }
  }

  // Dar de baja y reintegrar un vehículo: solo administrador, con contraseña y motivo
  async function darDeBaja(id) {
    const v = flota.find((x) => String(x.id) === String(id));
    if (!v) return;
    const r = await pedir({ titulo: `¿Desea eliminar el vehículo ${v.codigo} · ${v.nombre}?`, clave: true, boton: 'Eliminar vehículo',
      mensaje: 'Sale de todas las listas y los elementos que lleva pasan al Almacén. Solo el administrador puede eliminarlo, y para confirmar debes escribir tu contraseña.' });
    if (!r) return;
    try {
      await CBM.api(`/flota/vehiculos/${id}/baja`, { method: 'POST', body: r });
      aviso('Vehículo eliminado. Quedó registrado.');
      await mostrar();
    } catch (e) { falla(e); }
  }

  async function reintegrar(id) {
    const r = await pedir({ titulo: '¿Desea reintegrar el vehículo?', clave: true, boton: 'Reintegrar', mensaje: 'Vuelve a la flota como Activo, <strong>sin ninguno de los elementos que tenía</strong> antes de eliminarlo. Para confirmar escribe tu contraseña de administrador.' });
    if (!r) return;
    try {
      await CBM.api(`/flota/vehiculos/${id}/reintegrar`, { method: 'POST', body: r });
      aviso('Vehículo reintegrado. Quedó registrado.');
      await mostrar();
    } catch (e) { falla(e); }
  }

  // ---------- Calendario (HU-3.1, 3.2): mantenimientos, daños, llantas y recordatorios ----------
  const etiquetaEv = (e) => {
    if (e.clase === 'mantenimiento') return `${e.vehiculo} · ${TIPOS[e.tipo]}${e.estado === 'realizado' ? ' ✓' : ''}`;
    if (e.clase === 'dano') return `${e.vehiculo} · Daño`;
    if (e.clase === 'reparado') return `${e.vehiculo} · Reparado ✓`;
    if (e.clase === 'llantas') return `${e.vehiculo} · Llantas ✓`;
    return `${e.vehiculo} · ${e.titulo}`;
  };
  const claseEv = (e) => (e.clase === 'mantenimiento' ? `ev ${e.tipo}${e.estado === 'programado' ? ' prog' : ''}` : e.clase === 'recordatorio' ? `ev c-recordatorio r-${e.estado}` : `ev c-${e.clase}`);

  async function tabCalendario() {
    const d = await CBM.api('/mantenimientos/calendario?mes=' + mes);
    eventosMes = d.eventos;
    const [y, m] = mes.split('-').map(Number);
    const lead = (new Date(y, m - 1, 1).getDay() + 6) % 7;
    const dias = new Date(y, m, 0).getDate();
    const hoy = hoyISO();
    const celdas = Array.from({ length: lead }, () => '<div class="dia vacio-dia"></div>');
    for (let n = 1; n <= dias; n += 1) {
      const f = `${mes}-${String(n).padStart(2, '0')}`;
      const delDia = d.eventos.filter((e) => e.fecha === f);
      const evs = delDia.slice(0, 3).map((e) => `<span class="${claseEv(e)}" title="${E(etiquetaEv(e) + ': ' + e.titulo)}">${E(etiquetaEv(e))}</span>`).join('')
        + (delDia.length > 3 ? `<small>+${delDia.length - 3} más</small>` : '');
      celdas.push(`<div class="dia${f === hoy ? ' hoy' : ''}${delDia.length ? ' con-ev' : ''}"${delDia.length ? ` data-a="dia" data-f="${f}" tabindex="0" role="button" aria-label="Ver lo que pasa el ${n}"` : ''}><b>${n}</b>${evs}</div>`);
    }
    const registro = CBM.puede('mantenimientos', 'registro');
    const prox = d.proximos.map((p) => `<li><strong>${E(p.vehiculo)}</strong> ${E(p.descripcion)}
        <small>${TIPOS[p.tipo]} · ${fecha(p.fecha)}${p.hora ? ' · ' + p.hora : ''}</small>
        ${registro ? `<div class="fila-acciones"><button class="btn" data-a="mant-estado" data-id="${p.id}" data-estado="realizado">Marcar realizado</button><button class="btn" data-a="mant-estado" data-id="${p.id}" data-estado="cancelado">Cancelar</button></div>` : ''}</li>`).join('');
    const cuando = (n) => (n < 0 ? `vencido hace ${-n} día(s)` : n === 0 ? 'toca hoy' : `en ${n} día(s)`);
    const recs = d.recordatorios.map((r) => `<li><strong>${E(r.vehiculo)}</strong> ${E(r.nombre)}
        <small>Cada ${r.cada_dias} días · ${fecha(r.fecha)} · <span class="chip ${r.dias < 0 ? 'rojo' : r.dias <= 7 ? 'ambar' : 'verde'}">${cuando(r.dias)}</span></small>
        ${registro ? `<div class="fila-acciones"><button class="btn" data-a="realizar" data-id="${r.plan_id}">Marcar realizado</button></div>` : ''}</li>`).join('');
    $('#man-tab').innerHTML = `
      <div class="cols">
        <div class="panel">
          <div class="fila-cab"><h3>Calendario de mantenimientos</h3>${registro ? '<button class="btn primario" data-a="mant-nuevo">Registrar mantenimiento</button>' : ''}</div>
          <div class="fila-acciones"><button class="btn" data-a="mes" data-delta="-1" aria-label="Mes anterior">←</button><strong>${MESES[m - 1]} ${y}</strong><button class="btn" data-a="mes" data-delta="1" aria-label="Mes siguiente">→</button></div>
          <div class="leyenda"><span class="ev preventivo">Preventivo</span><span class="ev correctivo">Correctivo</span><span class="ev inspeccion">Inspección</span><span class="ev c-dano">Daño</span><span class="ev c-reparado">Reparado</span><span class="ev c-llantas">Llantas</span><span class="ev c-recordatorio r-proximo">Recordatorio</span><span class="ev c-recordatorio r-vencido">Vencido</span></div>
          <div class="calendario">${['LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB', 'DOM'].map((x) => `<small class="cab-dia">${x}</small>`).join('')}${celdas.join('')}</div>
          <small>Toca un día con eventos para ver qué pasó, cuál fue y cuándo se reparó.</small>
        </div>
        <div class="panel"><h3>Recordatorios periódicos</h3>${recs ? `<ul class="eventos">${recs}</ul>` : '<p class="vacio">No hay mantenimientos que se repitan por días. Agrégalos con el botón Mantenimientos de cada vehículo.</p>'}
          <h3>Mantenimientos programados</h3>${prox ? `<ul class="eventos">${prox}</ul>` : '<p class="vacio">No hay mantenimientos programados.</p>'}</div>
      </div>`;
  }

  function verDia(f) {
    const registro = CBM.puede('mantenimientos', 'registro');
    const lista = eventosMes.filter((e) => e.fecha === f);
    const detalle = (e) => {
      if (e.clase === 'mantenimiento') return `${TIPOS[e.tipo]} · ${ESTADO_MANT[e.estado]}${e.hora ? ' · ' + e.hora : ''}`;
      if (e.clase === 'dano') return e.estado === 'atendido' ? `Daño ocurrido este día · reparado el ${fecha(e.reparado)}` : 'Daño ocurrido este día · aún sin reparar';
      if (e.clase === 'reparado') return `Se reparó este día · el daño ocurrió el ${fecha(e.ocurrio)}`;
      if (e.clase === 'llantas') return 'Cambio de llanta realizado';
      const base = `Se repite cada ${e.cada_dias} días · última vez ${fecha(e.ultima)}`;
      if (e.estado === 'vencido') return `${base} · Vencido${e.vencio_el ? ' desde el ' + fecha(e.vencio_el) : ''}: aún no se informa que se hizo`;
      if (e.estado === 'hoy') return `${base} · Toca hoy`;
      return `${base} · ${e.proyectado ? 'Fecha proyectada: si se hace antes o después, la cuenta vuelve a empezar desde ese día' : 'Próxima fecha'}`;
    };
    const acciones = (e) => {
      if (!registro) return '';
      if (e.clase === 'recordatorio') return `<div class="fila-acciones"><button class="btn" data-a="realizar" data-id="${e.plan_id}">Marcar realizado</button></div>`;
      if (e.clase === 'mantenimiento' && e.estado === 'programado') return `<div class="fila-acciones"><button class="btn" data-a="mant-estado" data-id="${e.id}" data-estado="realizado">Marcar realizado</button><button class="btn" data-a="mant-estado" data-id="${e.id}" data-estado="cancelado">Cancelar</button></div>`;
      return '';
    };
    panel(`<div class="panel"><h3>${fecha(f)}</h3><ul class="eventos">${lista.map((e) => `<li><span class="${claseEv(e)}">${CLASE_CAL[e.clase]}</span> <strong>${E(e.vehiculo)}</strong> ${E(e.titulo)}<small>${E(detalle(e))}</small>${acciones(e)}</li>`).join('')}</ul></div>`);
  }

  // Registrar un mantenimiento puntual: se elige de la lista (o se crea uno nuevo) y se llenan los datos del vehículo
  async function formMantenimiento() {
    if (!flota.length) flota = await CBM.api('/flota/vehiculos');
    const planes = await CBM.api('/flota/planes');
    panel(`<form id="f-mant" class="panel"><h3>Registrar mantenimiento</h3>
      <div class="campo"><span>¿Qué mantenimiento? (busca por nombre)</span><input id="m-buscar" maxlength="80" placeholder="Ej.: cambio de aceite, frenos…" aria-label="Buscar mantenimiento"></div>
      <small>Si ya existe, elígelo de la lista. Si no existe, la lista te ofrece crearlo.</small>
      <div id="m-crear" class="bloque-crear" hidden>
        <strong>Crear mantenimiento nuevo</strong>
        <div class="cols2"><label>Nombre<input name="n_nombre" maxlength="80"></label>
          <label>Tipo<select name="n_tipo">${Object.entries(TIPOS_CAT).map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select></label></div>
        <div class="fila-acciones"><button class="btn primario" type="button" id="m-guardar-cat">Guardar y continuar</button><button class="btn" type="button" id="m-volver">Volver a buscar</button></div>
      </div>
      <div id="m-datos" hidden>
        <div class="cols2">
          <label>Vehículo<select name="vehiculo_id" required>${opts(flota, 'id', (v) => `${v.codigo} · ${v.nombre}`)}</select></label>
          <label>Tipo<select name="tipo">${Object.entries(TIPOS_MANT).map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select></label>
          <label>Fecha<input name="fecha" type="date" value="${hoyISO()}" required></label>
          <label>Hora<input name="hora" type="time"></label>
          <label>Kilometraje<input name="km" type="number" min="0" step="1"></label>
          <label>Horas de uso<input name="horas" type="number" min="0" step="0.1"></label>
          <label>Pertenece al recordatorio (opcional)<select name="plan_id"></select></label>
          <label>Detalle (opcional)<input name="detalle" maxlength="150" placeholder="Ej. se cambió también el filtro"></label>
        </div>
        <small>Si la fecha es futura queda programado; si es de hoy o anterior, queda realizado. Si eliges el recordatorio, la cuenta vuelve a empezar desde la fecha en que se hizo.</small>
        <div class="fila-acciones"><button class="btn primario" type="submit">Guardar</button></div>
      </div></form>`);
    const f = $('#f-mant');
    let sel = null;
    const pintarPlanes = () => {
      const delVeh = planes.filter((p) => String(p.vehiculo_id) === f.vehiculo_id.value);
      f.plan_id.innerHTML = '<option value="">Ninguno</option>' + opts(delVeh, 'id', 'nombre');
      const igual = sel && delVeh.find((p) => p.nombre.toLowerCase() === sel.nombre.toLowerCase());
      if (igual) f.plan_id.value = String(igual.id);
    };
    const elegir = (c) => {
      sel = c;
      f.querySelector('#m-crear').hidden = true;
      f.querySelector('#m-datos').hidden = false;
      f.querySelector('#m-buscar').value = c.nombre;
      f.tipo.value = aTipoMant(c.tipo);
      pintarPlanes();
    };
    CBM.combo(f.querySelector('#m-buscar'), {
      buscar: (t) => CBM.api('/flota/catalogo-mantenimientos?q=' + encodeURIComponent(t)),
      nombreDe: (c) => c.nombre,
      render: (c) => `<span>${E(c.nombre)}</span><small>${TIPOS_CAT[c.tipo]}</small>`,
      alElegir: elegir,
      alEscribir: () => { sel = null; f.querySelector('#m-datos').hidden = true; f.querySelector('#m-crear').hidden = true; },
      crear: { etiqueta: (t) => `＋ Crear mantenimiento «${t}»`, alCrear: (t) => { f.querySelector('#m-datos').hidden = true; f.querySelector('#m-crear').hidden = false; f.n_nombre.value = t; f.n_tipo.focus(); } },
    });
    f.querySelector('#m-buscar').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') ev.preventDefault(); });
    f.querySelector('#m-volver').addEventListener('click', () => { f.querySelector('#m-crear').hidden = true; f.querySelector('#m-buscar').focus(); });
    f.querySelector('#m-guardar-cat').addEventListener('click', async () => {
      try {
        const c = await CBM.api('/flota/catalogo-mantenimientos', { method: 'POST', body: { nombre: f.n_nombre.value, tipo: f.n_tipo.value } });
        aviso('Mantenimiento creado.');
        elegir(c);
      } catch (err) { falla(err); }
    });
    f.vehiculo_id.addEventListener('change', pintarPlanes);
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!sel) { aviso('Elige un mantenimiento de la lista o créalo.', true); return; }
      const d = Object.fromEntries(new FormData(f));
      const cuerpo = { vehiculo_id: d.vehiculo_id, tipo: d.tipo, fecha: d.fecha, hora: d.hora, km: d.km, horas: d.horas, plan_id: d.plan_id,
        descripcion: `${sel.nombre}${d.detalle ? ' · ' + d.detalle.trim() : ''}`.slice(0, 255) };
      try { await CBM.api('/mantenimientos', { method: 'POST', body: cuerpo }); aviso('Mantenimiento registrado.'); await mostrar(); } catch (err) { falla(err); }
    });
  }

  // ---------- Chequeos y recordatorios (HU-3.4, 3.11) ----------
  async function tabChequeos() {
    if (!flota.length) flota = await CBM.api('/flota/vehiculos');
    const [planes, aj] = await Promise.all([CBM.api('/flota/recordatorios'), CBM.api('/flota/config')]);
    const total = CBM.puede('mantenimientos', 'total');
    const registro = CBM.puede('mantenimientos', 'registro');
    const filas = planes.map((p) => `<tr><td><strong>${E(p.vehiculo)}</strong></td><td>${E(p.nombre)}<small>${TIPOS_PLAN[p.tipo]}</small></td><td>${E(frecuencia(p))}</td>
      <td><span class="chip ${COLOR_PLAN[p.estado]}">${E(p.texto)}</span></td>
      <td>${registro ? `<div class="fila-acciones"><button class="btn" data-a="realizar" data-id="${p.id}">Marcar realizado</button><button class="btn peligro" data-a="plan-quitar" data-id="${p.id}" data-veh="${p.vehiculo_id}">Eliminar</button></div>` : ''}</td></tr>`).join('');
    $('#man-tab').innerHTML = `
      <div class="panel"><h3>Recordatorios (lo más urgente primero)</h3>
        ${planes.length ? `<div class="tabla-wrap"><table><thead><tr><th>Vehículo</th><th>Chequeo o mantenimiento</th><th>Frecuencia</th><th>Próximo</th><th></th></tr></thead><tbody>${filas}</tbody></table></div>` : '<p class="vacio">Aún no hay chequeos programados.</p>'}</div>
      ${registro ? `<div class="panel"><h3>Agregar o quitar mantenimientos de un vehículo</h3>
        <div class="fila-acciones"><select id="sel-veh-plan" aria-label="Vehículo">${opts(flota, 'id', (v) => `${v.codigo} · ${v.nombre}`)}</select><button class="btn primario" data-a="plan-veh-sel">Administrar mantenimientos</button></div></div>` : ''}
      ${total ? `<form id="f-aviso" class="panel"><h3>Cuándo avisar</h3>
          <div class="cols2"><label>Días antes<input name="aviso_dias" type="number" min="1" value="${aj.aviso_dias}"></label><label>Km antes<input name="aviso_km" type="number" min="1" value="${aj.aviso_km}"></label><label>Horas antes<input name="aviso_horas" type="number" min="1" value="${aj.aviso_horas}"></label></div>
          <div class="fila-acciones"><button class="btn" type="submit">Guardar</button></div></form>` : ''}`;
    if (total) enviar($('#f-aviso'), '/flota/config', { method: 'PUT' }, 'Avisos actualizados.', mostrar);
  }

  async function formRealizar(id) {
    const planes = await CBM.api('/flota/planes');
    const p = planes.find((x) => String(x.id) === String(id));
    if (!p) return;
    panel(`<form id="f-real" class="panel"><h3>Marcar como realizado · ${E(p.vehiculo)} · ${E(p.nombre)}</h3>
      <div class="cols2"><label>Fecha en que se hizo<input name="fecha" type="date" value="${hoyISO()}" max="${hoyISO()}" required></label>
        <label>Kilometraje (opcional)<input name="km" type="number" min="0" step="1"></label><label>Horas de uso (opcional)<input name="horas" type="number" min="0" step="0.1"></label></div>
      <label>Notas (opcional)<input name="notas" maxlength="120"></label>
      <small>Queda en el historial y en el calendario del día en que se hizo, y la cuenta de este recordatorio vuelve a empezar desde esa fecha${p.cada_dias ? ` (la próxima será cada ${p.cada_dias} días después)` : ''}.</small>
      <div class="fila-acciones"><button class="btn primario" type="submit">Marcar realizado</button></div></form>`);
    enviar($('#f-real'), `/flota/planes/${id}/realizar`, { method: 'POST' }, 'Chequeo registrado.', mostrar);
  }
})();
