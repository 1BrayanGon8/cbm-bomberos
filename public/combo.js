(() => {
  window.CBM = window.CBM || {};

  // Lista desplegable con búsqueda por nombre. Funciona sin internet.
  //   buscar(texto)  → promesa con la lista de opciones
  //   nombreDe(op)   → texto que queda escrito al elegir
  //   render(op)     → HTML de cada opción
  //   alElegir(op)   → se llama al elegir una opción
  //   alEscribir()   → se llama cuando la persona cambia el texto (para olvidar la opción elegida)
  //   crear          → { etiqueta(texto), alCrear(texto) }: agrega al final la opción "crear"
  window.CBM.combo = (input, { buscar, nombreDe, render, alElegir, alEscribir, crear }) => {
    const cont = document.createElement('div');
    cont.className = 'combo';
    input.parentNode.insertBefore(cont, input);
    cont.append(input);
    const lista = document.createElement('ul');
    lista.className = 'combo-lista';
    lista.setAttribute('role', 'listbox');
    lista.hidden = true;
    cont.append(lista);
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-expanded', 'false');

    let entradas = [];
    let activo = -1;
    let espera = null;
    let pedido = 0;

    const cerrar = () => { lista.hidden = true; activo = -1; input.setAttribute('aria-expanded', 'false'); };
    const marcar = (i) => {
      activo = i;
      [...lista.children].forEach((li, n) => { li.classList.toggle('sel', n === i); if (n === i) li.scrollIntoView({ block: 'nearest' }); });
    };

    function elegir(e) {
      cerrar();
      if (e.crear) { crear.alCrear(input.value.trim()); return; }
      input.value = nombreDe(e.op);
      alElegir(e.op);
    }

    async function mostrar() {
      const texto = input.value.trim();
      const mio = ++pedido;
      let ops = [];
      try { ops = await buscar(texto); } catch { ops = []; }
      if (mio !== pedido) return;
      entradas = ops.map((op) => ({ op }));
      const hayExacta = ops.some((op) => nombreDe(op).toLowerCase() === texto.toLowerCase());
      if (crear && texto && !hayExacta) entradas.push({ crear: true });
      lista.innerHTML = '';
      if (!entradas.length) {
        const li = document.createElement('li');
        li.className = 'combo-vacio';
        li.textContent = 'No hay resultados.';
        lista.append(li);
      }
      entradas.forEach((e, i) => {
        const li = document.createElement('li');
        li.setAttribute('role', 'option');
        if (e.crear) { li.className = 'combo-crear'; li.textContent = crear.etiqueta(texto); } else li.innerHTML = render(e.op);
        li.addEventListener('mousedown', (ev) => { ev.preventDefault(); elegir(e); });
        li.addEventListener('mousemove', () => marcar(i));
        lista.append(li);
      });
      activo = -1;
      lista.hidden = false;
      input.setAttribute('aria-expanded', 'true');
    }

    input.addEventListener('focus', mostrar);
    input.addEventListener('input', () => {
      if (alEscribir) alEscribir();
      clearTimeout(espera);
      espera = setTimeout(mostrar, 200);
    });
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') { cerrar(); return; }
      if (lista.hidden) { if (ev.key === 'ArrowDown') mostrar(); return; }
      if (ev.key === 'ArrowDown') { ev.preventDefault(); marcar(Math.min(activo + 1, entradas.length - 1)); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); marcar(Math.max(activo - 1, 0)); }
      else if (ev.key === 'Enter') {
        ev.preventDefault();
        if (activo >= 0) elegir(entradas[activo]); else if (entradas.length === 1 && !entradas[0].crear) elegir(entradas[0]);
      }
    });
    input.addEventListener('blur', () => setTimeout(cerrar, 120));
    return { cerrar, abrir: mostrar };
  };
})();
