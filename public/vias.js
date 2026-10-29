(() => {
  window.CBM = window.CBM || {};
  window.CBM.vistas = window.CBM.vistas || {};

  const TIPO = { obstruccion: ['Obstrucción', 'ambar', '🚧'], accidente: ['Accidente', 'rojo', '🚗'] };
  // El mapa es el mismo de Personas desaparecidas (calles de Facatativá, zoom y arrastre); aquí cada reporte es una zona pequeña.
  const CATALOGO = {
    tipos: [
      { id: 'obstruccion', nombre: 'Obstrucción', icono: '🚧', definicion: 'Paso bloqueado o restringido en la vía.' },
      { id: 'accidente', nombre: 'Accidente', icono: '🚗', definicion: 'Accidente de tránsito en la vía.' },
    ],
  };
  const RADIO_M = { obstruccion: 120, accidente: 150 };

  let raiz = null;
  let vista = 'lista';
  let filtros = { estado: 'activa', tipo: '' };
  let reportes = [];
  let mapa = { lat: 4.8147, lng: -74.3547, radio_km: 12 };

  const E = (v) => CBM.esc(v);
  const $ = (s) => raiz.querySelector(s);
  const aviso = (m, mal) => CBM.aviso(m, mal);
  const falla = (e) => aviso(e.message, true);
  const cuando = (t) => (t ? `${t.slice(8, 10)}/${t.slice(5, 7)} · ${t.slice(11, 16)}` : '');
  const registro = () => CBM.puede('vias', 'registro');
  const conPunto = () => reportes.filter((r) => r.latitud !== null);
  const aEvento = (r) => ({ id: r.id, tipo: r.tipo, titulo: r.ubicacion, descripcion: r.descripcion, latitud: r.latitud, longitud: r.longitud, radio_m: RADIO_M[r.tipo], ocurrido_en: r.ocurrido_en, estado: r.estado, autor: r.autor });

  window.CBM.vistas.vias = async (el) => {
    el.innerHTML = '<div id="via-raiz"></div>';
    raiz = el.querySelector('#via-raiz');
    vista = 'lista';
    filtros = { estado: 'activa', tipo: '' };
    raiz.addEventListener('click', alClic);
    raiz.addEventListener('change', alCambiar);
    mapa = await CBM.api('/vias/mapa');
    await cargar();
  };

  async function cargar() {
    const qs = new URLSearchParams(Object.entries(filtros).filter(([, v]) => v)).toString();
    const [resumen, lista] = await Promise.all([CBM.api('/vias/resumen'), CBM.api('/vias?' + qs)]);
    reportes = lista;
    raiz.innerHTML = `
      <div class="tarjetas">
        <div class="tarjeta"><div class="num">${resumen.activas}</div><span>Reportes activos</span></div>
        <div class="tarjeta"><div class="num">${resumen.obstrucciones}</div><span>Obstrucciones activas</span></div>
        <div class="tarjeta"><div class="num">${resumen.accidentes}</div><span>Accidentes activos</span></div>
      </div>
      <div class="fila-cab">
        <div class="fila-acciones">
          <button class="btn${vista === 'lista' ? ' primario' : ''}" data-a="vista" data-v="lista">Lista</button>
          <button class="btn${vista === 'mapa' ? ' primario' : ''}" data-a="vista" data-v="mapa">Mapa</button>
          <select id="f-estado" aria-label="Estado"><option value="activa"${filtros.estado === 'activa' ? ' selected' : ''}>Activos</option><option value="despejada"${filtros.estado === 'despejada' ? ' selected' : ''}>Despejados</option><option value="todas"${filtros.estado === 'todas' ? ' selected' : ''}>Todos</option></select>
          <select id="f-tipo" aria-label="Tipo"><option value="">Todos los tipos</option><option value="obstruccion"${filtros.tipo === 'obstruccion' ? ' selected' : ''}>Obstrucciones</option><option value="accidente"${filtros.tipo === 'accidente' ? ' selected' : ''}>Accidentes</option></select>
        </div>
        ${registro() ? '<div class="fila-acciones"><button class="btn" data-a="nuevo" data-tipo="obstruccion">Reportar obstrucción</button><button class="btn primario" data-a="nuevo" data-tipo="accidente">Reportar accidente</button></div>' : ''}
      </div>
      <div id="via-contenido"></div><div id="via-detalle"></div>`;
    pintar();
  }

  function tarjeta(r) {
    const [txt, color, icono] = TIPO[r.tipo];
    return `<article class="caso" data-fila="${r.id}"><div class="caso-datos">
        <div class="fila-cab"><strong>${icono} ${E(r.ubicacion)}</strong>
          <span class="chip ${r.estado === 'despejada' ? 'verde' : color}">${r.estado === 'despejada' ? 'Despejada' : txt}</span></div>
        <small>${E(r.descripcion)}</small>
        <small>${txt} · ${cuando(r.ocurrido_en)} · Reportó ${E(r.autor || '—')}${r.emergencia ? ` · Emergencia #${E(r.emergencia)}` : ''}</small>
        ${r.estado === 'despejada' ? `<small>Despejada el ${cuando(r.fecha_despeje)}${r.despejado_por ? ' · ' + E(r.despejado_por) : ''}</small>` : ''}
        ${registro() ? `<div class="fila-acciones"><button class="btn${r.estado === 'activa' ? ' primario' : ''}" data-a="estado" data-id="${r.id}" data-estado="${r.estado === 'activa' ? 'despejada' : 'activa'}">${r.estado === 'activa' ? 'Marcar despejada' : 'Volver a activar'}</button></div>` : ''}
      </div></article>`;
  }

  function pintar() {
    const cont = $('#via-contenido');
    if (!reportes.length) { cont.innerHTML = '<div class="panel"><p class="vacio">No hay reportes con esos filtros.</p></div>'; return; }

    if (vista === 'lista') { cont.innerHTML = `<div class="lista-casos">${reportes.map(tarjeta).join('')}</div>`; return; }

    // HU-9.3: mapa de calles de Facatativá con los reportes
    const sin = reportes.length - conPunto().length;
    cont.innerHTML = `<div class="panel"><h3>Mapa de vías</h3><div id="mapa-vias"></div>
        <div class="leyenda"><span>🚧 Obstrucción</span><span>🚗 Accidente</span><span>🚒 Estación</span><span>Pasa el cursor sobre un reporte para ver qué ocurrió · Arrastra para moverte · + / − para acercar</span></div>
        ${sin ? `<small>${sin} reporte(s) sin coordenadas no aparecen en el mapa; están en la lista.</small>` : ''}</div>
      <div class="lista-casos">${reportes.map(tarjeta).join('')}</div>`;
    const m = MapaEventos.crear($('#mapa-vias'), {
      catalogo: CATALOGO,
      centro: mapa,
      onEvento: (ev) => resaltar(ev.id),
      extraTooltip: (ev) => `<small>${cuando(ev.ocurrido_en)} · Reportó ${E(ev.autor || '—')}${ev.estado === 'despejada' ? ' · Despejada' : ''}</small>`,
    });
    m.setEventos(conPunto().map(aEvento));
    if (conPunto().length) m.ajustar();
  }

  // Al tocar un reporte en el mapa se resalta su tarjeta
  function resaltar(id) {
    raiz.querySelectorAll('[data-fila]').forEach((c) => c.classList.toggle('resaltada', c.dataset.fila === String(id)));
    const fila = raiz.querySelector(`[data-fila="${id}"]`);
    if (fila) fila.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async function alCambiar(ev) {
    if (ev.target.id === 'f-estado') filtros.estado = ev.target.value;
    else if (ev.target.id === 'f-tipo') filtros.tipo = ev.target.value;
    else return;
    await cargar().catch(falla);
  }

  async function alClic(ev) {
    const b = ev.target.closest('[data-a]');
    if (!b) return;
    try {
      if (b.dataset.a === 'vista') { vista = b.dataset.v; await cargar(); }
      else if (b.dataset.a === 'nuevo') await formReporte(b.dataset.tipo);
      else if (b.dataset.a === 'estado') {
        await CBM.api(`/vias/${b.dataset.id}/estado`, { method: 'PATCH', body: { estado: b.dataset.estado } });
        aviso(b.dataset.estado === 'despejada' ? 'Reporte marcado como despejado.' : 'Reporte activado de nuevo.');
        await cargar();
      }
    } catch (e) { falla(e); }
  }

  // ---------- HU-9.1 y 9.2: reportar una obstrucción o un accidente ----------
  async function formReporte(tipo) {
    const accidente = tipo === 'accidente';
    const emergencias = accidente ? (await CBM.api('/vias/opciones')).emergencias : [];
    let punto = null;
    const d = $('#via-detalle');
    d.innerHTML = `<form id="f-via" class="panel"><h3>${accidente ? 'Reportar accidente' : 'Reportar obstrucción en la vía'}</h3>
      <div class="cols2">
        <label>Ubicación<input name="ubicacion" required maxlength="160" placeholder="Vía, barrio, vereda o punto de referencia"></label>
        <label>Fecha y hora (vacío = ahora)<input name="ocurrido_en" type="datetime-local"></label>
      </div>
      <label>Descripción<input name="descripcion" required maxlength="255" placeholder="${accidente ? 'Ej. Choque entre dos vehículos, un carril cerrado' : 'Ej. Árbol caído que bloquea un carril'}"></label>
      ${accidente ? `<label>Emergencia relacionada (opcional)<select name="emergencia_id"><option value="">Ninguna</option>${emergencias.map((e) => `<option value="${e.id}">#${E(e.codigo)} · ${E(e.tipo)} · ${E(e.ubicacion)}</option>`).join('')}</select></label>` : ''}
      <div><strong>Toca el mapa para marcar el punto (opcional)</strong><div id="mini-mapa"></div><small id="coords">Aún no has marcado el punto.</small></div>
      <div class="fila-acciones"><button class="btn primario" type="submit">Enviar reporte</button><button class="btn" type="button" id="cancelar">Cancelar</button></div></form>`;
    d.scrollIntoView({ behavior: 'smooth', block: 'start' });

    const mini = MapaEventos.crear($('#mini-mapa'), {
      catalogo: CATALOGO,
      centro: mapa,
      onMapa: (p) => {
        punto = { ...p, radio_m: RADIO_M[tipo] };
        mini.setPunto(punto);
        $('#coords').textContent = `Punto marcado: ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;
      },
    });
    mini.setEventos(conPunto().map(aEvento));

    $('#cancelar').addEventListener('click', () => { d.innerHTML = ''; });
    $('#f-via').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      if (!f.ocurrido_en) delete f.ocurrido_en;
      try {
        await CBM.api('/vias', { method: 'POST', body: { ...f, tipo, latitud: punto ? punto.lat : null, longitud: punto ? punto.lng : null } });
        aviso(accidente ? 'Accidente reportado.' : 'Obstrucción reportada.');
        filtros.estado = 'activa';
        await cargar();
      } catch (err) { falla(err); }
    });
  }
})();
