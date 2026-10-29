(() => {
  window.CBM = window.CBM || {};
  window.CBM.vistas = window.CBM.vistas || {};

  const UNIDAD = { disponible: ['Disponible', 'verde'], en_servicio: ['En servicio', 'azul'], fuera_de_servicio: ['Fuera de servicio', 'rojo'], atencion_requerida: ['Atención requerida', 'ambar'] };
  let raiz = null;
  let opciones = { usuarios: [], turnos: [], turno_activo: null };
  let filtros = { desde: '', hasta: '', turno_id: '' };

  const E = (v) => CBM.esc(v);
  const $ = (s) => raiz.querySelector(s);
  const aviso = (m, mal) => CBM.aviso(m, mal);
  const falla = (e) => aviso(e.message, true);
  const fecha = (t) => (t ? `${t.slice(8, 10)}/${t.slice(5, 7)} ${t.slice(11, 16)}` : '—');
  const yo = () => CBM.sesion.usuario.id;

  window.CBM.vistas.entregas = async (el) => {
    el.innerHTML = '<div id="ent-raiz"></div>';
    raiz = el.querySelector('#ent-raiz');
    filtros = { desde: '', hasta: '', turno_id: '' };
    raiz.addEventListener('click', alClic);
    opciones = await CBM.api('/entregas/opciones');
    await cargar();
  };

  async function cargar() {
    const qs = new URLSearchParams(Object.entries(filtros).filter(([, v]) => v)).toString();
    const [paraMi, novedades, historial] = await Promise.all([
      CBM.api('/entregas?para_mi=1'), CBM.api('/entregas/novedades'), CBM.api('/entregas' + (qs ? '?' + qs : '')),
    ]);
    const registro = CBM.puede('entregas', 'registro');

    const pendientes = paraMi.length ? `<div class="panel"><h3>Turnos que te entregaron y debes recibir</h3><ul class="lista">${paraMi.map((e) => `
      <li class="emergencia"><div><strong>Entrega de ${E(e.entrega)}</strong><small>${E(e.turno || 'Sin turno')} · ${fecha(e.fecha_entrega)}</small></div>
      <button class="btn primario" data-a="abrir" data-id="${e.id}">Ver y recibir</button></li>`).join('')}</ul></div>` : '';

    const filasNov = novedades.map((n) => `<li><strong>${E(n.descripcion)}</strong><small>${E(n.autor || '—')} · ${fecha(n.creado_en)}${n.turno ? ' · Turno ' + E(n.turno) : ''}</small></li>`).join('');
    const filasHist = historial.map((e) => `<tr><td>${fecha(e.fecha_entrega)}</td><td>${E(e.turno || '—')}</td><td>${E(e.entrega)}</td><td>${E(e.recibe)}</td>
      <td><span class="chip ${e.estado === 'recibida' ? 'verde' : 'ambar'}">${e.estado === 'recibida' ? 'Recibida' : 'Pendiente'}</span></td>
      <td><button class="btn" data-a="abrir" data-id="${e.id}">Abrir</button></td></tr>`).join('');

    raiz.innerHTML = `
      ${pendientes}
      <div class="cols">
        <div class="panel"><h3>Novedades del turno</h3>
          ${registro ? '<form id="f-nov" class="fila-acciones"><input name="descripcion" required maxlength="500" placeholder="Escribe una novedad" aria-label="Novedad" style="flex:1 1 240px"><button class="btn primario" type="submit">Agregar</button></form>' : ''}
          ${novedades.length ? `<ul class="eventos">${filasNov}</ul>` : '<p class="vacio">Aún no hay novedades en este turno.</p>'}
          <small>Las novedades pasan a la entrega de turno cuando la envías.</small></div>
        <div class="panel"><h3>Entregar el turno</h3>
          <p>Turno activo: <strong>${E(opciones.turno_activo ? opciones.turno_activo.nombre : 'ninguno')}</strong></p>
          <small>Se envía un resumen de la estación a quien recibe, y esa persona lo confirma desde su sesión.</small>
          ${registro ? '<div class="fila-acciones"><button class="btn primario" data-a="entregar">Entregar turno</button></div>' : ''}</div>
      </div>
      <div class="panel"><h3>Historial de entregas</h3>
        <div class="barra">
          <label>Desde<input id="f-desde" type="date" value="${filtros.desde}"></label>
          <label>Hasta<input id="f-hasta" type="date" value="${filtros.hasta}"></label>
          <label>Turno<select id="f-turno"><option value="">Todos</option>${opciones.turnos.map((t) => `<option value="${t.id}"${String(t.id) === String(filtros.turno_id) ? ' selected' : ''}>${E(t.nombre)}</option>`).join('')}</select></label>
        </div>
        ${historial.length ? `<div class="tabla-wrap"><table><thead><tr><th>Fecha</th><th>Turno</th><th>Entrega</th><th>Recibe</th><th>Estado</th><th></th></tr></thead><tbody>${filasHist}</tbody></table></div>` : '<p class="vacio">No hay entregas con esos filtros.</p>'}
      </div>
      <div id="ent-detalle"></div>`;

    $('#f-nov')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await CBM.api('/entregas/novedades', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); aviso('Novedad registrada.'); await cargar(); } catch (err) { falla(err); }
    });
    [['f-desde', 'desde'], ['f-hasta', 'hasta'], ['f-turno', 'turno_id']].forEach(([id, clave]) => {
      $('#' + id).addEventListener('change', (e) => { filtros[clave] = e.target.value; cargar().catch(falla); });
    });
  }

  function panel(html) { const d = $('#ent-detalle'); d.innerHTML = html; d.scrollIntoView({ behavior: 'smooth', block: 'start' }); }

  // Resumen de la estación (el mismo para la vista previa y para las entregas guardadas)
  function resumen(r) {
    const lista = (items, vacio) => (items.length ? `<ul class="eventos">${items.join('')}</ul>` : `<p class="vacio">${vacio}</p>`);
    return `
      <div class="fila-acciones"><span class="chip ${r.alertas_urgentes ? 'rojo' : 'verde'}">${r.alertas_urgentes} alerta(s) urgente(s)</span></div>
      <h3>Personal del turno</h3>
      ${lista((r.personal || []).map((p) => `<li><strong>${E(p.nombre)}</strong> ${p.tipo === 'refuerzo' ? `<span class="chip ambar">Horas extras${p.horas ? ' · ' + p.horas + ' h' : ''}</span>` : ''} ${p.en_turno ? '<span class="chip verde">En turno</span>' : ''}</li>`), 'Sin personal asignado a este turno.')}
      <h3>Estado de las unidades</h3>
      ${lista(r.unidades.map((u) => `<li><strong>${E(u.codigo)}</strong> <span class="chip ${UNIDAD[u.estado][1]}">${UNIDAD[u.estado][0]}</span>${u.aviso ? `<small>${E(u.aviso)}</small>` : ''}</li>`), 'Sin unidades registradas.')}
      <h3>Equipos dañados o perdidos</h3>
      ${lista(r.equipos_reportados.map((x) => `<li><strong>${E(x.nombre)}</strong> (${E(x.codigo)}) · ${E(x.ubicacion)}<small>${x.tipo === 'perdido' ? 'Perdido' : 'Dañado'}: ${E(x.descripcion)}</small></li>`), 'Sin equipos reportados.')}
      <h3>Daños en vehículos sin atender</h3>
      ${lista(r.danos_vehiculos.map((x) => `<li><strong>${E(x.vehiculo)}</strong> ${E(x.descripcion)}</li>`), 'Sin daños pendientes.')}
      <h3>Préstamos activos</h3>
      ${lista(r.prestamos.map((p) => `<li><strong>${E(p.nombre)}</strong>${p.es_vehiculo ? ' (vehículo, con todo su equipo)' : p.cantidad > 1 ? ' x' + p.cantidad : ''} (${E(p.codigo)}) · ${E(p.persona_nombre)} · ${E(p.persona_telefono)}<small>Hasta ${fecha(p.fecha_limite)} ${p.vencido ? '<span class="chip rojo">Vencido</span>' : ''}</small></li>`), 'Sin préstamos activos.')}
      <h3>Emergencias abiertas</h3>
      ${lista(r.emergencias.map((x) => `<li><strong>#${E(x.codigo)}</strong> ${E(x.tipo)} · ${E(x.ubicacion)}<small>Unidad ${E(x.unidades || '—')}</small></li>`), 'No hay emergencias abiertas.')}
      <h3>Novedades del turno</h3>
      ${lista(r.novedades.map((n) => `<li>${E(n.descripcion)}<small>${E(n.autor || '—')} · ${fecha(n.creado_en)}</small></li>`), 'Sin novedades.')}`;
  }

  async function alClic(ev) {
    const b = ev.target.closest('[data-a]');
    if (!b) return;
    try {
      if (b.dataset.a === 'entregar') await formEntrega();
      else if (b.dataset.a === 'abrir') await abrirEntrega(b.dataset.id);
    } catch (e) { falla(e); }
  }

  // ---------- HU-8.1: entregar el turno ----------
  async function formEntrega() {
    const r = await CBM.api('/entregas/preview');
    const sig = opciones.turno_siguiente;
    const otros = opciones.usuarios.filter((u) => u.id !== yo()).sort((a, b) => (b.turno_id === (sig && sig.id)) - (a.turno_id === (sig && sig.id)));
    panel(`<form id="f-ent" class="panel"><h3>Entregar turno</h3>
      <small>Esto es lo que va a recibir la otra persona. Revísalo antes de enviar.</small>
      ${resumen(r)}
      <label>Quién recibe el turno<select name="recibe_por" required>${otros.map((u) => `<option value="${u.id}">${E(u.nombre)}${u.turno ? ' · ' + E(u.turno) : ''}</option>`).join('')}</select></label>
      ${sig ? `<small>El turno que sigue en la rotación es <strong>${E(sig.nombre)}</strong> (sus integrantes aparecen primero). El turno se entrega a las 8:00 a. m.</small>` : ''}
      <label>Observaciones de cómo entregas el turno (opcional)<textarea name="observaciones" rows="3" maxlength="500" placeholder="Estado de la estación, pendientes, cosas a tener en cuenta"></textarea></label>
      <small>Quedará registrado que entrega ${E(CBM.sesion.usuario.nombre)}, con fecha y hora. Quien recibe confirma desde su sesión.</small>
      <div class="fila-acciones"><button class="btn primario" type="submit">Entregar turno</button><button class="btn" type="button" id="cancelar">Cancelar</button></div></form>`);
    $('#cancelar').addEventListener('click', () => { $('#ent-detalle').innerHTML = ''; });
    $('#f-ent').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await CBM.api('/entregas', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
        aviso('Turno entregado. Falta que la otra persona lo reciba.');
        await cargar();
      } catch (err) { falla(err); }
    });
  }

  // ---------- Abrir una entrega y, si corresponde, recibirla ----------
  async function abrirEntrega(id) {
    const t = await CBM.api('/entregas/' + id);
    const puedeRecibir = t.estado === 'pendiente' && CBM.puede('entregas', 'registro') && (t.recibe_por === yo() || CBM.puede('entregas', 'total'));
    panel(`<div class="panel"><div class="fila-cab"><h3>Entrega de turno · ${E(t.turno || 'Sin turno')}</h3>
        <span class="chip ${t.estado === 'recibida' ? 'verde' : 'ambar'}">${t.estado === 'recibida' ? 'Recibida' : 'Pendiente de recibir'}</span></div>
      <dl class="datos">
        <div><dt>Entrega</dt><dd>${E(t.entrega)} · ${fecha(t.fecha_entrega)}</dd></div>
        <div><dt>Recibe</dt><dd>${E(t.recibe)} · ${t.estado === 'recibida' ? fecha(t.fecha_recepcion) + (t.recibido_por && t.recibido_por !== t.recibe ? ' (confirmó ' + E(t.recibido_por) + ')' : '') : 'sin confirmar'}</dd></div>
        ${t.observaciones ? `<div><dt>Observaciones</dt><dd>${E(t.observaciones)}</dd></div>` : ''}
        ${t.notas_recepcion ? `<div><dt>Notas de quien recibe</dt><dd>${E(t.notas_recepcion)}</dd></div>` : ''}
      </dl>
      ${resumen(t.resumen)}
      ${puedeRecibir ? `<form id="f-rec" class="form-grid"><label>Observaciones de cómo recibes el turno (opcional)<textarea name="notas" rows="3" maxlength="500" placeholder="Qué encontraste al recibir: estado, faltantes, novedades"></textarea></label>
        <div class="fila-acciones"><button class="btn primario" type="submit">Confirmar que recibo el turno</button></div></form>` : ''}</div>`);
    $('#f-rec')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const r = await CBM.api(`/entregas/${id}/recibir`, { method: 'PATCH', body: Object.fromEntries(new FormData(e.target)) });
        if (r.turno_activo) { CBM.sesion.turno = r.turno_activo; const chip = document.querySelector('#turno'); chip.textContent = 'Turno activo: ' + r.turno_activo.nombre; chip.className = 'chip verde'; }
        aviso('Turno recibido. Ahora el turno activo es ' + (r.turno_activo ? r.turno_activo.nombre : '—') + '.');
        await cargar();
      } catch (err) { falla(err); }
    });
  }
})();
