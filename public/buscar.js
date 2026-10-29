// Portal público: no usa sesión. Solo muestra el mapa de eventos activos, recibe reportes y consulta coincidencias.
(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TIPO_PERSONA = { nino: 'Niño o niña', adolescente: 'Adolescente', adulto: 'Adulto', adulto_mayor: 'Adulto mayor' };
  const CONDICION = { ilesa: 'Sin lesiones visibles', herida: 'Con lesiones', hospitalizada: 'Hospitalizada' };
  const SEXO = { mujer: 'Mujer', hombre: 'Hombre', otro: 'Otro', no_se: 'No se sabe' };
  const PARECIDO = { alto: ['Muy parecida', 'verde'], medio: ['Parecida', 'ambar'], bajo: ['Podría ser', ''] };

  let catalogo = { tipos: [] };
  let eventos = [];
  let mapa = null;
  const dlg = $('#dlg');

  function aviso(texto, mal = false) {
    const el = document.createElement('div');
    el.className = 'toast' + (mal ? ' mal' : '');
    el.setAttribute('role', 'status');
    el.textContent = texto;
    document.body.append(el);
    setTimeout(() => el.remove(), 4000);
  }

  async function api(ruta, { method = 'GET', body } = {}) {
    const res = await fetch('/api/publico' + ruta, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const datos = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(datos.error || 'No se pudo completar la acción. Inténtalo de nuevo.');
    return datos;
  }

  const tipoDe = (id) => catalogo.tipos.find((t) => t.id === id) || { icono: '⚠️', nombre: 'Emergencia', definicion: '' };

  // ---------- Mapa y lista de eventos ----------
  function pintarEventos() {
    const chip = $('#pub-estado');
    chip.textContent = eventos.length ? `${eventos.length} zona${eventos.length === 1 ? '' : 's'} afectada${eventos.length === 1 ? '' : 's'}` : 'Sin eventos activos';
    chip.className = 'chip ' + (eventos.length ? 'rojo' : 'verde');
    $('#pub-lista').innerHTML = eventos.length
      ? eventos.map((e) => { const t = tipoDe(e.tipo); return `<li><button type="button" data-ev="${e.id}"><span class="ico">${t.icono}</span><span><strong>${esc(t.nombre)}</strong><small>${esc(e.titulo)}</small></span></button></li>`; }).join('')
      : '<li class="vacio">Por ahora los bomberos no han marcado ninguna zona afectada. Si necesitas ayuda, llama a la línea 123.</li>';
  }

  async function cargar(primera) {
    const d = await api('/mapa');
    eventos = d.eventos;
    if (primera) {
      mapa = MapaEventos.crear($('#pub-mapa'), {
        catalogo,
        centro: d.centro,
        onEvento: abrirFormulario,
        onVacio: () => aviso('Solo puedes reportar tocando una zona roja marcada por los bomberos.'),
      });
    }
    mapa.setEventos(eventos);
    if (primera) mapa.ajustar();
    pintarEventos();
  }

  $('#pub-lista').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-ev]');
    const ev = b && eventos.find((x) => String(x.id) === b.dataset.ev);
    if (ev) abrirFormulario(ev);
  });

  // ---------- Formulario de reporte ----------
  function cabecera(ev) {
    const t = tipoDe(ev.tipo);
    return `<div class="dlg-cab"><span class="ico">${t.icono}</span><div><h3>${esc(t.nombre)}</h3><small>${esc(ev.titulo)}</small></div>
      <button type="button" class="btn dlg-cerrar" data-cerrar>Cerrar</button></div>`;
  }

  function abrirFormulario(ev) {
    const t = tipoDe(ev.tipo);
    dlg.innerHTML = `<form id="f-rep" class="dlg-cuerpo">
      ${cabecera(ev)}
      <div class="dlg-evento"><strong>Qué ocurrió</strong><span>${esc(ev.descripcion || t.definicion)}</span></div>
      <div class="dlg-bloque"><h4>Datos de la persona que no encuentras</h4>
        <label>Nombre completo<input name="nombre" required maxlength="100" autocomplete="off"></label>
        <div class="cols2">
          <label>Edad (aproximada)<input name="edad" type="number" min="0" max="120" inputmode="numeric"></label>
          <label>Sexo<select name="sexo"><option value="no_se">No lo sé</option><option value="mujer">Mujer</option><option value="hombre">Hombre</option><option value="otro">Otro</option></select></label>
        </div>
        <label>Cómo es (ropa, cabello, señas, condición médica)<textarea name="descripcion" rows="3" maxlength="500" placeholder="Ej.: chaqueta roja, jean azul, cabello negro largo, cicatriz en la mano"></textarea></label>
        <label>Último lugar donde la viste<input name="ultima_ubicacion" maxlength="160" placeholder="Barrio, vereda, dirección o punto de referencia"></label>
      </div>
      <div class="dlg-bloque"><h4>Tus datos, para avisarte</h4>
        <label>Tu nombre<input name="contacto_nombre" required maxlength="100" autocomplete="name"></label>
        <div class="cols2">
          <label>Teléfono o WhatsApp<input name="contacto_telefono" type="tel" maxlength="20" autocomplete="tel"></label>
          <label>Correo (opcional si dejas teléfono)<input name="contacto_correo" type="email" maxlength="120" autocomplete="email"></label>
        </div>
        <small>Escribe al menos un teléfono o un correo.</small>
      </div>
      <div class="campo-trampa" aria-hidden="true"><label>No llenar<input name="sitio_web" tabindex="-1" autocomplete="off"></label></div>
      <label class="check"><input type="checkbox" name="consentimiento" required> Autorizo a los bomberos a usar estos datos para buscar a esta persona y contactarme.</label>
      <p id="rep-error" class="error" role="alert"></p>
      <div class="fila-acciones"><button class="btn primario" type="submit">Enviar reporte</button><button class="btn" type="button" data-cerrar>Cancelar</button></div>
    </form>`;
    dlg.showModal();

    $('#f-rep').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      const boton = e.target.querySelector('button[type=submit]');
      boton.disabled = true;
      $('#rep-error').textContent = '';
      try {
        const r = await api('/reportes', { method: 'POST', body: { ...f, consentimiento: !!f.consentimiento, evento_id: ev.id } });
        vistaResultado(ev, r);
      } catch (err) {
        $('#rep-error').textContent = err.message;
        boton.disabled = false;
      }
    });
  }

  // Lista de personas halladas que se parecen al reporte
  function listaCoincidencias(lista) {
    if (!lista.length) {
      return '<p class="vacio">Por ahora los bomberos no han publicado a nadie parecido. Los bomberos revisarán tu reporte y se comunicarán contigo. También puedes volver a consultar aquí con tu código.</p>';
    }
    return `<div class="pub-coinc">${lista.map((c) => {
      const [txt, color] = PARECIDO[c.parecido] || PARECIDO.bajo;
      return `<article class="${esc(c.parecido)}">
        <div class="fila-cab"><strong>${esc(c.nombre || 'Persona sin identificar')}</strong><span class="chip ${color}">${txt}</span></div>
        <small>${esc(TIPO_PERSONA[c.tipo_persona])}${c.edad_aprox !== null ? ' · ~' + c.edad_aprox + ' años' : ''}${c.sexo !== 'no_se' ? ' · ' + esc(SEXO[c.sexo]) : ''} · ${esc(CONDICION[c.condicion])}</small>
        ${c.descripcion ? `<span>${esc(c.descripcion)}</span>` : ''}
        <span class="donde">📍 Se encuentra en: ${esc(c.ubicacion_actual)}</span>
        ${c.coincide_en.length ? `<small>Coincide en: ${esc(c.coincide_en.join(', '))}</small>` : ''}
      </article>`;
    }).join('')}<small>Si reconoces a la persona, acércate a ese lugar o llama a la línea 123 para confirmar. Lleva tu documento.</small></div>`;
  }

  function vistaResultado(ev, r) {
    dlg.innerHTML = `<div class="dlg-cuerpo">
      ${cabecera(ev)}
      <div><strong>Reporte enviado.</strong> Guarda este código para volver a consultar:</div>
      <div class="codigo-grande">${esc(r.codigo)}</div>
      <div class="dlg-bloque"><h4>${r.coincidencias.length ? `Los bomberos ubicaron ${r.coincidencias.length === 1 ? 'a una persona parecida' : r.coincidencias.length + ' personas parecidas'}` : 'Personas ubicadas por los bomberos'}</h4>${listaCoincidencias(r.coincidencias)}</div>
      <div class="fila-acciones"><button class="btn primario" type="button" data-cerrar>Listo</button></div></div>`;
  }

  dlg.addEventListener('click', (e) => { if (e.target.closest('[data-cerrar]') || e.target === dlg) dlg.close(); });

  // ---------- Consultar con el código ----------
  $('#form-consulta').addEventListener('submit', async (e) => {
    e.preventDefault();
    const cont = $('#pub-consulta-res');
    const codigo = new FormData(e.target).get('codigo').trim().toUpperCase();
    cont.innerHTML = '<p class="vacio">Consultando…</p>';
    try {
      const r = await api(`/reportes/${encodeURIComponent(codigo)}/coincidencias`);
      const estado = { nuevo: 'Recibido, pendiente de revisión', en_revision: 'Los bomberos lo están revisando', resuelto: 'Caso cerrado por los bomberos' }[r.estado];
      cont.innerHTML = `<div class="dlg-bloque"><div><strong>${esc(r.nombre)}</strong> · <span class="chip ${r.estado === 'resuelto' ? 'verde' : 'ambar'}">${esc(estado)}</span></div>${listaCoincidencias(r.coincidencias)}</div>`;
    } catch (err) {
      cont.innerHTML = `<p class="error">${esc(err.message)}</p>`;
    }
  });

  // ---------- Arranque ----------
  (async () => {
    try {
      catalogo = await api('/catalogo');
      await cargar(true);
      setInterval(() => cargar(false).catch(() => {}), 60000); // aparecen eventos nuevos sin recargar
    } catch (err) {
      $('#pub-estado').textContent = 'Sin conexión';
      aviso(err.message, true);
    }
  })();
})();
