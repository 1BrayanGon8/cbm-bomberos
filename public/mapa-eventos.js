// Mapa esquemático de eventos de catástrofe. Funciona sin internet (se dibuja con SVG a partir de las coordenadas).
// Lo usan la página pública (buscar.html) y el módulo "Personas desaparecidas" de los bomberos.
//
//   const mapa = MapaEventos.crear(contenedor, { catalogo, centro: {lat, lng, radio_km}, onEvento, onHallada, onMapa, onVacio, extraTooltip });
//   mapa.setEventos([...]); mapa.setHalladas([...]); mapa.setPunto({lat, lng}); mapa.ajustar();
(() => {
  const W = 800;
  const H = 540;
  const KM_POR_GRADO = 111.32;
  const NICE = [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200];
  const FUENTE_EMOJI = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nice = (km) => NICE.reduce((a, b) => (b <= km ? b : a), NICE[0]);
  const limitar = (n, a, b) => Math.min(Math.max(n, a), b);

  // ---------- Capa de calles (teselas) ----------
  // Se piden al propio servidor (/api/mapa/tiles), que las guarda en disco: lo ya visto se sigue viendo sin internet.
  // Si no hay internet ni tesela guardada, no se dibuja nada y queda la cuadrícula de siempre.
  const NS = 'http://www.w3.org/2000/svg';
  const TILES_URL = '/api/mapa/tiles/{z}/{x}/{y}';
  const MAX_TESELAS = 40;
  const mer = {
    x: (lng, z) => ((lng + 180) / 360) * 2 ** z,
    y: (lat, z) => { const r = (lat * Math.PI) / 180; return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z; },
    lng: (x, z) => (x / 2 ** z) * 360 - 180,
    lat: (y, z) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI,
  };
  // Zoom cuyo tamaño de tesela (256) se acerca más al de la pantalla
  const zoomPara = (metrosPorUnidad, lat) => limitar(Math.round(Math.log2((156543.034 * Math.cos((lat * Math.PI) / 180)) / metrosPorUnidad)), 8, 18);

  function crear(cont, opts = {}) {
    const tipos = new Map(((opts.catalogo && opts.catalogo.tipos) || []).map((t) => [t.id, t]));
    const centro = { lat: 4.8147, lng: -74.3547, radio_km: 12, ...(opts.centro || {}) };
    const v = { lat: centro.lat, lng: centro.lng, radio_km: centro.radio_km };
    let eventos = [];
    let halladas = [];
    let punto = null;
    let seleccionado = null;
    let abajo = null;
    let pendiente = 0;
    let inicial = { ...v }; // a donde vuelve el botón ⌖

    cont.innerHTML = `<div class="mapa-ev${opts.onMapa ? ' eligiendo' : ''}">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Mapa de eventos de catástrofe"><g class="base"></g><g class="capa"></g><text class="atrib" x="${W - 8}" y="${H - 8}" text-anchor="end" style="display:none">© OpenStreetMap contributors</text></svg>
      <div class="mapa-tip" hidden></div>
      <div class="mapa-ctrl"><button type="button" data-z="in" aria-label="Acercar">+</button><button type="button" data-z="out" aria-label="Alejar">−</button><button type="button" data-z="centro" aria-label="Volver al centro" title="Volver al centro">⌖</button></div>
    </div>`;
    const caja = cont.querySelector('.mapa-ev');
    const svg = caja.querySelector('svg');
    const capa = caja.querySelector('.capa');
    const base = caja.querySelector('.base');
    const atrib = caja.querySelector('.atrib');
    const tip = caja.querySelector('.mapa-tip');

    const kmPx = () => (2 * v.radio_km) / H;
    const cosLat = () => Math.cos((v.lat * Math.PI) / 180);
    const proy = (lat, lng) => ({
      x: W / 2 + ((lng - v.lng) * KM_POR_GRADO * cosLat()) / kmPx(),
      y: H / 2 - ((lat - v.lat) * KM_POR_GRADO) / kmPx(),
    });
    const inv = (x, y) => ({
      lat: v.lat - ((y - H / 2) * kmPx()) / KM_POR_GRADO,
      lng: v.lng + ((x - W / 2) * kmPx()) / (KM_POR_GRADO * cosLat()),
    });
    const aSvg = (e) => {
      const r = svg.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
    };

    function rejilla() {
      const paso = nice(Math.max(v.radio_km / 3, 0.05));
      const dLat = paso / KM_POR_GRADO;
      const dLng = paso / (KM_POR_GRADO * cosLat());
      const a = inv(0, H);
      const b = inv(W, 0);
      let html = '';
      for (let k = Math.ceil(a.lat / dLat); k * dLat <= b.lat; k += 1) {
        const y = proy(k * dLat, v.lng).y;
        html += `<line x1="0" y1="${y.toFixed(1)}" x2="${W}" y2="${y.toFixed(1)}"${k % 5 === 0 ? ' class="mayor"' : ''}/>`;
      }
      for (let k = Math.ceil(a.lng / dLng); k * dLng <= b.lng; k += 1) {
        const x = proy(v.lat, k * dLng).x;
        html += `<line x1="${x.toFixed(1)}" y1="0" x2="${x.toFixed(1)}" y2="${H}"${k % 5 === 0 ? ' class="mayor"' : ''}/>`;
      }
      return `<g class="rejilla">${html}</g>`;
    }

    function escala() {
      const km = nice((150 * kmPx()));
      const px = km / kmPx();
      const txt = km < 1 ? `${Math.round(km * 1000)} m` : `${km} km`;
      return `<g class="escala"><line x1="24" y1="${H - 26}" x2="${24 + px}" y2="${H - 26}"/><line x1="24" y1="${H - 32}" x2="24" y2="${H - 20}"/><line x1="${24 + px}" y1="${H - 32}" x2="${24 + px}" y2="${H - 20}"/><text x="24" y="${H - 38}">${txt}</text></g>`;
    }

    // Teselas ya puestas en el mapa: clave "z/x/y" -> imagen. Las de otro zoom se quitan cuando llegan las nuevas.
    const teselas = new Map();
    const fallidas = new Map();
    let deseadas = new Set();
    let zoomActual = null;

    function limpiarViejas() {
      for (const [clave, img] of teselas) if (!deseadas.has(clave)) { img.remove(); teselas.delete(clave); }
    }
    function alTerminarCarga() {
      const pendientes = [...deseadas].some((k) => teselas.get(k) && teselas.get(k).dataset.estado === 'cargando');
      if (!pendientes) limpiarViejas();
      const alguna = [...teselas.values()].some((i) => i.dataset.estado === 'lista');
      caja.classList.toggle('con-base', alguna);
      atrib.style.display = alguna ? '' : 'none';
    }

    function pintarBase() {
      if (opts.base === false) return;
      const a = inv(0, H);
      const b = inv(W, 0);
      let z = zoomPara(kmPx() * 1000, v.lat);
      let x0; let x1; let y0; let y1;
      for (;;) {
        x0 = Math.floor(mer.x(a.lng, z)); x1 = Math.floor(mer.x(b.lng, z));
        y0 = Math.floor(mer.y(b.lat, z)); y1 = Math.floor(mer.y(a.lat, z));
        if ((x1 - x0 + 1) * (y1 - y0 + 1) <= MAX_TESELAS || z <= 8) break;
        z -= 1;
      }
      deseadas = new Set();
      for (let y = y0; y <= y1; y += 1) {
        for (let x = x0; x <= x1; x += 1) {
          const clave = `${z}/${x}/${y}`;
          if (fallidas.has(clave) && Date.now() - fallidas.get(clave) < 30000) continue;
          deseadas.add(clave);
          const p1 = proy(mer.lat(y, z), mer.lng(x, z));
          const p2 = proy(mer.lat(y + 1, z), mer.lng(x + 1, z));
          let img = teselas.get(clave);
          if (!img) {
            img = document.createElementNS(NS, 'image');
            img.dataset.estado = 'cargando';
            img.setAttribute('preserveAspectRatio', 'none');
            img.addEventListener('load', () => { img.dataset.estado = 'lista'; alTerminarCarga(); });
            img.addEventListener('error', () => { fallidas.set(clave, Date.now()); img.remove(); teselas.delete(clave); alTerminarCarga(); });
            img.setAttribute('href', TILES_URL.replace('{z}', z).replace('{x}', x).replace('{y}', y));
            base.append(img);
            teselas.set(clave, img);
          }
          img.setAttribute('x', p1.x.toFixed(1));
          img.setAttribute('y', p1.y.toFixed(1));
          img.setAttribute('width', (p2.x - p1.x + 0.6).toFixed(1));
          img.setAttribute('height', (p2.y - p1.y + 0.6).toFixed(1));
        }
      }
      if (z === zoomActual) limpiarViejas(); // al desplazarse, las que quedaron fuera de la vista se quitan ya
      zoomActual = z;
    }

    function dibujar() {
      pendiente = 0;
      pintarBase();
      const est = proy(centro.lat, centro.lng);
      const zonas = [...eventos].sort((x, y) => y.radio_m - x.radio_m).map((e) => {
        const t = tipos.get(e.tipo) || { icono: '⚠️', nombre: 'Emergencia' };
        const p = proy(e.latitud, e.longitud);
        const r = Math.max(e.radio_m / 1000 / kmPx(), 24);
        const sel = seleccionado === e.id ? ' sel' : '';
        return `<g class="zona t-${esc(e.tipo)}${sel}" data-ev="${e.id}" tabindex="0" role="button" aria-label="${esc(t.nombre)}: ${esc(e.titulo)}">
          <circle class="onda" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r.toFixed(1)}"/>
          <circle class="area" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r.toFixed(1)}"/>
          <circle class="sello" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="22"/>
          <text x="${p.x.toFixed(1)}" y="${(p.y + 9).toFixed(1)}" text-anchor="middle" font-size="26" font-family='${FUENTE_EMOJI}'>${t.icono}</text></g>`;
      }).join('');
      const pers = halladas.filter((h) => h.latitud !== null && h.latitud !== undefined).map((h) => {
        const p = proy(h.latitud, h.longitud);
        return `<g class="hallada" data-hallada="${h.id}" tabindex="0" role="button" aria-label="Persona hallada: ${esc(h.nombre || 'sin nombre')}">
          <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="14"/><text x="${p.x.toFixed(1)}" y="${(p.y + 6).toFixed(1)}" text-anchor="middle" font-size="16" font-family='${FUENTE_EMOJI}'>🧍</text></g>`;
      }).join('');
      const pin = punto ? (() => {
        const p = proy(punto.lat, punto.lng);
        return `<g class="punto"><circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${Math.max((punto.radio_m || 0) / 1000 / kmPx(), 10).toFixed(1)}" class="previa"/><text x="${p.x.toFixed(1)}" y="${(p.y + 8).toFixed(1)}" text-anchor="middle" font-size="26" font-family='${FUENTE_EMOJI}'>📍</text></g>`;
      })() : '';
      capa.innerHTML = `${rejilla()}
        <g class="estacion"><rect x="${(est.x - 11).toFixed(1)}" y="${(est.y - 11).toFixed(1)}" width="22" height="22" rx="5"/><text x="${est.x.toFixed(1)}" y="${(est.y + 5).toFixed(1)}" text-anchor="middle" font-size="14" font-family='${FUENTE_EMOJI}'>🚒</text><text class="rot" x="${(est.x + 16).toFixed(1)}" y="${(est.y + 4).toFixed(1)}">Estación</text></g>
        ${zonas}${pers}${pin}${escala()}
        <g class="norte" transform="translate(${W - 34} 40)"><circle r="18"/><path d="M0 -12 L6 6 L0 2 L-6 6 Z"/><text y="-22" text-anchor="middle">N</text></g>`;
    }
    const pedir = () => { if (!pendiente) pendiente = requestAnimationFrame(dibujar); };

    // ---------- Tooltip: qué sucedió ----------
    function mostrarTip(e, g) {
      const ev = eventos.find((x) => String(x.id) === g.dataset.ev);
      if (!ev) return;
      const t = tipos.get(ev.tipo) || { icono: '⚠️', nombre: 'Emergencia', definicion: '' };
      tip.innerHTML = `<strong>${t.icono} ${esc(t.nombre)}</strong><span>${esc(ev.titulo)}</span>${ev.descripcion ? `<p>${esc(ev.descripcion)}</p>` : ''}<small>${esc(t.definicion)}</small>${opts.extraTooltip ? opts.extraTooltip(ev) : ''}`;
      tip.hidden = false;
      const r = caja.getBoundingClientRect();
      let x = e.clientX - r.left + 16;
      let y = e.clientY - r.top + 16;
      x = Math.min(x, r.width - tip.offsetWidth - 8);
      y = Math.min(y, r.height - tip.offsetHeight - 8);
      tip.style.left = `${Math.max(x, 8)}px`;
      tip.style.top = `${Math.max(y, 8)}px`;
    }
    svg.addEventListener('pointermove', (e) => {
      if (abajo) {
        const dx = e.clientX - abajo.cx;
        const dy = e.clientY - abajo.cy;
        if (!abajo.mov && Math.hypot(dx, dy) > 5) { abajo.mov = true; tip.hidden = true; caja.classList.add('arrastrando'); }
        if (abajo.mov) {
          const k = W / svg.getBoundingClientRect().width;
          v.lng = abajo.lng - (dx * k * kmPx()) / (KM_POR_GRADO * Math.cos((abajo.lat * Math.PI) / 180));
          v.lat = abajo.lat + (dy * k * kmPx()) / KM_POR_GRADO;
          pedir();
          return;
        }
      }
      const g = e.target.closest('[data-ev]');
      if (g) mostrarTip(e, g); else tip.hidden = true;
    });
    svg.addEventListener('pointerleave', () => { tip.hidden = true; abajo = null; caja.classList.remove('arrastrando'); });
    svg.addEventListener('pointerdown', (e) => { if (e.button === 0) abajo = { cx: e.clientX, cy: e.clientY, lat: v.lat, lng: v.lng, mov: false }; });
    svg.addEventListener('pointerup', (e) => {
      const fue = abajo;
      abajo = null;
      caja.classList.remove('arrastrando');
      if (!fue || fue.mov) return;
      const g = e.target.closest('[data-ev]');
      const h = e.target.closest('[data-hallada]');
      if (g) { const ev = eventos.find((x) => String(x.id) === g.dataset.ev); if (ev && opts.onEvento) opts.onEvento(ev); return; }
      if (h) { const p = halladas.find((x) => String(x.id) === h.dataset.hallada); if (p && opts.onHallada) opts.onHallada(p); return; }
      if (opts.onMapa) { const q = aSvg(e); opts.onMapa(inv(q.x, q.y)); } else if (opts.onVacio) opts.onVacio();
    });
    svg.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const g = e.target.closest('[data-ev]');
      const ev = g && eventos.find((x) => String(x.id) === g.dataset.ev);
      if (ev && opts.onEvento) { e.preventDefault(); opts.onEvento(ev); }
    });
    svg.addEventListener('wheel', (e) => { e.preventDefault(); zoom(e.deltaY < 0 ? 1 / 1.25 : 1.25); }, { passive: false });

    function zoom(f) { v.radio_km = limitar(v.radio_km * f, 0.2, 500); pedir(); }
    caja.querySelector('.mapa-ctrl').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-z]');
      if (!b) return;
      if (b.dataset.z === 'in') zoom(1 / 1.5);
      else if (b.dataset.z === 'out') zoom(1.5);
      else { Object.assign(v, inicial); pedir(); }
    });

    // Encuadra todos los eventos activos dentro de la vista.
    function ajustar() {
      if (!eventos.length) return;
      const lat0 = eventos.reduce((s, e) => s + e.latitud, 0) / eventos.length;
      const lng0 = eventos.reduce((s, e) => s + e.longitud, 0) / eventos.length;
      const c = Math.cos((lat0 * Math.PI) / 180);
      let needY = 0;
      let needX = 0;
      let rMax = 0;
      eventos.forEach((e) => {
        const rk = e.radio_m / 1000;
        rMax = Math.max(rMax, rk);
        needY = Math.max(needY, Math.abs(e.latitud - lat0) * KM_POR_GRADO + rk);
        needX = Math.max(needX, Math.abs(e.longitud - lng0) * KM_POR_GRADO * c + rk);
      });
      v.lat = lat0; v.lng = lng0;
      v.radio_km = limitar(Math.max(needY, (needX * H) / W, rMax * 2.5, 0.6) * 1.35, 0.3, 500);
      inicial = { ...v };
      pedir();
    }

    dibujar();
    return {
      setEventos(lista) { eventos = lista || []; pedir(); },
      setHalladas(lista) { halladas = lista || []; pedir(); },
      setPunto(p) { punto = p; pedir(); },
      seleccionar(id) { seleccionado = id; pedir(); },
      setCentro(c) { Object.assign(centro, c); v.lat = centro.lat; v.lng = centro.lng; v.radio_km = centro.radio_km; inicial = { ...v }; pedir(); },
      ajustar,
      vista: () => ({ ...v }),
      destruir() { cont.innerHTML = ''; },
    };
  }

  window.MapaEventos = { crear, util: { mer, zoomPara } };
})();
