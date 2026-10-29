(() => {
  window.CBM = window.CBM || {};
  window.CBM.vistas = window.CBM.vistas || {};

  const SEVERIDAD = { critica: ['Urgente', 'rojo'], alta: ['Atención', 'ambar'], media: ['Revisar', ''] };
  const UNIDAD = { disponible: ['Disponible', 'verde'], en_servicio: ['En servicio', 'azul'], fuera_de_servicio: ['Fuera de servicio', 'rojo'], atencion_requerida: ['Atención requerida', 'ambar'] };
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

  let raiz = null;
  let alertas = [];
  let panelAbierto = null; // función que vuelve a pintar el panel inferior después de una acción

  const E = (v) => CBM.esc(v);
  const $ = (s) => raiz.querySelector(s);
  const hora = (t) => (t ? String(t).slice(11, 16) : '');
  const aviso = (m, mal) => CBM.aviso(m, mal);
  const falla = (e) => aviso(e.message, true);
  const opts = (lista, valor, etiqueta) => lista.map((o) => `<option value="${o[valor]}">${E(typeof etiqueta === 'function' ? etiqueta(o) : o[etiqueta])}</option>`).join('');
  const panel = (html) => { const d = $('#dash-detalle'); d.innerHTML = html; d.scrollIntoView({ behavior: 'smooth', block: 'start' }); };

  window.CBM.vistas.dashboard = async (el) => {
    el.innerHTML = '<div id="dash-raiz"></div>';
    raiz = el.querySelector('#dash-raiz');
    panelAbierto = null;
    const hoy = new Date();
    raiz.innerHTML = `
      <div class="fila-cab">
        <div><h3 style="font-size:20px">Buen día, ${E(CBM.sesion.usuario.nombre.split(' ')[0])}</h3>
          <small>${DIAS[hoy.getDay()]}, ${hoy.getDate()} de ${MESES[hoy.getMonth()]} · Atienda primero lo marcado como urgente.</small></div>
        <div class="fila-acciones">
          ${CBM.puede('inventarios', 'registro') ? '<button class="btn" data-a="reportar-eq">Reportar equipo dañado / perdido</button>' : ''}
          ${CBM.puede('dashboard', 'registro') ? '<button class="btn primario" data-a="nueva-em">Registrar emergencia</button>' : ''}
        </div>
      </div>
      <div id="dash-main"></div><div id="dash-detalle"></div>`;
    raiz.addEventListener('click', alClic);
    await cargar();
  };

  async function cargar() {
    const d = await CBM.api('/dashboard');
    alertas = d.alertas;
    const t = d.tarjetas;
    const variacion = t.variacion_pct === null ? '' : `<small>${t.variacion_pct <= 0 ? '↓' : '↑'} ${Math.abs(t.variacion_pct)}% vs. ${MESES[t.mes_anterior - 1]}</small>`;
    const registro = CBM.puede('dashboard', 'registro');

    const listaAlertas = alertas.map((a, i) => {
      const [txt, color] = SEVERIDAD[a.severidad];
      return `<li class="alerta ${a.severidad}"><div><strong>${E(a.titulo)}</strong><small>${E(a.detalle)}</small></div>
        <div class="fila-acciones"><span class="chip ${color}">${txt}</span><button class="btn" data-a="alerta" data-i="${i}">${E(a.accion.etiqueta)}</button></div></li>`;
    }).join('');

    const unidades = d.unidades.map((u) => `<li class="fila-unidad"><strong>${E(u.codigo)}</strong><span class="chip ${UNIDAD[u.estado][1]}">${UNIDAD[u.estado][0]}</span></li>`).join('');

    const abiertas = d.emergencias_abiertas.map((e) => `<li class="emergencia">
        <div><strong>#${E(e.codigo)} · ${E(e.tipo)}</strong><small>${E(e.ubicacion)} · Unidad ${E(e.unidades || '—')} · Salida ${hora(e.fecha_salida)}</small>
        <small>Personal confirmado: ${e.personal_confirmado} de ${e.personal_total}</small></div>
        <div class="fila-acciones"><button class="btn" data-a="asignar" data-id="${e.id}">${registro ? 'Gestionar asignación' : 'Ver asignación'}</button></div></li>`).join('');

    $('#dash-main').innerHTML = `
      <div class="tarjetas">
        <div class="tarjeta"><div class="num">${t.operativos}</div><span>Vehículos operativos</span><small>de ${t.total_unidades} unidades</small></div>
        <div class="tarjeta"><div class="num">${t.en_mantenimiento}</div><span>En mantenimiento</span></div>
        <div class="tarjeta"><div class="num">${t.alertas_activas}</div><span>Alertas activas</span><small>${t.alertas_urgentes} requieren acción</small></div>
        <div class="tarjeta"><div class="num">${t.emergencias_mes}</div><span>Emergencias del mes</span>${variacion}</div>
        <div class="tarjeta"><div class="num">${t.reportes_abiertos}</div><span>Reportes de posibles desaparecidos</span><small>${t.reportes_nuevos} sin revisar</small></div>
      </div>
      <div class="cols">
        <div class="panel"><h3>Alertas urgentes</h3>${alertas.length ? `<ul class="lista">${listaAlertas}</ul>` : '<p class="vacio">Sin alertas. Todo al día.</p>'}</div>
        <div class="panel"><h3>Estado de unidades</h3>${unidades ? `<ul class="lista">${unidades}</ul>` : '<p class="vacio">Aún no hay unidades registradas.</p>'}</div>
      </div>
      <div class="panel"><h3>Emergencias en curso</h3>${abiertas ? `<ul class="lista">${abiertas}</ul>` : '<p class="vacio">No hay emergencias abiertas.</p>'}</div>`;
  }

  async function refrescar() {
    await cargar();
    if (panelAbierto) await panelAbierto();
  }

  async function alClic(ev) {
    const b = ev.target.closest('[data-a]');
    if (!b) return;
    try {
      if (b.dataset.a === 'alerta') await accionAlerta(alertas[Number(b.dataset.i)]);
      else if (b.dataset.a === 'nueva-em') await formEmergencia();
      else if (b.dataset.a === 'reportar-eq') formReporte();
      else if (b.dataset.a === 'asignar') await panelAsignacion(b.dataset.id);
    } catch (e) { falla(e); }
  }

  // HU-4.4: cada alerta tiene su acción directa
  async function accionAlerta(a) {
    const x = a.accion;
    if (x.tipo === 'ir') return CBM.abrirModulo(x.modulo);
    if (x.tipo === 'ver_equipo') return CBM.abrirEquipo(x.equipo_id);
    if (x.tipo === 'retirar') await CBM.api(`/equipos/${x.equipo_id}`, { method: 'PUT', body: { vehiculo_id: null } });
    if (x.tipo === 'recarga') await CBM.api(`/equipos/${x.equipo_id}/estado`, { method: 'PATCH', body: { estado: 'en_mantenimiento', motivo: 'Recarga programada' } });
    if (x.tipo === 'dano_atendido') await CBM.api(`/flota/danos/${x.id}`, { method: 'PATCH' });
    if (x.tipo === 'reporte_atendido') await CBM.api(`/equipos/reportes/${x.id}`, { method: 'PATCH' });
    aviso('Listo.');
    await refrescar();
  }

  // ---------- HU-4.1: registrar emergencia ----------
  async function formEmergencia() {
    panelAbierto = null;
    const op = await CBM.api('/emergencias/opciones');
    panel(`<form id="f-em" class="panel"><h3>Registrar emergencia</h3>
      <div class="cols2">
        <label>Tipo<select name="tipo">${opts(op.tipos.map((t) => ({ t })), 't', 't')}</select></label>
        <label>Hora de salida<input name="fecha_salida" type="time"></label>
      </div>
      <label>Ubicación<input name="ubicacion" required maxlength="160" placeholder="Barrio, vereda o dirección"></label>
      <label>Descripción (opcional)<input name="descripcion" maxlength="255"></label>
      <fieldset><legend>Unidades que salen</legend>
        ${op.vehiculos.length ? op.vehiculos.map((v) => `<label class="check"><input type="checkbox" name="vehiculo_ids" value="${v.id}"> ${E(v.codigo)} · ${E(v.nombre)}</label>`).join('') : '<p class="vacio">No hay unidades disponibles en este momento.</p>'}
      </fieldset>
      <small>Si dejas la hora vacía se usa la hora actual. Las unidades elegidas pasan a "En servicio".</small>
      <div class="fila-acciones"><button class="btn primario" type="submit">Registrar emergencia</button></div></form>`);
    $('#f-em').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      try {
        const r = await CBM.api('/emergencias', { method: 'POST', body: {
          tipo: f.get('tipo'), ubicacion: f.get('ubicacion'), descripcion: f.get('descripcion'), fecha_salida: f.get('fecha_salida'),
          vehiculo_ids: f.getAll('vehiculo_ids'),
        } });
        aviso(`Emergencia #${r.codigo} registrada.`);
        await cargar();
        await panelAsignacion(r.id);
      } catch (err) { falla(err); }
    });
  }

  // ---------- HU-4.2: asignar personal ----------
  async function panelAsignacion(id) {
    const [em, op] = await Promise.all([CBM.api(`/emergencias/${id}`), CBM.api('/emergencias/opciones')]);
    const registro = CBM.puede('dashboard', 'registro') && em.estado === 'abierta';
    const cargo = Object.fromEntries(op.cargos.map((c) => [c.id, c.nombre]));
    const asignados = new Set(em.personal.map((p) => p.usuario_id));
    const filas = em.personal.map((p) => `<tr><td>${E(p.nombre)}</td><td>${E(cargo[p.cargo])}</td>
      <td><span class="chip ${p.estado === 'confirmado' ? 'verde' : 'ambar'}">${p.estado === 'confirmado' ? 'Confirmado' : 'Por confirmar'}</span></td>
      <td>${registro ? `<div class="fila-acciones"><button class="btn" data-p="estado" data-aid="${p.asignacion_id}" data-estado="${p.estado === 'confirmado' ? 'por_confirmar' : 'confirmado'}">${p.estado === 'confirmado' ? 'Pasar a por confirmar' : 'Confirmar'}</button><button class="btn" data-p="quitar" data-aid="${p.asignacion_id}">Quitar</button></div>` : ''}</td></tr>`).join('');

    panelAbierto = () => panelAsignacion(id);
    panel(`<div class="panel"><div class="fila-cab"><h3>Asignación de personal · #${E(em.codigo)}</h3><span class="chip ${em.estado === 'abierta' ? 'azul' : ''}">${em.estado === 'abierta' ? 'Abierta' : 'Cerrada'}</span></div>
      <small>${E(em.tipo)} · ${E(em.ubicacion)} · Unidad ${E(em.unidades || '—')}${em.descripcion ? ' · ' + E(em.descripcion) : ''}</small>
      ${registro ? `<form id="f-salida" class="fila-acciones"><label>Hora de salida estimada<input name="fecha_salida" type="time" value="${hora(em.fecha_salida)}" required></label><button class="btn" type="submit">Guardar hora</button></form>` : `<small>Salida ${hora(em.fecha_salida)}</small>`}
      ${em.personal.length ? `<div class="tabla-wrap"><table><thead><tr><th>Persona</th><th>Cargo</th><th>Estado</th><th></th></tr></thead><tbody>${filas}</tbody></table></div>` : '<p class="vacio">Aún no hay personal asignado.</p>'}
      ${registro ? `<form id="f-asig" class="cols2"><label>Persona<select name="usuario_id" required>${opts(op.usuarios.filter((u) => !asignados.has(u.id)), 'id', (u) => u.nombre + (u.situacion === 'en_turno' ? ' · en turno' : ''))}</select></label>
        <label>Cargo<select name="cargo">${opts(op.cargos, 'id', 'nombre')}</select></label>
        <div class="fila-acciones"><button class="btn primario" type="submit">Asignar</button></div></form>
        <div class="fila-acciones"><button class="btn" data-p="cerrar">Cerrar emergencia</button></div>` : ''}</div>`);

    const detalle = $('#dash-detalle');
    detalle.onclick = async (ev) => {
      const b = ev.target.closest('[data-p]');
      if (!b) return;
      try {
        if (b.dataset.p === 'estado') await CBM.api(`/emergencias/${id}/personal/${b.dataset.aid}`, { method: 'PATCH', body: { estado: b.dataset.estado } });
        if (b.dataset.p === 'quitar') await CBM.api(`/emergencias/${id}/personal/${b.dataset.aid}`, { method: 'DELETE' });
        if (b.dataset.p === 'cerrar') {
          if (!window.confirm('¿Cerrar la emergencia? Las unidades volverán a estar disponibles.')) return;
          await CBM.api(`/emergencias/${id}/cerrar`, { method: 'PATCH' });
          aviso('Emergencia cerrada.');
          panelAbierto = null;
          detalle.innerHTML = '';
          await cargar();
          return;
        }
        await refrescar();
      } catch (err) { falla(err); }
    };
    $('#f-asig')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await CBM.api(`/emergencias/${id}/personal`, { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); await refrescar(); } catch (err) { falla(err); }
    });
    $('#f-salida')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await CBM.api(`/emergencias/${id}`, { method: 'PATCH', body: Object.fromEntries(new FormData(e.target)) }); aviso('Hora de salida actualizada.'); await refrescar(); } catch (err) { falla(err); }
    });
  }

  // ---------- HU-4.6: reportar equipo dañado o perdido ----------
  function formReporte() {
    panelAbierto = null;
    panel(`<form id="f-rep" class="panel"><h3>Reportar equipo dañado o perdido</h3>
      <div class="cols2"><label>Código del equipo<input name="codigo" required maxlength="40" placeholder="Ej. MAN-25-07"></label>
      <label>Qué pasó<select name="tipo"><option value="danado">Está dañado</option><option value="perdido">Se perdió</option></select></label></div>
      <label>Descripción<input name="descripcion" required maxlength="255" placeholder="Ej. Manguera con fuga en el acople"></label>
      <small>Queda en la hoja de vida del equipo y aparece como alerta en el dashboard.</small>
      <div class="fila-acciones"><button class="btn primario" type="submit">Enviar reporte</button></div></form>`);
    $('#f-rep').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      try {
        const buscados = await CBM.api(`/equipos?q=${encodeURIComponent(f.codigo.trim())}&limit=10&incluir_bajas=1`);
        const equipo = buscados.equipos.find((x) => x.codigo.toLowerCase() === f.codigo.trim().toLowerCase());
        if (!equipo) throw new Error('No encontré un equipo con ese código. Revisa que esté escrito igual que en el inventario.');
        await CBM.api(`/equipos/${equipo.id}/reportes`, { method: 'POST', body: { tipo: f.tipo, descripcion: f.descripcion } });
        aviso('Reporte enviado.');
        $('#dash-detalle').innerHTML = '';
        await cargar();
      } catch (err) { falla(err); }
    });
  }
})();
