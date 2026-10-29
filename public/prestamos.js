(() => {
  window.CBM = window.CBM || {};
  window.CBM.vistas = window.CBM.vistas || {};

  const FILTROS = { activo: 'Activos', vencido: 'Vencidos', devuelto: 'Devueltos', todos: 'Todos' };
  let raiz = null;
  let filtros = { estado: 'activo', q: '' };
  let usuarios = [];
  let prestamos = [];

  const E = (v) => CBM.esc(v);
  const $ = (s) => raiz.querySelector(s);
  const aviso = (m, mal) => CBM.aviso(m, mal);
  const falla = (e) => aviso(e.message, true);
  const fecha = (t) => (t ? `${t.slice(8, 10)}/${t.slice(5, 7)} ${t.slice(11, 16)}` : '—');
  const opts = (lista, sel) => lista.map((u) => `<option value="${u.id}"${u.id === sel ? ' selected' : ''}>${E(u.nombre)}</option>`).join('');
  const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
  function tiempo(min) {
    const m = Math.abs(min);
    if (m < 60) return plural(m, 'minuto', 'minutos');
    if (m < 2880) return plural(Math.round(m / 60), 'hora', 'horas');
    return plural(Math.floor(m / 1440), 'día', 'días');
  }

  window.CBM.vistas.prestamos = async (el) => {
    el.innerHTML = '<div id="pre-raiz"></div>';
    raiz = el.querySelector('#pre-raiz');
    filtros = { estado: 'activo', q: '' };
    raiz.addEventListener('click', alClic);
    usuarios = (await CBM.api('/prestamos/opciones')).usuarios;
    await cargar();
  };

  async function cargar() {
    const qs = new URLSearchParams({ estado: filtros.estado, ...(filtros.q ? { q: filtros.q } : {}) }).toString();
    const [resumen, lista] = await Promise.all([CBM.api('/prestamos/resumen'), CBM.api('/prestamos?' + qs)]);
    const registro = CBM.puede('prestamos', 'registro');
    prestamos = lista;

    const filas = lista.map((p) => {
      let chip;
      const esVeh = p.tipo === 'vehiculo';
      const detalleDev = p.condicion_devolucion === 'danado' ? (esVeh ? 'Regresó dañado (vehículo temporalmente inactivo)' : `Con daños o pérdidas: ${p.cant_buena} buenas, ${p.cant_danada} dañadas, ${p.cant_perdida} perdidas`)
        : p.condicion_devolucion === 'revision' ? 'Regresó para revisión (vehículo temporalmente inactivo)' : '';
      if (p.estado === 'devuelto') chip = `<span class="chip verde">Devuelto</span>${detalleDev ? `<small>${E(detalleDev)}</small>` : ''}`;
      else if (p.vencido) chip = `<span class="chip rojo">Vencido hace ${tiempo(p.minutos_restantes)}</span>`;
      else chip = `<span class="chip ${p.minutos_restantes < 1440 ? 'ambar' : 'verde'}">Quedan ${tiempo(p.minutos_restantes)}</span>`;
      return `<tr>
        <td><strong>${E(p.equipo)}</strong><small>${esVeh ? `<span class="chip ambar">Vehículo</span> con todo su equipo${p.incluye_unidades ? ` (${p.incluye_unidades} unidades)` : ''}` : `${p.cantidad} ${p.cantidad === 1 ? 'unidad' : 'unidades'} · ${E(p.codigo)}`}</small></td>
        <td><strong>${E(p.persona_nombre)}</strong><small>${E(p.persona_telefono)} · ${E(p.persona_direccion)}</small></td>
        <td>${E(p.prestado_por || '—')}</td>
        <td>${fecha(p.fecha_prestamo)}<small>${p.estado === 'devuelto' ? 'Devuelto ' + fecha(p.fecha_devolucion) : 'Hasta ' + fecha(p.fecha_limite)}</small></td>
        <td>${chip}</td>
        <td>${registro && p.estado === 'activo' ? `<button class="btn" data-a="devolver" data-id="${p.id}">Registrar devolución</button>` : ''}</td></tr>`;
    }).join('');

    raiz.innerHTML = `
      <div class="tarjetas">
        <div class="tarjeta"><div class="num">${resumen.activos}</div><span>Préstamos activos</span></div>
        <div class="tarjeta"><div class="num">${resumen.vencidos}</div><span>Vencidos</span></div>
        <div class="tarjeta"><div class="num">${resumen.devueltos_mes}</div><span>Devueltos este mes</span></div>
        <div class="tarjeta"><div class="num">${resumen.unidades_prestadas}</div><span>Unidades prestadas ahora</span><small>${resumen.vehiculos_prestados} vehículo(s) prestado(s)</small></div>
      </div>
      <div class="panel">
        <div class="barra">
          <input id="f-q" type="search" placeholder="Buscar por elemento, vehículo, persona o teléfono" aria-label="Buscar" value="${E(filtros.q)}">
          <select id="f-estado" aria-label="Estado del préstamo">${Object.entries(FILTROS).map(([k, v]) => `<option value="${k}"${k === filtros.estado ? ' selected' : ''}>${v}</option>`).join('')}</select>
          ${registro ? '<button class="btn primario" data-a="nuevo">Registrar préstamo</button>' : ''}
        </div>
        ${lista.length ? `<div class="tabla-wrap"><table><thead><tr><th>Elemento o vehículo</th><th>Persona</th><th>Prestó</th><th>Fechas</th><th>Estado</th><th></th></tr></thead><tbody>${filas}</tbody></table></div>`
          : '<p class="vacio">No hay préstamos con esos filtros.</p>'}
      </div>
      <div id="pre-detalle"></div>`;

    const q = $('#f-q');
    const buscar = () => { filtros.q = q.value.trim(); cargar().catch(falla); };
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') buscar(); });
    q.addEventListener('search', buscar);
    $('#f-estado').addEventListener('change', (e) => { filtros.estado = e.target.value; cargar().catch(falla); });
  }

  function alClic(ev) {
    const b = ev.target.closest('[data-a]');
    if (!b) return;
    if (b.dataset.a === 'nuevo') formPrestamo();
    if (b.dataset.a === 'devolver') formDevolver(b.dataset.id);
  }

  function panel(html) { const d = $('#pre-detalle'); d.innerHTML = html; d.scrollIntoView({ behavior: 'smooth', block: 'start' }); }

  // ---------- HU-7.1: registrar préstamo (se elige por nombre, de una lista con búsqueda) ----------
  function formPrestamo() {
    const yo = CBM.sesion.usuario.id;
    let sel = null; // { tipo: 'elemento' | 'vehiculo', ...datos }
    panel(`<form id="f-pre" class="panel"><h3>Registrar préstamo</h3>
      <div class="campo"><span>¿Qué se presta? (busca por nombre)</span>
        <input id="p-buscar" maxlength="120" placeholder="Escribe: motobomba, camilla, Máquina 1, Ambulancia…" aria-label="Buscar elemento o vehículo por nombre"></div>
      <div id="p-info" class="aviso-info" hidden></div>
      <div class="cols2">
        <label id="l-cant" hidden>Cantidad a prestar<input name="cantidad" type="number" min="1" step="1" value="1"></label>
        <label>Prestado por<select name="prestado_por">${opts(usuarios, yo)}</select></label>
        <label>Nombre de quien recibe<input name="persona_nombre" required maxlength="100"></label>
        <label>Teléfono<input name="persona_telefono" type="tel" required maxlength="30"></label>
        <label>Dirección<input name="persona_direccion" required maxlength="160"></label>
        <div class="cols2"><label>Por cuánto tiempo<input name="duracion" type="number" min="1" step="1" value="1" required></label>
        <label>Unidad<select name="unidad"><option value="dias">Días</option><option value="horas">Horas</option></select></label></div>
      </div>
      <label>Notas (opcional)<input name="notas" maxlength="255"></label>
      <small>Solo aparecen elementos con unidades disponibles y vehículos activos. Al prestar un elemento se descuenta del inventario; un vehículo sale prestado con todos los elementos que lleva adentro.</small>
      <div class="fila-acciones"><button class="btn primario" type="submit">Registrar préstamo</button><button class="btn" type="button" id="cancelar">Cancelar</button></div></form>`);

    const f = $('#f-pre');
    const buscar = f.querySelector('#p-buscar');
    const info = f.querySelector('#p-info');
    const lCant = f.querySelector('#l-cant');

    CBM.combo(buscar, {
      buscar: async (t) => {
        const r = await CBM.api('/prestamos/disponibles?q=' + encodeURIComponent(t));
        return [...r.elementos.map((x) => ({ ...x, tipo: 'elemento' })), ...r.vehiculos.map((x) => ({ ...x, tipo: 'vehiculo' }))];
      },
      nombreDe: (o) => o.nombre,
      render: (o) => o.tipo === 'vehiculo'
        ? `<span>${E(o.nombre)}<span class="etiqueta veh">Vehículo</span></span><small>Sale con ${o.unidades} unidades en ${o.elementos} elementos · ${E(o.codigo)}</small>`
        : `<span>${E(o.nombre)}<span class="etiqueta">Elemento</span></span><small>${o.disponible} disponible(s) · ${E(o.ubicacion)}${o.area ? ' · ' + E(o.area) : ''}</small>`,
      alElegir: (o) => {
        sel = o;
        info.hidden = false;
        if (o.tipo === 'vehiculo') {
          lCant.hidden = true;
          f.cantidad.required = false;
          info.innerHTML = `<strong>${E(o.nombre)}</strong>: se presta el vehículo con <strong>todo lo que lleva adentro</strong> (${o.unidades} unidades en ${o.elementos} elementos). Mientras esté prestado aparecerá como Prestado en todo el sistema.`;
        } else {
          lCant.hidden = false;
          f.cantidad.required = true;
          f.cantidad.max = o.disponible;
          f.cantidad.value = 1;
          info.innerHTML = `<strong>${E(o.nombre)}</strong> · ${E(o.ubicacion)}${o.area ? ' (' + E(o.area) + ')' : ''}. Hay <strong>${o.disponible}</strong> disponible(s); lo que se preste se descuenta del inventario.`;
        }
      },
      alEscribir: () => { sel = null; info.hidden = true; lCant.hidden = true; f.cantidad.required = false; },
    });
    buscar.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') ev.preventDefault(); });
    buscar.focus();

    $('#cancelar').addEventListener('click', () => { $('#pre-detalle').innerHTML = ''; });
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!sel) { aviso('Elige en la lista qué se presta.', true); return; }
      const datos = Object.fromEntries(new FormData(f));
      const cuerpo = { ...datos, tipo: sel.tipo, ...(sel.tipo === 'vehiculo' ? { vehiculo_id: sel.id } : { equipo_id: sel.id }) };
      try {
        await CBM.api('/prestamos', { method: 'POST', body: cuerpo });
        aviso('Préstamo registrado.');
        await cargar();
      } catch (err) { falla(err); }
    });
  }

  // ---------- HU-7.2: registrar devolución ----------
  function formDevolver(id) {
    const yo = CBM.sesion.usuario.id;
    const p = prestamos.find((x) => String(x.id) === String(id));
    if (!p) return;
    const esVeh = p.tipo === 'vehiculo';
    const condicion = esVeh
      ? `<label>Estado en que regresa el vehículo<select name="condicion"><option value="bueno">En buen estado (queda Activo)</option><option value="danado">Con daños (queda temporalmente inactivo)</option><option value="revision">Necesita revisión (queda temporalmente inactivo)</option></select></label>`
      : `<label>En buen estado<input name="cant_buena" type="number" min="0" max="${p.cantidad}" step="1" value="${p.cantidad}"></label>
         <label>Dañadas<input name="cant_danada" type="number" min="0" max="${p.cantidad}" step="1" value="0"></label>
         <label>Perdidas (no regresaron)<input name="cant_perdida" type="number" min="0" max="${p.cantidad}" step="1" value="0"></label>`;
    panel(`<form id="f-dev" class="panel"><h3>Registrar devolución · ${E(p.equipo)}${esVeh ? '' : ` (se prestaron ${p.cantidad})`}</h3>
      <div class="cols2">
        ${condicion}
        <label>Recibido por<select name="recibido_por">${opts(usuarios, yo)}</select></label>
      </div>
      <label>Notas (obligatorias si hay daños, pérdidas o revisión)<input name="notas" maxlength="255" placeholder="Describe lo que pasó"></label>
      <small>${esVeh
        ? 'Si el vehículo regresa bien, vuelve a Activo con todos sus elementos. Si regresa dañado o para revisión, queda como Temporalmente inactivo y se crea un daño pendiente con alerta en el dashboard.'
        : 'Las unidades en buen estado vuelven al inventario. Las dañadas y las perdidas no vuelven: quedan como reporte con alerta en el dashboard y en la analítica.'}</small>
      <div class="fila-acciones"><button class="btn primario" type="submit">Registrar devolución</button><button class="btn" type="button" id="cancelar">Cancelar</button></div></form>`);
    $('#cancelar').addEventListener('click', () => { $('#pre-detalle').innerHTML = ''; });
    $('#f-dev').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await CBM.api(`/prestamos/${id}/devolver`, { method: 'PATCH', body: Object.fromEntries(new FormData(e.target)) });
        aviso('Devolución registrada.');
        await cargar();
      } catch (err) { falla(err); }
    });
  }
})();
