(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MODULOS = {
    dashboard: ['Dashboard', 'Estado general de la estación'],
    inventarios: ['Inventarios', 'Trazabilidad por vehículo, estación, lote y responsable'],
    mantenimientos: ['Mantenimientos', 'Alistamiento, historial preventivo y correctivo de la flota'],
    prestamos: ['Préstamos', 'Equipos prestados a personas externas'],
    entregas: ['Entrega de turno', 'Novedades y relevo entre turnos'],
    vias: ['Vías y accidentes', 'Obstrucciones y accidentes en las vías'],
    desaparecidos: ['Personas desaparecidas', 'Zonas afectadas en el mapa, reportes del público y personas halladas'],
    analitica: ['Analítica', 'Indicadores consolidados para decisiones y rendición de cuentas'],
    configuracion: ['Configuración / Usuarios', 'Roles, permisos, turnos y asignación de voluntarios'],
  };
  const SITUACION = { en_turno: ['En turno', 'verde'], fuera_de_turno: ['Fuera de turno', ''], licencia: ['Licencia', 'ambar'] };
  const NIVELES = ['ninguno', 'consulta', 'registro', 'total'];
  const sesion = { token: localStorage.getItem('cbm_token'), usuario: null, permisos: {}, turno: null, dentro: false };
  let moduloActual = null;

  const hora = (t) => (t ? String(t).slice(11, 16) : '—');
  const puede = (modulo, nivel) => NIVELES.indexOf(sesion.permisos[modulo] || 'ninguno') >= NIVELES.indexOf(nivel);

  function aviso(texto, mal = false) {
    const el = document.createElement('div');
    el.className = 'toast' + (mal ? ' mal' : '');
    el.setAttribute('role', 'status');
    el.textContent = texto;
    document.body.append(el);
    setTimeout(() => el.remove(), 3500);
  }

  async function api(ruta, { method = 'GET', body } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (sesion.token) headers.Authorization = 'Bearer ' + sesion.token;
    const res = await fetch('/api' + ruta, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const datos = await res.json().catch(() => ({}));
    if (res.status === 401 && ruta !== '/auth/login') { cerrarSesion(); throw new Error(datos.error || 'Sesión cerrada.'); }
    if (!res.ok) throw new Error(datos.error || 'No se pudo completar la acción.');
    return datos;
  }

  window.CBM = Object.assign(window.CBM || {}, { api, esc, aviso, puede, sesion, hora, abrirModulo });

  // ---------- Sesión (HU-1.1) ----------
  function cerrarSesion() {
    if (sesion.demo) { localStorage.removeItem('cbm_token'); location.reload(); return; } // en modo demo se vuelve a entrar solo
    localStorage.removeItem('cbm_token');
    sesion.token = null;
    $('#app').hidden = true;
    $('#login').hidden = false;
  }

  function pintarTurno() {
    const chip = $('#turno');
    chip.textContent = sesion.turno ? 'Turno activo: ' + sesion.turno.nombre : 'Sin turno activo';
    chip.className = 'chip ' + (sesion.turno ? 'verde' : 'ambar');
  }

  async function pintarAsistencia() {
    const { dentro } = await api('/asistencia/mia');
    sesion.dentro = dentro;
    const b = $('#asistencia');
    b.hidden = false;
    b.textContent = dentro ? 'Registrar salida' : 'Registrar entrada';
    b.className = 'btn ' + (dentro ? '' : 'primario');
  }

  async function entrarApp(datos) {
    sesion.usuario = datos.usuario;
    sesion.permisos = datos.permisos;
    sesion.turno = datos.turnoActivo;
    $('#login').hidden = true;
    $('#app').hidden = false;
    $('#nombre').textContent = datos.usuario.nombre;
    $('#rol').textContent = datos.usuario.rol;
    pintarTurno();

    const menu = $('#menu');
    menu.innerHTML = '';
    Object.keys(MODULOS).filter((m) => puede(m, 'consulta')).forEach((m) => {
      const b = document.createElement('button');
      b.dataset.modulo = m;
      b.textContent = MODULOS[m][0];
      menu.append(b);
    });
    const primero = menu.querySelector('button');
    if (primero) await abrirModulo(primero.dataset.modulo);
    else $('#vista').innerHTML = '<div class="panel"><p class="vacio">Tu rol aún no tiene módulos asignados. Pide ayuda a un administrativo.</p></div>';
    pintarAsistencia().catch(() => {});
  }

  $('#form-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    $('#login-error').textContent = '';
    try {
      const datos = await api('/auth/login', { method: 'POST', body: { usuario: f.get('usuario'), password: f.get('password') } });
      sesion.token = datos.token;
      localStorage.setItem('cbm_token', datos.token);
      e.target.reset();
      await entrarApp(datos);
    } catch (err) {
      $('#login-error').textContent = err.message;
    }
  });
  $('#salir').addEventListener('click', cerrarSesion);

  // ---------- Entrada y salida (HU-1.5) ----------
  $('#asistencia').addEventListener('click', async () => {
    try {
      await api(sesion.dentro ? '/asistencia/salida' : '/asistencia/entrada', { method: 'POST', body: {} });
      aviso(sesion.dentro ? 'Salida registrada.' : 'Entrada registrada.');
      await pintarAsistencia();
      if (moduloActual === 'configuracion') await vistaConfiguracion();
    } catch (err) { aviso(err.message, true); }
  });

  // ---------- Navegación ----------
  $('#menu').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-modulo]');
    if (b) abrirModulo(b.dataset.modulo);
  });

  async function abrirModulo(modulo) {
    moduloActual = modulo;
    document.querySelectorAll('#menu button').forEach((b) => b.classList.toggle('activo', b.dataset.modulo === modulo));
    $('#titulo').textContent = MODULOS[modulo][0];
    $('#subtitulo').textContent = MODULOS[modulo][1];
    if (modulo === 'configuracion') {
      try { await vistaConfiguracion(); } catch (err) { aviso(err.message, true); }
    } else if (window.CBM.vistas && window.CBM.vistas[modulo]) {
      try { await window.CBM.vistas[modulo]($('#vista')); } catch (err) { aviso(err.message, true); }
    } else {
      $('#vista').innerHTML = `<div class="panel"><h3>${esc(MODULOS[modulo][0])}</h3><p class="vacio">Este módulo se construye en los próximos sprints.</p></div>`;
    }
  }

  // ---------- Configuración y usuarios (HU-1.2, 1.3, 1.4, 1.5) ----------
  async function vistaConfiguracion() {
    const total = puede('configuracion', 'total');
    const [resumen, usuarios, turnos, roles, hoy, integ] = await Promise.all([
      api('/usuarios/resumen'), api('/usuarios'), api('/turnos'), api('/roles'), api('/asistencia'), api('/turnos/integrantes'),
    ]);

    const filasUsuarios = usuarios.map((u) => {
      const [txt, color] = SITUACION[u.situacion];
      return `<tr>
        <td><strong>${esc(u.nombre)}</strong></td><td>${esc(u.usuario)}</td><td>${esc(u.rol)}</td><td>${total ? `<select data-cambio-turno="${u.id}" aria-label="Turno de ${esc(u.nombre)}"><option value="">Sin turno</option>${turnos.map((t) => `<option value="${t.id}"${t.id === u.turno_id ? ' selected' : ''}>${esc(t.nombre)}</option>`).join('')}</select>` : esc(u.turno || '—')}</td>
        <td><span class="chip ${u.estado === 'inactivo' ? 'rojo' : color}">${u.estado === 'inactivo' ? 'Inactivo' : txt}</span></td>
        ${total ? `<td><button class="btn" data-accion="estado" data-id="${u.id}" data-estado="${u.estado === 'activo' ? 'inactivo' : 'activo'}">${u.estado === 'activo' ? 'Desactivar' : 'Activar'}</button></td>` : ''}
      </tr>`;
    }).join('');

    const hr = (t) => String(t).slice(0, 5);
    const tarjetasTurnos = integ.turnos.map((t) => `<div class="turno-card${t.activo ? ' activo' : ''}">
      <div class="fila-cab"><strong>Turno ${esc(t.nombre)}</strong>${t.activo ? '<span class="chip verde">Activo</span>' : total ? `<button class="btn chico" data-accion="turno" data-id="${t.id}">Activar</button>` : ''}</div>
      <small>Recibe ${hr(t.hora_inicio)} · entrega ${hr(t.hora_fin)} del día siguiente</small>
      <ul>${t.integrantes.length ? t.integrantes.map((u) => `<li><span>${esc(u.nombre)}<small>${esc(u.rol)}</small></span></li>`).join('') : '<li><small>Sin integrantes asignados</small></li>'}</ul>
      ${t.refuerzos.length ? `<strong>Horas extras (${esc(integ.fecha)})</strong><ul>${t.refuerzos.map((f) => `<li class="refuerzo"><span>${esc(f.nombre)}<small>de ${esc(f.turno_base || 'sin turno')}${f.horas ? ' · ' + f.horas + ' h' : ''}${f.notas ? ' · ' + esc(f.notas) : ''}</small></span>${total ? `<button class="btn chico" data-accion="quitar-refuerzo" data-id="${f.id}">Quitar</button>` : ''}</li>`).join('')}</ul>` : ''}
    </div>`).join('');

    const formRefuerzo = total ? `
      <form id="form-refuerzo" class="form-grid">
        <h3>Agregar horas extras a un turno</h3>
        <small>Suma a alguien de otro turno al ciclo indicado (inicia a las 8:00).</small>
        <div class="cols2">
          <label>Turno que refuerza<select name="turno_id" required>${integ.turnos.map((t) => `<option value="${t.id}">${esc(t.nombre)}</option>`).join('')}</select></label>
          <label>Persona<select name="usuario_id" required>${usuarios.filter((u) => u.estado === 'activo').map((u) => `<option value="${u.id}">${esc(u.nombre)}${u.turno ? ' (' + esc(u.turno) + ')' : ''}</option>`).join('')}</select></label>
          <label>Ciclo que inicia el<input name="fecha" type="date" value="${integ.fecha}" required></label>
          <label>Horas extras (opcional)<input name="horas" type="number" step="0.5" min="0.5" max="24"></label>
          <label>Nota (opcional)<input name="notas" maxlength="160"></label>
        </div>
        <button class="btn primario" type="submit">Agregar al turno</button>
      </form>` : '';

    const filasAsistencia = hoy.map((a) => `<tr><td>${esc(a.nombre)}</td><td>${esc(a.turno || '—')}</td><td>${hora(a.entrada)}</td><td>${hora(a.salida)}</td></tr>`).join('');

    const formulario = total ? `
      <form id="form-usuario" class="panel">
        <h3>Agregar usuario</h3>
        <div class="form-grid">
          <label>Nombre completo<input name="nombre" required></label>
          <label>Usuario<input name="usuario" autocomplete="off" required></label>
          <label>Contraseña (mínimo 8 caracteres)<input name="password" type="password" minlength="8" autocomplete="new-password" required></label>
          <label>Rol<select name="rol_id" required>${roles.roles.map((r) => `<option value="${r.id}">${esc(r.nombre)}</option>`).join('')}</select></label>
          <label>Turno<select name="turno_id"><option value="">Sin turno</option>${turnos.map((t) => `<option value="${t.id}">${esc(t.nombre)}</option>`).join('')}</select></label>
          <button class="btn primario" type="submit">Agregar usuario</button>
        </div>
      </form>` : '';

    $('#vista').innerHTML = `
      <div class="tarjetas">
        <div class="tarjeta"><div class="num">${resumen.activos}</div><span>Usuarios activos</span></div>
        <div class="tarjeta"><div class="num">${resumen.enTurno}</div><span>En turno ahora</span></div>
        <div class="tarjeta"><div class="num">${resumen.roles}</div><span>Roles configurados</span></div>
      </div>
      <div class="panel"><h3>Turnos de 24 horas (relevo a las 8:00 a. m.)</h3>
        <div class="turnos-grid">${tarjetasTurnos}</div>${formRefuerzo}
      </div>
      <div class="cols">
        <div style="display:grid;gap:16px">
          <div class="panel"><h3>Usuarios y permisos</h3>
            <div class="tabla-wrap"><table><thead><tr><th>Nombre</th><th>Usuario</th><th>Rol</th><th>Turno</th><th>Situación</th>${total ? '<th></th>' : ''}</tr></thead><tbody>${filasUsuarios}</tbody></table></div>
          </div>
          <div class="panel"><h3>Control de entrada / salida (hoy)</h3>
            ${hoy.length ? `<div class="tabla-wrap"><table><thead><tr><th>Nombre</th><th>Turno</th><th>Entrada</th><th>Salida</th></tr></thead><tbody>${filasAsistencia}</tbody></table></div>` : '<p class="vacio">Aún no hay entradas registradas hoy.</p>'}
          </div>
        </div>
        <div style="display:grid;gap:16px">
          ${formulario}
        </div>
      </div>`;
  }

  $('#vista').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-accion]');
    if (!b) return;
    try {
      if (b.dataset.accion === 'estado') {
        await api(`/usuarios/${b.dataset.id}/estado`, { method: 'PATCH', body: { estado: b.dataset.estado } });
        aviso(b.dataset.estado === 'activo' ? 'Usuario activado.' : 'Usuario desactivado.');
      }
      if (b.dataset.accion === 'quitar-refuerzo') {
        await api(`/turnos/refuerzos/${b.dataset.id}`, { method: 'DELETE' });
        aviso('Refuerzo quitado.');
      }
      if (b.dataset.accion === 'turno') {
        sesion.turno = await api(`/turnos/${b.dataset.id}/activar`, { method: 'POST' });
        pintarTurno();
        aviso('Turno activado.');
      }
      await vistaConfiguracion();
    } catch (err) { aviso(err.message, true); }
  });

  $('#vista').addEventListener('change', async (e) => {
    const sel = e.target.closest('select[data-cambio-turno]');
    if (!sel) return;
    try {
      await api(`/usuarios/${sel.dataset.cambioTurno}`, { method: 'PUT', body: { turno_id: sel.value || null } });
      aviso('Turno del integrante actualizado.');
      await vistaConfiguracion();
    } catch (err) { aviso(err.message, true); }
  });

  $('#vista').addEventListener('submit', async (e) => {
    if (e.target.id === 'form-refuerzo') {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      try { await api('/turnos/refuerzos', { method: 'POST', body: { ...f, horas: f.horas || null } }); aviso('Persona agregada al turno.'); await vistaConfiguracion(); } catch (err) { aviso(err.message, true); }
      return;
    }
    if (e.target.id !== 'form-usuario') return;
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    try {
      await api('/usuarios', { method: 'POST', body: { ...f, turno_id: f.turno_id || null } });
      aviso('Usuario agregado.');
      await vistaConfiguracion();
    } catch (err) { aviso(err.message, true); }
  });

  // ---------- Estado del servidor local (HU-1.6) ----------
  async function revisarServidor() {
    const punto = $('#punto-servidor');
    try {
      const d = await (await fetch('/api/health')).json();
      const ok = d.baseDatos === 'ok';
      punto.className = 'punto ' + (ok ? 'ok' : 'mal');
      $('#texto-servidor').textContent = ok ? 'Servidor local activo' : 'Base de datos sin conexión';
      $('#copia-servidor').textContent = d.ultimaCopia ? 'Última copia: ' + d.ultimaCopia : 'Sin copia registrada · Sin internet requerido';
    } catch {
      punto.className = 'punto mal';
      $('#texto-servidor').textContent = 'Sin conexión con el servidor';
      $('#copia-servidor').textContent = '';
    }
  }
  revisarServidor();
  setInterval(revisarServidor, 30000);

  // ---------- Arranque ----------
  (async () => {
    if (sesion.token) {
      try { return await entrarApp(await api('/auth/me')); } catch { /* cae al modo demo o al login */ }
    }
    // Modo demo (MODO_DEMO=1 en el servidor): entra sin pedir usuario ni contraseña
    try {
      const r = await fetch('/api/auth/demo');
      if (r.ok) {
        const datos = await r.json();
        sesion.token = datos.token;
        sesion.demo = true;
        localStorage.setItem('cbm_token', datos.token);
        $('#salir').hidden = true;
        return await entrarApp(datos);
      }
    } catch { /* sin servidor: se muestra el login */ }
    $('#login').hidden = false;
  })();
})();
