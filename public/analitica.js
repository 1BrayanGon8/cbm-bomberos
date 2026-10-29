(() => {
  window.CBM = window.CBM || {};
  window.CBM.vistas = window.CBM.vistas || {};

  let raiz = null;
  let periodo = { desde: '', hasta: '' };

  const E = (v) => CBM.esc(v);
  const $ = (s) => raiz.querySelector(s);
  const aviso = (m, mal) => CBM.aviso(m, mal);
  const falla = (e) => aviso(e.message, true);
  const dmy = (iso) => iso.split('-').reverse().join('/');
  const mmss = (s) => (s === null || s === undefined ? '—' : `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`);
  const fmtFecha = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const hace = (n) => { const d = new Date(); d.setDate(d.getDate() - (n - 1)); return fmtFecha(d); };

  window.CBM.vistas.analitica = async (el) => {
    el.innerHTML = '<div id="ana-raiz"></div>';
    raiz = el.querySelector('#ana-raiz');
    periodo = { desde: hace(30), hasta: fmtFecha(new Date()) };
    await cargar();
  };

  // Gráfica de barras sencilla en SVG (sin librerías: funciona sin internet)
  function barras(datos, { color = '#c62828', formato = (v) => v, descripcion = '' } = {}) {
    const ancho = 360;
    const alto = 160;
    const max = Math.max(...datos.map((d) => d.valor || 0), 1);
    const paso = ancho / datos.length;
    const bw = Math.min(46, paso * 0.6);
    const cols = datos.map((d, i) => {
      const h = Math.round(((d.valor || 0) / max) * (alto - 40));
      const x = i * paso + (paso - bw) / 2;
      const y = alto - 22 - h;
      return `<g><title>${E(d.etiqueta)}: ${E(d.valor === null ? 'sin datos' : formato(d.valor))}</title>
        <rect x="${x}" y="${y}" width="${bw}" height="${h}" rx="3" fill="${d.color || color}"/>
        <text x="${x + bw / 2}" y="${y - 4}" text-anchor="middle" font-size="11" fill="#1f2328">${E(d.valor === null ? '—' : formato(d.valor))}</text>
        <text x="${x + bw / 2}" y="${alto - 6}" text-anchor="middle" font-size="11" fill="#6a737d">${E(d.etiqueta)}</text></g>`;
    }).join('');
    return `<svg viewBox="0 0 ${ancho} ${alto}" class="grafica" role="img" aria-label="${E(descripcion)}">${cols}</svg>`;
  }

  function anillo(pct, color) {
    const c = 2 * Math.PI * 40;
    const lleno = ((pct || 0) / 100) * c;
    return `<svg viewBox="0 0 100 100" class="anillo" role="img" aria-label="${pct === null ? 'Sin datos' : pct + '% de resolución'}">
      <circle cx="50" cy="50" r="40" fill="none" stroke="#e3e6ea" stroke-width="14"/>
      <circle cx="50" cy="50" r="40" fill="none" stroke="${color}" stroke-width="14" stroke-dasharray="${lleno} ${c}" transform="rotate(-90 50 50)"/>
      <text x="50" y="55" text-anchor="middle" font-size="16" font-weight="700" fill="#1f2328">${pct === null ? '—' : pct + '%'}</text></svg>`;
  }

  async function cargar() {
    const qs = new URLSearchParams(periodo).toString();
    const d = await CBM.api('/analitica?' + qs);
    const total = CBM.puede('analitica', 'total');
    const r = d.respuesta;
    const cumple = r.promedio_seg !== null && r.promedio_seg <= r.meta_seg;
    const t = d.mantenimiento.por_tipo;
    const m = d.inventario.movimientos;

    raiz.innerHTML = `
      <div class="panel">
        <div class="barra">
          <label>Desde<input id="f-desde" type="date" value="${periodo.desde}"></label>
          <label>Hasta<input id="f-hasta" type="date" value="${periodo.hasta}"></label>
          <button class="btn" data-r="7">Últimos 7 días</button><button class="btn" data-r="30">Últimos 30 días</button><button class="btn" data-r="90">Últimos 90 días</button>
          <button class="btn" data-x="excel">Exportar Excel</button><button class="btn primario" data-x="pdf">Exportar PDF</button>
        </div>
        <small>Periodo: ${dmy(d.periodo.desde)} al ${dmy(d.periodo.hasta)} (${d.periodo.dias} días). Se compara con los ${d.periodo.dias} días anteriores (${dmy(d.anterior.desde)} al ${dmy(d.anterior.hasta)}).</small>
      </div>

      <div class="tarjetas">
        <div class="tarjeta"><div class="num">${d.emergencias.total}</div><span>Emergencias</span>
          <small>${d.emergencias.variacion_pct === null ? 'Sin datos del periodo anterior' : `${d.emergencias.variacion_pct > 0 ? '↑' : d.emergencias.variacion_pct < 0 ? '↓' : '='} ${Math.abs(d.emergencias.variacion_pct)}% vs. periodo anterior (${d.emergencias.anterior})`}</small></div>
        <div class="tarjeta"><div class="num">${mmss(r.promedio_seg)}</div><span>Respuesta promedio</span>
          <small><span class="chip ${r.promedio_seg === null ? '' : cumple ? 'verde' : 'rojo'}">${r.promedio_seg === null ? 'Sin datos' : cumple ? 'Dentro de la meta' : 'Sobre la meta'}</span> Meta ≤ ${mmss(r.meta_seg)}</small>
          ${r.diferencia_seg === null ? '' : `<small>${r.diferencia_seg <= 0 ? '↓' : '↑'} ${mmss(Math.abs(r.diferencia_seg))} vs. periodo anterior</small>`}</div>
        <div class="tarjeta"><div class="num">${d.inventario.pct_vigente === null ? '—' : d.inventario.pct_vigente + '%'}</div><span>Inventario vigente (hoy)</span><small>${d.inventario.vigentes} de ${d.inventario.total} unidades · ${d.inventario.con_fecha} con fecha de vencimiento o recarga</small></div>
        <div class="tarjeta"><div class="num">${d.inventario.prestadas}</div><span>Unidades prestadas (hoy)</span><small>${d.inventario.vehiculos_prestados} vehículo(s) prestado(s) con su equipo</small></div>
        <div class="tarjeta"><div class="num">${d.desaparecidos.resueltos}</div><span>Casos resueltos</span>
          <small>${d.desaparecidos.resueltos >= d.desaparecidos.resueltos_anterior ? '↑' : '↓'} ${Math.abs(d.desaparecidos.resueltos - d.desaparecidos.resueltos_anterior)} vs. periodo anterior</small></div>
      </div>

      <div class="cols2">
        <div class="panel"><h3>Emergencias por semana</h3>
          ${barras(d.emergencias.por_semana.map((s) => ({ etiqueta: s.etiqueta, valor: s.total })), { descripcion: 'Emergencias por semana' })}
          <small>${d.emergencias.total} en total</small></div>
        <div class="panel"><h3>Tiempos de respuesta por semana</h3>
          ${barras(r.por_semana.map((s) => ({ etiqueta: s.etiqueta, valor: s.promedio_seg, color: s.promedio_seg !== null && s.promedio_seg > r.meta_seg ? '#c62828' : '#2f6fd1' })), { formato: mmss, descripcion: 'Tiempo de respuesta promedio por semana' })}
          <small>Promedio ${mmss(r.promedio_seg)} · Máximo ${mmss(r.maximo_seg)}. En rojo, las semanas sobre la meta.</small></div>
        <div class="panel"><h3>Estado del inventario (hoy)</h3>
          ${barras([{ etiqueta: 'Vigentes', valor: d.inventario.vigentes, color: '#2e7d4f' }, { etiqueta: 'Por vencer', valor: d.inventario.por_vencer, color: '#e3a008' }, { etiqueta: 'Críticos', valor: d.inventario.criticos, color: '#c62828' }], { descripcion: 'Estado del inventario' })}
          <small>${d.inventario.vigentes} vigentes · ${d.inventario.por_vencer} por vencer · ${d.inventario.criticos} críticos (en unidades)</small></div>
        <div class="panel"><h3>Movimientos de inventario</h3>
          ${barras([{ etiqueta: 'Prestadas', valor: m.prestamo, color: '#2f6fd1' }, { etiqueta: 'Devueltas', valor: m.devolucion, color: '#2e7d4f' }, { etiqueta: 'Dañadas', valor: m.danado, color: '#d99a1d' }, { etiqueta: 'Perdidas', valor: m.perdido, color: '#c62828' }, { etiqueta: 'Vencidas', valor: m.vencido, color: '#8a5a44' }], { descripcion: 'Movimientos de inventario del periodo' })}
          <small>Unidades en el periodo: ${m.prestamo} prestadas · ${m.devolucion} devueltas · ${m.danado} dañadas · ${m.perdido} perdidas · ${m.vencido} vencidas</small></div>
        <div class="panel"><h3>Mantenimiento por tipo</h3>
          ${barras([{ etiqueta: 'Preventivo', valor: t.preventivo }, { etiqueta: 'Correctivo', valor: t.correctivo }, { etiqueta: 'Inspección', valor: t.inspeccion }, { etiqueta: 'Daños', valor: t.danos }], { color: '#d99a1d', descripcion: 'Mantenimientos por tipo' })}
          <small>Preventivo ${t.preventivo} · Correctivo ${t.correctivo} · Inspección ${t.inspeccion} · Daños ${t.danos}</small></div>
        <div class="panel"><h3>Casos de desaparecidos</h3>
          <div class="fila-acciones">${anillo(d.desaparecidos.pct_resolucion, '#2e7d4f')}
            <div><p><span class="chip verde">${d.desaparecidos.resueltos} resueltos</span></p><p><span class="chip ambar">${d.desaparecidos.activos} activos</span></p>
            <small>${d.desaparecidos.pct_resolucion === null ? 'Sin casos' : d.desaparecidos.pct_resolucion + '% de resolución'}</small></div></div></div>
        <div class="panel"><h3>Disponibilidad de la flota (hoy)</h3>
          <div class="num-grande">${d.flota.pct === null ? '—' : String(d.flota.pct).replace('.', ',') + '%'}</div>
          <small>${d.flota.operativas} operativas de ${d.flota.total} unidades · ${d.flota.en_mantenimiento} en mantenimiento · ${d.flota.prestados} prestadas · ${d.flota.inactivos_temporales} temporalmente inactivas</small></div>
      </div>
      ${total ? `<form id="f-meta" class="panel fila-acciones"><span>Meta de tiempo de respuesta:</span>
        <input name="minutos" type="number" min="1" max="120" value="${Math.round(r.meta_seg / 60)}" style="width:80px" aria-label="Meta en minutos"><span>minutos</span>
        <button class="btn" type="submit">Guardar meta</button></form>` : ''}
      <small>El tiempo de respuesta se mide desde que se registra la emergencia hasta la hora de salida de la unidad; se ignoran los registros con más de 6 horas de diferencia. Inventario y flota muestran el estado de hoy, no del periodo.</small>`;

    $('#f-desde').addEventListener('change', (e) => { periodo.desde = e.target.value; recargar(); });
    $('#f-hasta').addEventListener('change', (e) => { periodo.hasta = e.target.value; recargar(); });
    raiz.querySelectorAll('[data-r]').forEach((b) => b.addEventListener('click', () => {
      periodo = { desde: hace(Number(b.dataset.r)), hasta: fmtFecha(new Date()) };
      recargar();
    }));
    raiz.querySelectorAll('[data-x]').forEach((b) => b.addEventListener('click', () => descargar(b.dataset.x).catch(falla)));
    $('#f-meta')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await CBM.api('/analitica/meta', { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) }); aviso('Meta actualizada.'); await cargar(); } catch (err) { falla(err); }
    });
  }

  const recargar = () => cargar().catch(falla);

  // HU-6.3: la descarga lleva el token de la sesión, por eso se pide con fetch y se guarda como archivo
  async function descargar(tipo) {
    const qs = new URLSearchParams(periodo).toString();
    const r = await fetch(`/api/analitica/${tipo}?${qs}`, { headers: { Authorization: 'Bearer ' + CBM.sesion.token } });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'No se pudo generar el archivo.');
    const url = URL.createObjectURL(await r.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = `analitica-${periodo.desde}_a_${periodo.hasta}.${tipo === 'excel' ? 'xlsx' : 'pdf'}`;
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    aviso('Archivo descargado.');
  }
})();
