// Desejos: lista de desejos com preços e finanças.
// Tudo fica salvo no próprio aparelho: dados no localStorage, fotos no IndexedDB.
(() => {
  const CHAVE = 'desejos:v1'; // prefixo próprio: os outros apps usam o mesmo endereço (github.io)
  const $ = (id) => document.getElementById(id);
  const PRIOR = { 1: 'Alta', 2: 'Média', 3: 'Baixa' };

  // ---------- Dados ----------
  const padrao = () => ({
    perfil: { nome: '' },
    categorias: [
      { id: 'roupas', nome: 'Roupas' },
      { id: 'casa', nome: 'Casa' },
      { id: 'tecnologia', nome: 'Tecnologia' },
      { id: 'beleza', nome: 'Beleza' },
    ],
    itens: [],
    fin: { saldo: 0, mensal: 0, historico: [] },
    metas: [],
  });

  let dados = carregar();
  function carregar() {
    try {
      const d = JSON.parse(localStorage.getItem(CHAVE));
      if (d && Array.isArray(d.itens)) return Object.assign(padrao(), d);
    } catch {}
    return padrao();
  }
  function salvar() {
    try { localStorage.setItem(CHAVE, JSON.stringify(dados)); }
    catch { avisar('Não consegui salvar: o armazenamento do aparelho está cheio.'); }
  }
  const novoId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  // ---------- Fotos (IndexedDB) ----------
  const fotos = new Map(); // id do item -> URL do blob
  let bancoP = null;
  function banco() {
    if (!bancoP) bancoP = new Promise((ok, erro) => {
      const r = indexedDB.open('desejos-fotos', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('fotos');
      r.onsuccess = () => ok(r.result);
      r.onerror = () => erro(r.error);
    });
    return bancoP;
  }
  async function idb(modo, fn) {
    const db = await banco();
    return new Promise((ok, erro) => {
      const tx = db.transaction('fotos', modo);
      const req = fn(tx.objectStore('fotos'));
      tx.oncomplete = () => ok(req && req.result);
      tx.onerror = () => erro(tx.error);
    });
  }
  async function carregarFotos() {
    try {
      const db = await banco();
      await new Promise((ok) => {
        const req = db.transaction('fotos').objectStore('fotos').openCursor();
        req.onsuccess = () => {
          const c = req.result;
          if (!c) return ok();
          fotos.set(c.key, URL.createObjectURL(c.value));
          c.continue();
        };
        req.onerror = () => ok();
      });
    } catch {}
  }
  async function guardarFoto(id, blob) {
    try {
      await idb('readwrite', (s) => s.put(blob, id));
      if (fotos.has(id)) URL.revokeObjectURL(fotos.get(id));
      fotos.set(id, URL.createObjectURL(blob));
    } catch { avisar('Não consegui salvar a foto.'); }
  }
  async function apagarFoto(id) {
    try { await idb('readwrite', (s) => s.delete(id)); } catch {}
    if (fotos.has(id)) { URL.revokeObjectURL(fotos.get(id)); fotos.delete(id); }
  }
  // Diminui a foto para não ocupar muito espaço.
  function reduzirFoto(arquivo, lado = 900) {
    return new Promise((ok, erro) => {
      const img = new Image();
      const url = URL.createObjectURL(arquivo);
      img.onload = () => {
        const esc = Math.min(1, lado / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * esc); c.height = Math.round(img.height * esc);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob((b) => (b ? ok(b) : erro()), 'image/jpeg', 0.8);
      };
      img.onerror = () => { URL.revokeObjectURL(url); erro(); };
      img.src = url;
    });
  }

  // ---------- Utilidades ----------
  const fmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const dinheiro = (v) => fmt.format(v || 0);
  function lerValor(txt) {
    if (txt == null) return NaN;
    let s = String(txt).replace(/[R$\s]/g, '');
    if (!s) return NaN;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    const n = Number(s);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
  }
  const valorCampo = (v) => (v ? String(v.toFixed(2)).replace('.', ',') : '');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function linkSeguro(u) {
    u = (u || '').trim();
    if (!u) return '';
    if (!/^[a-z]+:/i.test(u)) u = 'https://' + u;
    try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch { return ''; }
  }
  function nomeDoSite(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } }
  const mesAno = (meses) => {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + meses);
    return d.toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }).replace('.', '');
  };
  let avisoT;
  function avisar(txt) {
    const a = $('aviso'); a.textContent = txt; a.hidden = false;
    clearTimeout(avisoT); avisoT = setTimeout(() => (a.hidden = true), 2600);
  }
  function abrir(dlg) { if (!dlg.open) dlg.showModal(); }
  document.querySelectorAll('dialog').forEach((d) => {
    d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
    d.querySelectorAll('[data-fechar]').forEach((b) => (b.onclick = () => d.close()));
  });

  // Preço de um item = o melhor (menor) preço cadastrado.
  function precosDe(it) { return (it.lojas || []).filter((l) => l.valor > 0); }
  function melhorPreco(it) {
    const p = precosDe(it);
    return p.length ? Math.min(...p.map((l) => l.valor)) : 0;
  }
  const categoriaDe = (id) => dados.categorias.find((c) => c.id === id);
  function ordenarPrioridade(a, b) { return a.prioridade - b.prioridade || a.ordem - b.ordem; }
  const pendentes = () => dados.itens.filter((i) => !i.comprado);

  // Quando dá pra comprar cada item, seguindo a ordem de prioridade.
  function plano() {
    const { saldo, mensal } = dados.fin;
    let acumulado = 0;
    return pendentes().slice().sort(ordenarPrioridade).map((it) => {
      const preco = melhorPreco(it);
      acumulado += preco;
      const falta = Math.max(0, acumulado - saldo);
      const meses = falta > 0 && mensal > 0 ? Math.ceil(falta / mensal) : null;
      return { it, preco, acumulado, falta, meses };
    });
  }
  function textoQuando(falta, meses) {
    if (falta <= 0) return 'Dá pra comprar já';
    if (meses == null) return `Faltam ${dinheiro(falta)}`;
    return meses <= 1 ? 'No próximo mês' : `Em ~${meses} meses (${mesAno(meses)})`;
  }

  // ---------- Navegação ----------
  let telaAtual = 'lista';
  document.querySelectorAll('.abas button').forEach((b) => {
    b.onclick = () => mostrarTela(b.dataset.tela);
  });
  function mostrarTela(t) {
    telaAtual = t;
    document.querySelectorAll('.abas button').forEach((b) => b.classList.toggle('ativa', b.dataset.tela === t));
    ['lista', 'financas', 'ajustes'].forEach((n) => ($('tela-' + n).hidden = n !== t));
    $('btn-novo').hidden = t === 'ajustes';
    $('btn-novo').setAttribute('aria-label', t === 'financas' ? 'Nova meta' : 'Adicionar item');
    desenhar();
    scrollTo(0, 0);
  }
  $('btn-novo').onclick = () => (telaAtual === 'financas' ? abrirMeta() : abrirForm());

  // ---------- Lista ----------
  const filtro = { categoria: 'todas', etiqueta: null, busca: '', ordem: 'prioridade', reordenar: false };

  $('busca').oninput = (e) => { filtro.busca = e.target.value.trim().toLowerCase(); desenharLista(); };
  $('ordem').onchange = (e) => { filtro.ordem = e.target.value; filtro.reordenar = false; desenharLista(); };
  $('btn-reordenar').onclick = () => { filtro.reordenar = !filtro.reordenar; desenharLista(); };

  function itensVisiveis() {
    let l = dados.itens.slice();
    if (filtro.categoria === 'comprados') l = l.filter((i) => i.comprado);
    else {
      l = l.filter((i) => !i.comprado);
      if (filtro.categoria !== 'todas') l = l.filter((i) => i.categoria === filtro.categoria);
    }
    if (filtro.etiqueta) l = l.filter((i) => (i.etiquetas || []).includes(filtro.etiqueta));
    if (filtro.busca) {
      l = l.filter((i) => [i.nome, i.descricao, ...(i.etiquetas || []), ...(i.lojas || []).map((x) => x.loja)]
        .join(' ').toLowerCase().includes(filtro.busca));
    }
    const s = {
      prioridade: ordenarPrioridade,
      menor: (a, b) => (melhorPreco(a) || Infinity) - (melhorPreco(b) || Infinity),
      maior: (a, b) => melhorPreco(b) - melhorPreco(a),
      recentes: (a, b) => b.criadoEm - a.criadoEm,
    }[filtro.ordem];
    if (filtro.categoria === 'comprados') l.sort((a, b) => (b.compradoEm || 0) - (a.compradoEm || 0));
    else l.sort(s);
    return l;
  }

  function chip(rotulo, ativo, onclick, n) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip' + (ativo ? ' ativa' : '');
    b.innerHTML = esc(rotulo) + (n != null ? `<span class="n">${n}</span>` : '');
    b.onclick = onclick;
    return b;
  }

  function todasEtiquetas() {
    const s = new Set();
    dados.itens.forEach((i) => (i.etiquetas || []).forEach((e) => s.add(e)));
    return [...s].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }

  function desenharLista() {
    const pend = pendentes();
    const nCat = (id) => pend.filter((i) => i.categoria === id).length;
    const cats = [
      chip('Tudo', filtro.categoria === 'todas', () => { filtro.categoria = 'todas'; desenharLista(); }, pend.length),
      ...dados.categorias.map((c) => chip(c.nome, filtro.categoria === c.id, () => { filtro.categoria = c.id; desenharLista(); }, nCat(c.id))),
    ];
    const nComprados = dados.itens.length - pend.length;
    if (nComprados) cats.push(chip('✓ Comprados', filtro.categoria === 'comprados', () => { filtro.categoria = 'comprados'; filtro.reordenar = false; desenharLista(); }, nComprados));
    $('filtro-categorias').replaceChildren(...cats);

    const etqs = todasEtiquetas();
    if (filtro.etiqueta && !etqs.includes(filtro.etiqueta)) filtro.etiqueta = null;
    $('filtro-etiquetas').replaceChildren(...etqs.map((e) =>
      chip('#' + e, filtro.etiqueta === e, () => { filtro.etiqueta = filtro.etiqueta === e ? null : e; desenharLista(); })));
    $('filtro-etiquetas').hidden = etqs.length === 0;

    const lista = itensVisiveis();
    const podeReordenar = filtro.ordem === 'prioridade' && filtro.categoria !== 'comprados' && lista.length > 1;
    if (!podeReordenar) filtro.reordenar = false;
    $('btn-reordenar').hidden = !podeReordenar;
    $('btn-reordenar').textContent = filtro.reordenar ? 'Pronto' : 'Reordenar';
    const total = lista.reduce((s, i) => s + melhorPreco(i), 0);
    $('contagem').textContent = lista.length
      ? `${lista.length} ${lista.length === 1 ? 'item' : 'itens'}${total ? ' · ' + dinheiro(total) : ''}`
      : '';

    $('lista').replaceChildren(...lista.map((it, idx) => cartaoItem(it, idx, lista)));
    const v = $('vazio');
    v.hidden = lista.length > 0;
    v.textContent = dados.itens.length === 0
      ? 'Sua lista está vazia. Toque no + para adicionar o primeiro desejo.'
      : 'Nada por aqui com esse filtro.';

    const nome = dados.perfil.nome.trim();
    $('saudacao').textContent = nome ? `Olá, ${nome}` : '';
    const totalPend = pend.reduce((s, i) => s + melhorPreco(i), 0);
    $('resumo').textContent = pend.length
      ? `${pend.length} ${pend.length === 1 ? 'desejo' : 'desejos'} · ${dinheiro(totalPend)} no total`
      : (nComprados ? 'Tudo comprado!' : '');
  }

  function cartaoItem(it, idx, lista) {
    const li = document.createElement('li');
    li.className = 'item' + (it.comprado ? ' comprado' : '');
    const preco = melhorPreco(it);
    const foto = fotos.get(it.id);
    const cat = categoriaDe(it.categoria);
    let fin = '';
    if (!it.comprado && preco > 0) {
      fin = preco <= dados.fin.saldo
        ? '<span class="cabe">Dá pra comprar</span>'
        : `<span class="falta">faltam ${dinheiro(preco - dados.fin.saldo)}</span>`;
    }
    li.innerHTML = `
      ${foto ? `<img class="miniatura" src="${foto}" alt="">` : `<div class="miniatura" aria-hidden="true">${esc((it.nome[0] || '?').toUpperCase())}</div>`}
      <div class="item-meio">
        <div class="nome">${esc(it.nome)}</div>
        <div class="linha-info">
          ${preco ? `<span class="preco">${dinheiro(preco)}</span>` : '<span>sem preço</span>'}
          ${it.comprado ? '' : `<span class="selo p${it.prioridade}">${PRIOR[it.prioridade]}</span>`}
          ${fin}
        </div>
        <div class="linha-info">
          ${filtro.categoria === 'todas' || filtro.categoria === 'comprados' ? (cat ? `<span>${esc(cat.nome)}</span>` : '') : ''}
          ${(it.etiquetas || []).map((e) => `<span class="etq">#${esc(e)}</span>`).join('')}
        </div>
      </div>`;
    if (filtro.reordenar) {
      const setas = document.createElement('div');
      setas.className = 'setas';
      const sobe = document.createElement('button');
      sobe.type = 'button'; sobe.textContent = '↑'; sobe.setAttribute('aria-label', 'Mais prioridade');
      sobe.disabled = idx === 0;
      sobe.onclick = (e) => { e.stopPropagation(); mover(lista, idx, -1); };
      const desce = document.createElement('button');
      desce.type = 'button'; desce.textContent = '↓'; desce.setAttribute('aria-label', 'Menos prioridade');
      desce.disabled = idx === lista.length - 1;
      desce.onclick = (e) => { e.stopPropagation(); mover(lista, idx, 1); };
      setas.append(sobe, desce);
      li.append(setas);
    } else {
      const m = document.createElement('button');
      m.type = 'button'; m.className = 'marcar';
      m.setAttribute('aria-label', it.comprado ? 'Desmarcar comprado' : 'Marcar como comprado');
      m.onclick = (e) => { e.stopPropagation(); alternarComprado(it); };
      li.append(m);
    }
    li.onclick = () => abrirDetalhe(it.id);
    return li;
  }

  // Troca o item de lugar com o vizinho. Se o vizinho tem outra prioridade, o item passa a ter a dele.
  function mover(lista, idx, dir) {
    const alvo = idx + dir;
    if (alvo < 0 || alvo >= lista.length) return;
    const it = lista[idx], viz = lista[alvo];
    if (it.prioridade !== viz.prioridade) it.prioridade = viz.prioridade;
    const nova = lista.slice();
    nova.splice(idx, 1); nova.splice(alvo, 0, it);
    // Renumera a ordem respeitando os grupos de prioridade.
    nova.forEach((x, i) => (x.ordem = i));
    salvar(); desenharLista();
  }

  function alternarComprado(it) {
    it.comprado = !it.comprado;
    it.compradoEm = it.comprado ? Date.now() : null;
    if (it.comprado) {
      const preco = melhorPreco(it);
      if (preco > 0 && confirm(`Comprou “${it.nome}”! Descontar ${dinheiro(preco)} do seu dinheiro?`)) {
        movimentar(-preco, `Comprei: ${it.nome}`);
      }
      avisar('Marcado como comprado ✓');
    }
    salvar(); desenhar();
  }

  // ---------- Detalhe ----------
  let detalheId = null;
  function abrirDetalhe(id) {
    const it = dados.itens.find((i) => i.id === id);
    if (!it) return;
    detalheId = id;
    const foto = fotos.get(id);
    const cat = categoriaDe(it.categoria);
    const comPreco = precosDe(it).slice().sort((a, b) => a.valor - b.valor);
    const semPreco = (it.lojas || []).filter((l) => !(l.valor > 0));
    const melhor = comPreco[0];
    const pior = comPreco[comPreco.length - 1];
    const celulaLoja = (l) => {
      const u = linkSeguro(l.url);
      const nome = esc(l.loja || (u ? nomeDoSite(u) : 'Loja'));
      return u ? `<a href="${esc(u)}" target="_blank" rel="noopener">${nome} ↗</a>` : nome;
    };

    let tabela = '';
    if (comPreco.length || semPreco.length) {
      tabela = `<h2>Comparação de preços</h2>
        <table class="tabela"><thead><tr><th>Onde</th><th style="text-align:right">Preço</th></tr></thead><tbody>
        ${comPreco.map((l) => `<tr class="${l === melhor ? 'melhor' : ''}"><td>${celulaLoja(l)}${l === melhor && comPreco.length > 1 ? '<span class="melhor-selo">MELHOR</span>' : ''}</td><td class="v">${dinheiro(l.valor)}</td></tr>`).join('')}
        ${semPreco.map((l) => `<tr><td>${celulaLoja(l)}</td><td class="v" style="color:var(--suave)">—</td></tr>`).join('')}
        </tbody></table>
        ${comPreco.length > 1 && pior.valor > melhor.valor ? `<p class="economia">Comprando em ${esc(melhor.loja || 'o mais barato')} você economiza ${dinheiro(pior.valor - melhor.valor)} em relação ao mais caro.</p>` : ''}`;
    }

    let caixa = '';
    if (!it.comprado && melhor) {
      const p = plano().find((x) => x.it.id === id);
      const { saldo, mensal } = dados.fin;
      const sozinho = melhor.valor <= saldo
        ? `<strong>Dá pra comprar agora</strong> com o dinheiro que você tem (${dinheiro(saldo)}). Sobram ${dinheiro(saldo - melhor.valor)}.`
        : `Faltam <strong>${dinheiro(melhor.valor - saldo)}</strong> para comprar só este item.${mensal > 0 ? ` Guardando ${dinheiro(mensal)} por mês, dá em ~${Math.ceil((melhor.valor - saldo) / mensal)} ${Math.ceil((melhor.valor - saldo) / mensal) === 1 ? 'mês' : 'meses'}.` : ''}`;
      const naFila = p && p.acumulado !== p.preco
        ? `<br>Seguindo a ordem de prioridade (depois dos itens acima dele): <strong>${textoQuando(p.falta, p.meses).toLowerCase()}</strong>.`
        : '';
      caixa = `<div class="caixa-fin">${sozinho}${naFila}</div>`;
    }

    $('detalhe').innerHTML = `
      <div class="folha-topo">
        <button type="button" class="link" data-acao="fechar">Fechar</button>
        <span></span>
        <button type="button" class="link forte" data-acao="editar">Editar</button>
      </div>
      ${foto ? `<img class="det-foto" src="${foto}" alt="">` : ''}
      <h1 class="det-nome">${esc(it.nome)}</h1>
      <div class="linha-info">
        ${it.comprado ? `<span class="cabe">✓ Comprado${it.compradoEm ? ' em ' + new Date(it.compradoEm).toLocaleDateString('pt-BR') : ''}</span>` : `<span class="selo p${it.prioridade}">Prioridade ${PRIOR[it.prioridade].toLowerCase()}</span>`}
        ${cat ? `<span>${esc(cat.nome)}</span>` : ''}
        ${(it.etiquetas || []).map((e) => `<span class="etq">#${esc(e)}</span>`).join('')}
      </div>
      ${melhor ? `<p class="preco" style="font-size:22px;margin:10px 0 0">${dinheiro(melhor.valor)}${comPreco.length > 1 ? ` <span style="font-size:14px;color:var(--suave);font-weight:400">melhor de ${comPreco.length} preços</span>` : ''}</p>` : ''}
      ${it.descricao ? `<p class="det-desc">${esc(it.descricao)}</p>` : ''}
      ${caixa}
      ${tabela}
      <div class="det-acoes">
        <button type="button" class="botao largo" data-acao="comprado">${it.comprado ? 'Desmarcar comprado' : '✓ Marcar como comprado'}</button>
        <button type="button" class="botao secundario" data-acao="editar">Editar</button>
        <button type="button" class="botao perigo" data-acao="apagar">Apagar</button>
      </div>`;
    $('detalhe').querySelectorAll('[data-acao]').forEach((b) => {
      b.onclick = () => {
        const a = b.dataset.acao;
        if (a === 'fechar') $('dlg-detalhe').close();
        if (a === 'editar') { $('dlg-detalhe').close(); abrirForm(id); }
        if (a === 'comprado') { alternarComprado(it); abrirDetalhe(id); }
        if (a === 'apagar' && confirm(`Apagar “${it.nome}”?`)) {
          dados.itens = dados.itens.filter((i) => i.id !== id);
          dados.metas.forEach((m) => (m.itens = (m.itens || []).filter((x) => x !== id)));
          apagarFoto(id); salvar(); $('dlg-detalhe').close(); desenhar();
        }
      };
    });
    abrir($('dlg-detalhe'));
  }

  // ---------- Formulário do item ----------
  let editando = null;          // id do item em edição (null = novo)
  let fotoNova = undefined;     // Blob nova | null (remover) | undefined (sem mudança)
  let fotoPreviaUrl = null;
  let formEtiquetas = [];
  let formPrioridade = 2;

  function opcoesCategoria(sel) {
    const s = $('f-categoria');
    s.replaceChildren(
      new Option('Sem categoria', ''),
      ...dados.categorias.map((c) => new Option(c.nome, c.id)),
      new Option('+ Nova categoria…', '__nova'),
    );
    s.value = sel || '';
  }
  $('f-categoria').onchange = (e) => {
    if (e.target.value !== '__nova') return;
    const nome = (prompt('Nome da nova categoria:') || '').trim();
    if (nome) {
      const c = { id: novoId(), nome };
      dados.categorias.push(c); salvar();
      opcoesCategoria(c.id);
    } else e.target.value = '';
  };

  function desenharPrioridade() {
    $('f-prioridade').querySelectorAll('button').forEach((b) => b.classList.toggle('ativa', Number(b.dataset.p) === formPrioridade));
  }
  $('f-prioridade').querySelectorAll('button').forEach((b) => (b.onclick = () => { formPrioridade = Number(b.dataset.p); desenharPrioridade(); }));

  function desenharEtiquetasForm() {
    const todas = [...new Set([...todasEtiquetas(), ...formEtiquetas, 'presente', 'promoção', 'urgente'])];
    $('f-etiquetas-sugestoes').replaceChildren(...todas.map((e) => chip('#' + e, formEtiquetas.includes(e), () => {
      formEtiquetas = formEtiquetas.includes(e) ? formEtiquetas.filter((x) => x !== e) : [...formEtiquetas, e];
      desenharEtiquetasForm();
    })));
  }
  function adicionarEtiquetaDigitada() {
    const v = $('f-etiqueta').value.trim().replace(/^#/, '').toLowerCase();
    if (v && !formEtiquetas.includes(v)) formEtiquetas.push(v);
    $('f-etiqueta').value = '';
    desenharEtiquetasForm();
  }
  $('f-etiqueta').onkeydown = (e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); adicionarEtiquetaDigitada(); } };
  $('f-etiqueta').onblur = adicionarEtiquetaDigitada;

  function linhaLoja(l = {}) {
    const d = document.createElement('div');
    d.className = 'loja-linha';
    d.innerHTML = `
      <input class="loja" placeholder="Loja ou site" maxlength="60" value="${esc(l.loja)}">
      <input class="valor" inputmode="decimal" placeholder="R$ 0,00" value="${esc(valorCampo(l.valor))}">
      <button type="button" class="apagar" aria-label="Remover loja">×</button>
      <input class="url" type="text" inputmode="url" autocapitalize="off" placeholder="Link (opcional)" value="${esc(l.url)}">`;
    d.querySelector('.apagar').onclick = () => d.remove();
    return d;
  }
  $('f-add-loja').onclick = () => {
    const l = linhaLoja(); $('f-lojas').append(l); l.querySelector('.loja').focus();
  };

  function mostrarPreviaFoto(url) {
    $('foto-previa').hidden = !url;
    if (url) $('foto-previa').src = url; else $('foto-previa').removeAttribute('src');
    $('foto-texto').hidden = !!url;
    $('foto-remover').hidden = !url;
  }
  $('foto').onchange = async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      fotoNova = await reduzirFoto(f);
      if (fotoPreviaUrl) URL.revokeObjectURL(fotoPreviaUrl);
      fotoPreviaUrl = URL.createObjectURL(fotoNova);
      mostrarPreviaFoto(fotoPreviaUrl);
    } catch { avisar('Não consegui abrir essa imagem.'); }
  };
  $('foto-remover').onclick = () => { fotoNova = null; mostrarPreviaFoto(null); };

  function abrirForm(id = null) {
    const it = id ? dados.itens.find((i) => i.id === id) : null;
    editando = it ? it.id : null;
    fotoNova = undefined;
    $('form-titulo').textContent = it ? 'Editar item' : 'Novo item';
    $('f-nome').value = it ? it.nome : '';
    $('f-descricao').value = it ? it.descricao || '' : '';
    $('f-comprado').checked = !!(it && it.comprado);
    const catPadrao = !it && !['todas', 'comprados'].includes(filtro.categoria) ? filtro.categoria : '';
    opcoesCategoria(it ? it.categoria : catPadrao);
    formPrioridade = it ? it.prioridade : 2;
    formEtiquetas = it ? [...(it.etiquetas || [])] : [];
    $('f-etiqueta').value = '';
    desenharPrioridade(); desenharEtiquetasForm();
    const lojas = it && it.lojas && it.lojas.length ? it.lojas : [{}];
    $('f-lojas').replaceChildren(...lojas.map(linhaLoja));
    mostrarPreviaFoto(it ? fotos.get(it.id) : null);
    abrir($('dlg-form'));
    $('dlg-form').scrollTop = 0;
    if (!it) setTimeout(() => $('f-nome').focus(), 50);
  }

  $('form-item').onsubmit = async (e) => {
    e.preventDefault();
    adicionarEtiquetaDigitada();
    const nome = $('f-nome').value.trim();
    if (!nome) { $('f-nome').focus(); return; }
    const lojas = [...$('f-lojas').querySelectorAll('.loja-linha')].map((d) => ({
      loja: d.querySelector('.loja').value.trim(),
      valor: lerValor(d.querySelector('.valor').value) || 0,
      url: d.querySelector('.url').value.trim(),
    })).filter((l) => l.loja || l.valor || l.url);

    let it = editando ? dados.itens.find((i) => i.id === editando) : null;
    const comprado = $('f-comprado').checked;
    if (!it) {
      it = { id: novoId(), criadoEm: Date.now(), ordem: dados.itens.length ? Math.max(...dados.itens.map((i) => i.ordem)) + 1 : 0 };
      dados.itens.push(it);
    }
    Object.assign(it, {
      nome, lojas,
      categoria: $('f-categoria').value === '__nova' ? '' : $('f-categoria').value,
      descricao: $('f-descricao').value.trim(),
      prioridade: formPrioridade,
      etiquetas: formEtiquetas,
    });
    if (comprado !== !!it.comprado) { it.comprado = comprado; it.compradoEm = comprado ? Date.now() : null; }
    if (fotoNova instanceof Blob) await guardarFoto(it.id, fotoNova);
    else if (fotoNova === null) await apagarFoto(it.id);
    salvar();
    $('dlg-form').close();
    desenhar();
    avisar(editando ? 'Item atualizado' : 'Item adicionado');
  };

  // ---------- Finanças ----------
  function movimentar(valor, nota) {
    dados.fin.saldo = Math.round((dados.fin.saldo + valor) * 100) / 100;
    dados.fin.historico.unshift({ id: novoId(), valor, nota: nota || '', em: Date.now() });
    dados.fin.historico = dados.fin.historico.slice(0, 200);
    salvar();
  }
  function pedirValor(msg) {
    const r = prompt(msg);
    if (r == null) return null;
    const v = lerValor(r);
    if (!Number.isFinite(v)) { avisar('Valor inválido. Ex.: 150,00'); return null; }
    return v;
  }
  $('saldo').onclick = () => {
    const v = pedirValor('Quanto dinheiro você tem hoje? (R$)');
    if (v == null) return;
    const dif = v - dados.fin.saldo;
    if (dif) movimentar(dif, 'Ajuste do saldo');
    desenhar();
  };
  $('btn-entrou').onclick = () => {
    const v = pedirValor('Quanto entrou? (R$)');
    if (!v) return;
    const nota = prompt('De onde veio? (opcional)') || 'Entrou';
    movimentar(Math.abs(v), nota); desenhar();
  };
  $('btn-saiu').onclick = () => {
    const v = pedirValor('Quanto saiu? (R$)');
    if (!v) return;
    const nota = prompt('Com o quê? (opcional)') || 'Saiu';
    movimentar(-Math.abs(v), nota); desenhar();
  };
  $('mensal').onchange = (e) => {
    const v = lerValor(e.target.value);
    dados.fin.mensal = Number.isFinite(v) && v > 0 ? v : 0;
    salvar(); desenhar();
  };

  function valorMeta(m) {
    if (m.valor > 0) return m.valor;
    return (m.itens || []).map((id) => dados.itens.find((i) => i.id === id)).filter(Boolean).reduce((s, i) => s + melhorPreco(i), 0);
  }

  function desenharFinancas() {
    const { saldo, mensal } = dados.fin;
    $('saldo').textContent = dinheiro(saldo);
    if (document.activeElement !== $('mensal')) $('mensal').value = mensal ? dinheiro(mensal) : '';

    const p = plano();
    const total = p.reduce((s, x) => s + x.preco, 0);
    const falta = Math.max(0, total - saldo);
    const cabem = p.filter((x) => x.preco > 0 && x.falta <= 0).length;
    const ultimo = p.length ? p[p.length - 1] : null;
    $('numeros').innerHTML = `
      <div class="numero"><span>Total da lista</span><b>${dinheiro(total)}</b></div>
      <div class="numero"><span>Falta para tudo</span><b>${dinheiro(falta)}</b></div>
      <div class="numero largo"><span>${
        !p.length ? 'Adicione itens com preço para ver o plano.'
        : falta <= 0 ? 'Você já tem dinheiro para comprar tudo da lista!'
        : `Já dá para comprar ${cabem} ${cabem === 1 ? 'item' : 'itens'} seguindo a prioridade.`
      }</span>${p.length && falta > 0 ? `<b>${mensal > 0 ? `Tudo em ~${ultimo.meses} ${ultimo.meses === 1 ? 'mês' : 'meses'} (${mesAno(ultimo.meses)})` : 'Informe quanto guarda por mês para ver a previsão'}</b>` : ''}</div>`;

    // Metas
    $('lista-metas').replaceChildren(...dados.metas.map((m) => {
      const alvo = valorMeta(m);
      const pct = alvo > 0 ? Math.min(100, (saldo / alvo) * 100) : 0;
      const nomes = (m.itens || []).map((id) => dados.itens.find((i) => i.id === id)).filter(Boolean).map((i) => i.nome + (i.comprado ? ' ✓' : ''));
      const faltaM = Math.max(0, alvo - saldo);
      const li = document.createElement('li');
      li.className = 'meta';
      li.innerHTML = `
        <div class="meta-topo"><strong>${esc(m.nome)}</strong><span>${dinheiro(saldo)} de ${dinheiro(alvo)}</span></div>
        <div class="barra"><i style="width:${pct}%"></i></div>
        ${faltaM <= 0 && alvo > 0
          ? `<p class="ok">Meta atingida!${nomes.length ? ' Já pode comprar: ' + esc(nomes.join(', ')) : ''}</p>`
          : `<p>Faltam ${dinheiro(faltaM)}${mensal > 0 && faltaM > 0 ? ` · ~${Math.ceil(faltaM / mensal)} ${Math.ceil(faltaM / mensal) === 1 ? 'mês' : 'meses'} (${mesAno(Math.ceil(faltaM / mensal))})` : ''}</p>
             ${nomes.length ? `<p>Quando chegar lá: ${esc(nomes.join(', '))}</p>` : ''}`}`;
      li.onclick = () => abrirMeta(m.id);
      return li;
    }));

    // Plano
    $('plano').replaceChildren(...p.filter((x) => x.preco > 0).map((x, i) => {
      const li = document.createElement('li');
      li.innerHTML = `<span class="pos">${i + 1}</span>
        <span class="pn">${esc(x.it.nome)}<br><span style="color:var(--suave);font-size:13px">${dinheiro(x.preco)} · acumulado ${dinheiro(x.acumulado)}</span></span>
        <span class="quando ${x.falta <= 0 ? 'ok' : ''}">${textoQuando(x.falta, x.meses)}</span>`;
      li.style.cursor = 'pointer';
      li.onclick = () => abrirDetalhe(x.it.id);
      return li;
    }));
    if (!$('plano').children.length) {
      const li = document.createElement('li');
      li.textContent = 'Nenhum item com preço ainda.';
      li.style.color = 'var(--suave)';
      $('plano').append(li);
    }

    const h = dados.fin.historico;
    $('historico').replaceChildren(...(h.length ? h : [null]).map((m) => {
      const li = document.createElement('li');
      if (!m) { li.textContent = 'Nenhuma movimentação ainda.'; li.style.color = 'var(--suave)'; return li; }
      li.innerHTML = `<span>${esc(m.nota)}<br><span style="color:var(--suave);font-size:12px">${new Date(m.em).toLocaleDateString('pt-BR')}</span></span>
        <span class="${m.valor >= 0 ? 'mais' : 'menos'}">${m.valor >= 0 ? '+' : '−'}${dinheiro(Math.abs(m.valor))}</span>`;
      return li;
    }));
  }

  // Formulário de meta
  let metaEditando = null;
  function abrirMeta(id = null) {
    const m = id ? dados.metas.find((x) => x.id === id) : null;
    metaEditando = m ? m.id : null;
    $('meta-titulo').textContent = m ? 'Editar meta' : 'Nova meta';
    $('m-nome').value = m ? m.nome : '';
    $('m-valor').value = m && m.valor ? valorCampo(m.valor) : '';
    $('m-apagar').hidden = !m;
    const sel = new Set(m ? m.itens : []);
    const itens = dados.itens.filter((i) => !i.comprado || sel.has(i.id)).sort(ordenarPrioridade);
    $('m-itens').replaceChildren(...(itens.length ? itens.map((i) => {
      const li = document.createElement('li');
      li.innerHTML = `<label><input type="checkbox" value="${esc(i.id)}" ${sel.has(i.id) ? 'checked' : ''}> <span>${esc(i.nome)}</span><span class="v">${melhorPreco(i) ? dinheiro(melhorPreco(i)) : '—'}</span></label>`;
      return li;
    }) : [Object.assign(document.createElement('li'), { textContent: 'Sua lista ainda está vazia.', style: 'color:var(--suave);font-size:14px' })]));
    abrir($('dlg-meta'));
    if (!m) setTimeout(() => $('m-nome').focus(), 50);
  }
  $('btn-nova-meta').onclick = () => abrirMeta();
  $('form-meta').onsubmit = (e) => {
    e.preventDefault();
    const nome = $('m-nome').value.trim();
    if (!nome) return;
    const valor = lerValor($('m-valor').value);
    const itens = [...$('m-itens').querySelectorAll('input:checked')].map((c) => c.value);
    let m = metaEditando ? dados.metas.find((x) => x.id === metaEditando) : null;
    if (!m) { m = { id: novoId() }; dados.metas.push(m); }
    Object.assign(m, { nome, valor: Number.isFinite(valor) && valor > 0 ? valor : 0, itens });
    salvar(); $('dlg-meta').close(); desenhar();
  };
  $('m-apagar').onclick = () => {
    if (!confirm('Apagar esta meta?')) return;
    dados.metas = dados.metas.filter((x) => x.id !== metaEditando);
    salvar(); $('dlg-meta').close(); desenhar();
  };

  // ---------- Perfil / ajustes ----------
  $('perfil-nome').oninput = (e) => { dados.perfil.nome = e.target.value; salvar(); };

  function desenharAjustes() {
    if (document.activeElement !== $('perfil-nome')) $('perfil-nome').value = dados.perfil.nome;
    $('lista-categorias').replaceChildren(...dados.categorias.map((c) => {
      const li = document.createElement('li');
      li.className = 'categoria-linha';
      const n = dados.itens.filter((i) => i.categoria === c.id).length;
      li.innerHTML = `<input value="${esc(c.nome)}" maxlength="40" aria-label="Nome da categoria"><span class="n">${n} ${n === 1 ? 'item' : 'itens'}</span><button type="button" class="apagar" aria-label="Apagar categoria">×</button>`;
      li.querySelector('input').onchange = (e) => { const v = e.target.value.trim(); if (v) { c.nome = v; salvar(); } else e.target.value = c.nome; };
      li.querySelector('button').onclick = () => {
        if (!confirm(`Apagar a categoria “${c.nome}”?${n ? ` Os ${n} itens dela ficam sem categoria.` : ''}`)) return;
        dados.categorias = dados.categorias.filter((x) => x.id !== c.id);
        dados.itens.forEach((i) => { if (i.categoria === c.id) i.categoria = ''; });
        if (filtro.categoria === c.id) filtro.categoria = 'todas';
        salvar(); desenhar();
      };
      return li;
    }));
  }
  $('form-categoria').onsubmit = (e) => {
    e.preventDefault();
    const nome = $('nova-categoria').value.trim();
    if (!nome) return;
    dados.categorias.push({ id: novoId(), nome });
    $('nova-categoria').value = '';
    salvar(); desenhar();
  };

  // Exportar / importar (com fotos)
  const blobParaDataUrl = (b) => new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(b); });
  $('btn-exportar').onclick = async () => {
    const fotosExp = {};
    for (const it of dados.itens) {
      const u = fotos.get(it.id);
      if (u) fotosExp[it.id] = await blobParaDataUrl(await (await fetch(u)).blob());
    }
    const blob = new Blob([JSON.stringify({ app: 'desejos', versao: 1, dados, fotos: fotosExp })], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `desejos-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  $('importar').onchange = async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      if (j.app !== 'desejos' || !j.dados || !Array.isArray(j.dados.itens)) throw new Error();
      if (!confirm('Isso substitui tudo o que está neste aparelho pelo conteúdo do arquivo. Continuar?')) return;
      for (const id of [...fotos.keys()]) await apagarFoto(id);
      dados = Object.assign(padrao(), j.dados);
      for (const [id, url] of Object.entries(j.fotos || {})) {
        if (typeof url === 'string' && url.startsWith('data:image/')) await guardarFoto(id, await (await fetch(url)).blob());
      }
      salvar(); desenhar(); avisar('Importado!');
    } catch { avisar('Esse arquivo não é uma cópia do Desejos.'); }
  };

  // ---------- Desenhar tudo ----------
  function desenhar() {
    if (telaAtual === 'lista') desenharLista();
    if (telaAtual === 'financas') desenharFinancas();
    if (telaAtual === 'ajustes') desenharAjustes();
  }

  // Dica de "Adicionar à Tela de Início" quando aberto no navegador.
  const instalado = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  let dispensou = false;
  try { dispensou = localStorage.getItem('desejos:dica') === '1'; } catch {}
  if (!instalado && !dispensou) $('dica-instalar').hidden = false;
  $('fechar-dica').onclick = () => {
    $('dica-instalar').hidden = true;
    try { localStorage.setItem('desejos:dica', '1'); } catch {}
  };

  window.addEventListener('storage', (e) => { if (e.key === CHAVE) { dados = carregar(); desenhar(); } });

  desenhar();
  carregarFotos().then(desenhar);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => {});
  }
})();
