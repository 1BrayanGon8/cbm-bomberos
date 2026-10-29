// Módulo "Personas desaparecidas" (bomberos): marcar catástrofes en el mapa, atender los reportes del público
// y publicar a las personas que ya se ubicaron. El público lo ve desde buscar.html (sin iniciar sesión).
(() => {
  window.CBM = window.CBM || {};
  window.CBM.vistas = window.CBM.vistas || {};

  const TIPO_PERSONA = { nino: 'Niño o niña', adolescente: 'Adolescente', adulto: 'Adulto', adulto_mayor: 'Adulto mayor' };
  const CONDICION = { ilesa: 'Sin lesiones visibles', herida: 'Con lesiones', hospitalizada: 'Hospitalizada' };
  const SEXO = { mujer: 'Mujer', hombre: 'Hombre', otro: 'Otro', no_se: 'No se sabe' };
  const ESTADO_REP = { nuevo: ['Nuevo', 'rojo'], en_revision: ['En revisión', 'ambar'], resuelto: ['Resuelto', 'verde'] };
  const PARECIDO = { alto: 'verde', medio: 'ambar', bajo: '' };

  let raiz = null;
  let pestana = 'mapa';
  let catalogo = { tipos: [], categorias: [] };
  let mapaCfg = { lat: 4.8147, lng: -74.3547, radio_km: 12 };
  let mapa = null;
  let eventos = [];
  let halladas = [];
  let resumen = {};

  const E = (v) => CBM.esc(v);
  const $ = (s) => raiz.querySelector(s);
  const aviso = (m, mal) => CBM.aviso(m, mal);
  const falla = (e) => aviso(e.message, true);
  const cuando = (t) => (t ? `${t.slice(8, 10)}/${t.slice(5, 7)} · ${t.slice(11, 16)}` : '');
  const registro = () => CBM.puede('desaparecidos', 'registro');
  const tipoDe = (id) => catalogo.tipos.find((t) => t.id === id) || { icono: '⚠️', nombre: 'Emergencia', definicion: '' };

  window.CBM.vistas.desaparecidos = async (el) => {
    el.innerHTML = '<div id="des-raiz"></div>';
    raiz = el.querySelector('#des-raiz');
    pestana = 'mapa';
    raiz.addEventListener('click', alClic);
    raiz.addEventListener('change', alCambiar);
    [catalogo, mapaCfg] = await Promise.all([CBM.api('/publico/catalogo'), CBM.api('/desaparecidos/mapa')]);
    await armar();
  };

  async function armar() {
    resumen = await CBM.api('/busqueda/resumen');
    const nuevos = resumen.reportes_nuevos;
    raiz.innerHTML = `
      <div class="tarjetas">
        <div class="tarjeta${nuevos ? ' alerta-roja' : ''}"><div class="num">${resumen.reportes_abiertos}</div><span>Reportes de posibles desaparecidos</span><small>${nuevos} sin revisar</small></div>
        <div class="tarjeta"><div class="num">${resumen.eventos_activos}</div><span>Eventos activos en el mapa</span></div>
        <div class="tarjeta"><div class="num">${resumen.halladas_publicadas}</div><span>Personas halladas publicadas</span></div>
      </div>
      <div class="pestanas" role="tablist">
        <button class="pestana${pestana === 'mapa' ? ' activa' : ''}" data-a="pestana" data-p="mapa" role="tab">Mapa y eventos</button>
        <button class="pestana${pestana === 'reportes' ? ' activa' : ''}" data-a="pestana" data-p="reportes" role="tab">Reportes del público${nuevos ? `<span class="insignia">${nuevos}</span>` : ''}</button>
        <button class="pestana${pestana === 'halladas' ? ' activa' : ''}" data-a="pestana" data-p="halladas" role="tab">Personas halladas</button>
      </div>
      <div id="des-contenido"></div><div id="des-detalle"></div>`;
    mapa = null;
    if (pestana === 'mapa') await vistaMapa();
    else if (pestana === 'reportes') await vistaReportes();
    else await vistaHalladas();
  }

  // =====================================================================
  // Pestaña 1: mapa con las catástrofes (zonas rojas con su dibujo)
  // =====================================================================
  async function vistaMapa() {
    eventos = await CBM.api('/busqueda/eventos?estado=activo');
    halladas = await CBM.api('/busqueda/halladas');
    $('#des-contenido').innerHTML = `
      <div class="panel">
        <div class="fila-cab"><h3>Zonas afectadas</h3>${registro() ? '<button class="btn primario" data-a="nuevo-evento">Marcar evento en el mapa</button>' : ''}</div>
        <div id="mapa-des"></div>
        <div class="leyenda"><span>🔴 Zona afectada (pasa el cursor para ver qué ocurrió)</span><span>🧍 Persona hallada</span><span>🚒 Estación</span><span>Arrastra para moverte · + / − para acercar</span></div>
      </div>
      <div class="panel"><h3>Eventos activos</h3>${eventos.length ? `<ul class="lista">${eventos.map(filaEvento).join('')}</ul>` : '<p class="vacio">No hay eventos activos. El público no puede enviar reportes hasta que marques una zona afectada.</p>'}</div>
      ${CBM.puede('desaparecidos', 'total') ? formMapaCfg() : ''}`;
    mapa = MapaEventos.crear($('#mapa-des'), {
      catalogo,
      centro: mapaCfg,
      onEvento: (ev) => detalleEvento(ev),
      onHallada: (h) => aviso(`${h.nombre || 'Persona sin identificar'} · ${h.ubicacion_actual}`),
      extraTooltip: (ev) => `<small>${ev.reportes} reporte(s) abierto(s)</small>`,
    });
    mapa.setEventos(eventos);
    mapa.setHalladas(halladas);
    if (eventos.length) mapa.ajustar();
    $('#f-mapa')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try { mapaCfg = await CBM.api('/desaparecidos/mapa', { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) }); aviso('Centro del mapa actualizado.'); await armar(); } catch (err) { falla(err); }
    });
  }

  const filaEvento = (e) => {
    const t = tipoDe(e.tipo);
    return `<li class="emergencia"><div><strong>${t.icono} ${E(t.nombre)} · ${E(e.titulo)}</strong><small>${e.descripcion ? E(e.descripcion) + ' · ' : ''}Radio ${e.radio_m >= 1000 ? (e.radio_m / 1000).toFixed(1) + ' km' : e.radio_m + ' m'} · ${cuando(e.creado_en)} · ${E(e.creado_por || '—')}</small><small>${e.reportes} reporte(s) de posibles desaparecidos sin cerrar</small></div>
      <div class="fila-acciones"><button class="btn" data-a="ver-evento" data-id="${e.id}">Ver</button>${registro() ? `<button class="btn" data-a="cerrar-evento" data-id="${e.id}">Cerrar evento</button>` : ''}</div></li>`;
  };

  const formMapaCfg = () => `<form id="f-mapa" class="panel"><h3>Centro del mapa (estación)</h3>
    <div class="cols2"><label>Latitud<input name="lat" type="number" step="any" value="${mapaCfg.lat}"></label><label>Longitud<input name="lng" type="number" step="any" value="${mapaCfg.lng}"></label><label>Alcance inicial (km)<input name="radio_km" type="number" min="1" max="200" value="${mapaCfg.radio_km}"></label></div>
    <div class="fila-acciones"><button class="btn" type="submit">Guardar centro</button></div></form>`;

  function detalleEvento(ev) {
    mapa?.seleccionar(ev.id);
    const t = tipoDe(ev.tipo);
    $('#des-detalle').innerHTML = `<div class="panel"><div class="fila-cab"><h3>${t.icono} ${E(t.nombre)} · ${E(ev.titulo)}</h3><button class="btn" data-a="cerrar-detalle">Cerrar</button></div>
      <dl class="datos"><div><dt>Qué ocurrió</dt><dd>${E(ev.descripcion || '—')}</dd></div><div><dt>Definición</dt><dd>${E(t.definicion)}</dd></div>
      <div><dt>Radio de la zona</dt><dd>${ev.radio_m} m</dd></div><div><dt>Reportes abiertos</dt><dd>${ev.reportes}</dd></div></dl>
      <div class="fila-acciones">${ev.reportes ? '<button class="btn primario" data-a="pestana" data-p="reportes">Ver reportes</button>' : ''}${registro() ? `<button class="btn" data-a="editar-evento" data-id="${ev.id}">Editar</button><button class="btn" data-a="cerrar-evento" data-id="${ev.id}">Cerrar evento</button>` : ''}</div></div>`;
    $('#des-detalle').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---------- Marcar o editar un evento: se toca el mapa y se completa el formulario ----------
  function formEvento(ev) {
    let punto = ev ? { lat: ev.latitud, lng: ev.longitud, radio_m: ev.radio_m } : null;
    const porCategoria = catalogo.categorias.map((c) => `<optgroup label="${E(c.nombre)}">${catalogo.tipos.filter((t) => t.categoria === c.id).map((t) => `<option value="${t.id}"${ev && ev.tipo === t.id ? ' selected' : ''}>${t.icono} ${E(t.nombre)}</option>`).join('')}</optgroup>`).join('');
    $('#des-detalle').innerHTML = `<form id="f-evento" class="panel"><h3>${ev ? 'Editar evento' : 'Marcar evento en el mapa'}</h3>
      <div class="cols2">
        <label>Tipo de catástrofe<select name="tipo" required>${porCategoria}</select></label>
        <label>Título (barrio, vereda o sector)<input name="titulo" required maxlength="120" value="${E(ev?.titulo || '')}"></label>
        <label>Radio de la zona afectada (metros)<input name="radio_m" type="number" min="50" max="100000" required value="${ev?.radio_m || 1000}"></label>
      </div>
      <label>Qué ocurrió (lo verá el público al pasar el cursor)<textarea name="descripcion" rows="3" maxlength="500" placeholder="Ej.: Deslizamiento sobre la vía a Zipacón, varias viviendas afectadas">${E(ev?.descripcion || '')}</textarea></label>
      <div><strong>Toca el mapa para marcar el centro de la zona</strong><div id="mapa-evento"></div><small id="coords-evento">${punto ? `Ubicación: ${punto.lat.toFixed(5)}, ${punto.lng.toFixed(5)}` : 'Aún no has marcado el lugar.'}</small></div>
      <div class="fila-acciones"><button class="btn primario" type="submit">${ev ? 'Guardar cambios' : 'Publicar en el mapa'}</button><button class="btn" type="button" data-a="cerrar-detalle">Cancelar</button></div></form>`;
    const sel = $('#f-evento');
    const mini = MapaEventos.crear($('#mapa-evento'), {
      catalogo, centro: mapaCfg,
      onMapa: (p) => { punto = { ...p, radio_m: Number(sel.radio_m.value) || 1000 }; mini.setPunto(punto); $('#coords-evento').textContent = `Ubicación: ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`; },
    });
    mini.setEventos(eventos.filter((x) => !ev || x.id !== ev.id));
    if (punto) mini.setPunto(punto);
    sel.radio_m.addEventListener('input', () => { if (punto) { punto.radio_m = Number(sel.radio_m.value) || 0; mini.setPunto(punto); } });
    $('#des-detalle').scrollIntoView({ behavior: 'smooth', block: 'start' });
    sel.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!punto) { aviso('Toca el mapa para marcar dónde ocurrió el evento.', true); return; }
      const f = Object.fromEntries(new FormData(sel));
      try {
        await CBM.api(ev ? `/busqueda/eventos/${ev.id}` : '/busqueda/eventos', { method: ev ? 'PATCH' : 'POST', body: { ...f, latitud: punto.lat, longitud: punto.lng } });
        aviso(ev ? 'Evento actualizado.' : 'Evento publicado. El público ya puede reportar en esa zona.');
        await armar();
      } catch (err) { falla(err); }
    });
  }

  // =====================================================================
  // Pestaña 2: reportes que envía el público
  // =====================================================================
  async function vistaReportes(filtro = 'abiertos') {
    const lista = await CBM.api(`/busqueda/reportes?estado=${filtro}`);
    $('#des-contenido').innerHTML = `<div class="panel">
      <div class="fila-cab"><h3>Reportes de posibles desaparecidos</h3>
        <select id="f-rep" aria-label="Estado de los reportes"><option value="abiertos"${filtro === 'abiertos' ? ' selected' : ''}>Abiertos</option><option value="nuevo"${filtro === 'nuevo' ? ' selected' : ''}>Solo nuevos</option><option value="resuelto"${filtro === 'resuelto' ? ' selected' : ''}>Resueltos</option></select></div>
      ${lista.length ? lista.map(tarjetaReporte).join('') : '<p class="vacio">No hay reportes con ese filtro.</p>'}</div>`;
  }

  function tarjetaReporte(r) {
    const [txt, color] = ESTADO_REP[r.estado];
    const t = tipoDe(r.evento_tipo);
    return `<article class="reporte ${r.estado}">
      <div class="fila-cab"><strong>${E(r.nombre)}${r.edad !== null ? ` · ${r.edad} años` : ''}${r.sexo !== 'no_se' ? ` · ${E(SEXO[r.sexo])}` : ''}</strong><span class="chip ${color}">${txt}</span></div>
      <small>${r.evento ? `${t.icono} ${E(r.evento)} · ` : ''}Código ${E(r.codigo)} · ${cuando(r.creado_en)}</small>
      ${r.descripcion ? `<span>${E(r.descripcion)}</span>` : ''}
      ${r.ultima_ubicacion ? `<small>Último lugar visto: ${E(r.ultima_ubicacion)}</small>` : ''}
      <small>Contacto: <strong>${E(r.contacto_nombre)}</strong>${r.contacto_telefono ? ` · ☎ ${E(r.contacto_telefono)}` : ''}${r.contacto_correo ? ` · ✉ ${E(r.contacto_correo)}` : ''}</small>
      ${r.notas_bomberos ? `<small>Notas: ${E(r.notas_bomberos)}${r.atendido_por ? ' · ' + E(r.atendido_por) : ''}</small>` : ''}
      ${r.coincidencias ? `<div><span class="chip verde">${r.coincidencias} posible(s) coincidencia(s)</span></div>` : ''}
      <div class="fila-acciones">
        ${r.coincidencias ? `<button class="btn" data-a="coincidencias" data-id="${r.id}">Ver coincidencias</button>` : ''}
        ${registro() ? `<button class="btn" data-a="nota" data-id="${r.id}">Agregar nota</button>
          ${r.estado === 'nuevo' ? `<button class="btn primario" data-a="estado-rep" data-id="${r.id}" data-estado="en_revision">Tomar y revisar</button>` : ''}
          ${r.estado !== 'resuelto' ? `<button class="btn" data-a="estado-rep" data-id="${r.id}" data-estado="resuelto">Marcar resuelto</button>` : `<button class="btn" data-a="estado-rep" data-id="${r.id}" data-estado="en_revision">Reabrir</button>`}` : ''}
      </div></article>`;
  }

  async function verCoincidencias(id) {
    const lista = await CBM.api(`/busqueda/reportes/${id}/coincidencias`);
    $('#des-detalle').innerHTML = `<div class="panel"><div class="fila-cab"><h3>Personas halladas parecidas</h3><button class="btn" data-a="cerrar-detalle">Cerrar</button></div>
      ${lista.map((c) => `<div class="coincidencia ${c.parecido}"><div class="fila-cab"><strong>${E(c.nombre || 'Persona sin identificar')}</strong><span class="chip ${PARECIDO[c.parecido]}">${{ alto: 'Muy parecida', medio: 'Parecida', bajo: 'Podría ser' }[c.parecido]}</span></div>
        <small>${E(TIPO_PERSONA[c.tipo_persona])}${c.edad_aprox !== null ? ' · ~' + c.edad_aprox + ' años' : ''} · ${E(CONDICION[c.condicion])}</small>
        ${c.descripcion ? `<span>${E(c.descripcion)}</span>` : ''}<span>📍 ${E(c.ubicacion_actual)}</span><small>Coincide en: ${E(c.coincide_en.join(', '))}</small></div>`).join('')}</div>`;
    $('#des-detalle').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // =====================================================================
  // Pestaña 3: personas que los bomberos ya ubicaron
  // =====================================================================
  async function vistaHalladas(estado = 'publicada') {
    halladas = await CBM.api(`/busqueda/halladas?estado=${estado}`);
    $('#des-contenido').innerHTML = `<div class="panel">
      <div class="fila-cab"><h3>Personas halladas</h3><div class="fila-acciones">
        <select id="f-hal" aria-label="Estado"><option value="publicada"${estado === 'publicada' ? ' selected' : ''}>Publicadas</option><option value="entregada"${estado === 'entregada' ? ' selected' : ''}>Entregadas a su familia</option></select>
        ${registro() ? '<button class="btn primario" data-a="nueva-hallada">Publicar persona hallada</button>' : ''}</div></div>
      <small>Lo que publiques aquí lo ve el público cuando su reporte se parece (nombre, tipo de persona, descripción y dónde se encuentra). No escribas teléfonos ni documentos.</small>
      ${halladas.length ? `<ul class="lista">${halladas.map((h) => `<li class="emergencia"><div><strong>${E(h.nombre || 'Persona sin identificar')} · ${E(TIPO_PERSONA[h.tipo_persona])}</strong>
        <small>${h.edad_aprox !== null ? '~' + h.edad_aprox + ' años · ' : ''}${E(SEXO[h.sexo])} · ${E(CONDICION[h.condicion])}</small>
        ${h.descripcion ? `<small>${E(h.descripcion)}</small>` : ''}<small>📍 ${E(h.ubicacion_actual)} · publicada ${cuando(h.creado_en)}${h.publicada_por ? ' por ' + E(h.publicada_por) : ''}</small></div>
        ${registro() ? `<div class="fila-acciones">${h.estado === 'publicada' ? `<button class="btn" data-a="mover-hallada" data-id="${h.id}">Cambiar lugar</button><button class="btn primario" data-a="estado-hallada" data-id="${h.id}" data-estado="entregada">Entregada a su familia</button>` : `<button class="btn" data-a="estado-hallada" data-id="${h.id}" data-estado="publicada">Volver a publicar</button>`}</div>` : ''}</li>`).join('')}</ul>` : '<p class="vacio">No hay personas en esta lista.</p>'}</div>`;
  }

  async function formHallada() {
    const activos = await CBM.api('/busqueda/eventos?estado=activo');
    let punto = null;
    $('#des-detalle').innerHTML = `<form id="f-hallada" class="panel"><h3>Publicar persona hallada</h3>
      <div class="cols2">
        <label>Nombre (si lo saben)<input name="nombre" maxlength="100" placeholder="Déjalo vacío si no se ha identificado"></label>
        <label>Tipo de persona<select name="tipo_persona" required>${Object.entries(TIPO_PERSONA).map(([k, v]) => `<option value="${k}"${k === 'adulto' ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
        <label>Edad aproximada<input name="edad_aprox" type="number" min="0" max="120"></label>
        <label>Sexo<select name="sexo">${Object.entries(SEXO).map(([k, v]) => `<option value="${k}"${k === 'no_se' ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
        <label>Condición<select name="condicion">${Object.entries(CONDICION).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
        <label>Evento (opcional)<select name="evento_id"><option value="">Sin evento</option>${activos.map((e) => `<option value="${e.id}">${tipoDe(e.tipo).icono} ${E(e.titulo)}</option>`).join('')}</select></label>
      </div>
      <label>Cómo es (ropa, cabello, señas)<textarea name="descripcion" rows="2" maxlength="500"></textarea></label>
      <label>Dónde se encuentra ahora<input name="ubicacion_actual" required maxlength="160" placeholder="Ej.: Albergue del coliseo, Hospital San Rafael, Estación de bomberos"></label>
      <div><strong>Marca el lugar en el mapa (opcional)</strong><div id="mapa-hallada"></div><small id="coords-hal">Sin marcar.</small></div>
      <div class="fila-acciones"><button class="btn primario" type="submit">Publicar</button><button class="btn" type="button" data-a="cerrar-detalle">Cancelar</button></div></form>`;
    const mini = MapaEventos.crear($('#mapa-hallada'), { catalogo, centro: mapaCfg, onMapa: (p) => { punto = p; mini.setPunto(p); $('#coords-hal').textContent = `Ubicación: ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`; } });
    mini.setEventos(activos);
    $('#des-detalle').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('#f-hallada').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      try {
        await CBM.api('/busqueda/halladas', { method: 'POST', body: { ...f, evento_id: f.evento_id || null, latitud: punto ? punto.lat : null, longitud: punto ? punto.lng : null } });
        aviso('Persona publicada. El público la verá si su reporte coincide.');
        await armar();
      } catch (err) { falla(err); }
    });
  }

  // =====================================================================
  // Acciones
  // =====================================================================
  async function alCambiar(ev) {
    try {
      if (ev.target.id === 'f-rep') await vistaReportes(ev.target.value);
      if (ev.target.id === 'f-hal') await vistaHalladas(ev.target.value);
    } catch (e) { falla(e); }
  }

  async function alClic(ev) {
    const b = ev.target.closest('[data-a]');
    if (!b) return;
    const id = b.dataset.id;
    try {
      switch (b.dataset.a) {
        case 'pestana': pestana = b.dataset.p; await armar(); break;
        case 'nuevo-evento': formEvento(null); break;
        case 'editar-evento': formEvento(eventos.find((x) => String(x.id) === id)); break;
        case 'ver-evento': detalleEvento(eventos.find((x) => String(x.id) === id)); break;
        case 'cerrar-detalle': $('#des-detalle').innerHTML = ''; mapa?.seleccionar(null); break;
        case 'cerrar-evento':
          if (!window.confirm('¿Cerrar este evento? Dejará de aparecer en el mapa público y nadie podrá enviar nuevos reportes en esa zona.')) return;
          await CBM.api(`/busqueda/eventos/${id}/estado`, { method: 'PATCH', body: { estado: 'cerrado' } });
          aviso('Evento cerrado.');
          await armar();
          break;
        case 'estado-rep':
          await CBM.api(`/busqueda/reportes/${id}`, { method: 'PATCH', body: { estado: b.dataset.estado } });
          aviso('Reporte actualizado.');
          await armar();
          break;
        case 'nota': {
          const nota = window.prompt('Nota para este reporte (queda visible solo para los bomberos):');
          if (nota === null) return;
          await CBM.api(`/busqueda/reportes/${id}`, { method: 'PATCH', body: { notas_bomberos: nota } });
          aviso('Nota guardada.');
          await vistaReportes(raiz.querySelector('#f-rep')?.value || 'abiertos');
          break;
        }
        case 'coincidencias': await verCoincidencias(id); break;
        case 'nueva-hallada': await formHallada(); break;
        case 'mover-hallada': {
          const lugar = window.prompt('¿Dónde se encuentra ahora la persona?');
          if (!lugar) return;
          await CBM.api(`/busqueda/halladas/${id}`, { method: 'PATCH', body: { ubicacion_actual: lugar } });
          aviso('Lugar actualizado.');
          await vistaHalladas(raiz.querySelector('#f-hal')?.value || 'publicada');
          break;
        }
        case 'estado-hallada':
          await CBM.api(`/busqueda/halladas/${id}`, { method: 'PATCH', body: { estado: b.dataset.estado } });
          aviso(b.dataset.estado === 'entregada' ? 'Marcada como entregada a su familia.' : 'Publicada de nuevo.');
          await armar();
          break;
        default:
      }
    } catch (e) { falla(e); }
  }
})();
