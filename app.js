'use strict';
/* Pesquisa de Preço — West Brasil
 * Fluxo: login → início → cliente → produto Mobil → marca → produto concorrente → preço → fotos → revisão.
 * Dados fixos em data/data.js (scripts/gerar_dados.py). Pesquisas ficam no IndexedDB do aparelho
 * até a fase do banco da West. */

const D = window.DATA;
const $ = s => document.querySelector(s);
const app = $('#app');
const DEMO = new URLSearchParams(location.search).has('demo'); // só para teste sem câmera

// Login provisório da fase de layout — será trocado pelo login Microsoft da West
const USUARIOS = { 'rafael.leonardo@westbrasil.com.br': { senha: '1234', nome: 'Rafael Leonardo' } };

const PASSOS = ['cliente', 'mobil', 'marca', 'concorrente', 'preco', 'fotos', 'revisao'];
const TITULO_PASSO = {
  cliente: 'Cliente', mobil: 'Produto Mobil', marca: 'Concorrente', concorrente: 'Produto concorrente',
  preco: 'Preço', fotos: 'Fotos', revisao: 'Revisão',
};

let sessao = lerSessao();
let tela = null;      // nome da tela atual
let P = null;         // pesquisa em andamento

/* ============================================================ utilidades */
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
const compact = s => norm(s).replace(/[^A-Z0-9]/g, '');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = v => v == null || isNaN(v) ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataHora = iso => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
const tokens = q => norm(q).split(/\s+/).map(compact).filter(Boolean);
const debounce = (fn, ms = 160) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), ms);
}

function lerSessao() {
  try { return JSON.parse(localStorage.getItem('pp_sessao')); } catch { return null; }
}

const ICON = {
  busca: '<svg width="18" height="18" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M20 20l-4-4" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  chev: '<svg class="chev" width="18" height="18" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  cam: '<svg width="34" height="34" viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.6" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
  ok: '<svg width="16" height="16" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  okG: '<svg width="44" height="44" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  lupa: '<svg width="34" height="34" viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M15.5 15.5L21 21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M8 10.5h5M10.5 8v5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
};

/* ============================================================ armazenamento local */
const DB = (() => {
  let conn;
  const abrir = () => conn || (conn = new Promise((res, rej) => {
    const r = indexedDB.open('pesquisa-preco', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('pesquisas', { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const tx = (modo, fn) => abrir().then(db => new Promise((res, rej) => {
    const t = db.transaction('pesquisas', modo);
    const req = fn(t.objectStore('pesquisas'));
    t.oncomplete = () => res(req.result);
    t.onerror = () => rej(t.error);
  }));
  return {
    salvar: o => tx('readwrite', s => s.put(o)),
    todas: () => tx('readonly', s => s.getAll()),
    excluir: id => tx('readwrite', s => s.delete(id)),
  };
})();

/* ============================================================ índices de busca */
const CLIENTES = D.clientes.map(([cod, nome, cidade, vend, seg, sit]) =>
  ({ cod, nome, cidade, vend, seg, sit, k: compact(`${cod} ${nome} ${cidade}`) }));

// Produtos Mobil agrupados por família (mesmo produto em embalagens diferentes = 1 opção)
const MOBIL = (() => {
  const g = new Map();
  for (const p of D.mobil) {
    const key = compact(p.f).replace(/^MOBIL/, 'M');
    if (!g.has(key)) g.set(key, { key, nome: p.f, s: p.s, v: p.v, b: p.b, l: p.l, e: new Set(), skus: [] });
    const x = g.get(key);
    x.skus.push({ c: p.c, n: p.n });
    p.e.forEach(e => x.e.add(e));
    if (!x.v && p.v) x.v = p.v;
    if (!x.b && p.b) x.b = p.b;
  }
  return [...g.values()].map(x => ({
    ...x, e: [...x.e], codigos: x.skus.map(s => s.c),
    k: compact(x.nome + ' ' + x.skus.map(s => s.c + ' ' + s.n).join(' ')),
  }));
})();

const CONC = D.concorrentes;
const CONC_POR_ID = Object.fromEntries(CONC.map(c => [c.id, c]));
const SINONIMOS = {}; // id -> [nomes antigos]
for (const [antigo, id] of D.sinonimos) (SINONIMOS[id] ||= []).push(antigo);
for (const c of CONC) c.k = compact(c.n + ' ' + c.li + ' ' + (SINONIMOS[c.id] || []).join(' '));

/* ============================================================ motor de semelhança
 * Pontuação 0–100 entre o produto Mobil e cada produto do concorrente:
 *   segmento (40) + viscosidade (35) + base (12) + especificações (8) + palavras-chave (5)
 * Ajuste de pesos aqui se os vendedores acharem as sugestões fracas. */
const SEG_VIZINHOS = {
  'Carro Gasolina/Flex': ['Diesel Leve'],
  'Diesel Leve': ['Carro Gasolina/Flex', 'Diesel Pesado'],
  'Diesel Pesado': ['Diesel Leve', 'Agrícola'],
  'Agrícola': ['Transmissão Automotiva', 'Hidráulico', 'Diesel Pesado'],
  'Transmissão Automotiva': ['Engrenagens/Diferencial', 'Agrícola', 'ATF'],
  'Engrenagens/Diferencial': ['Transmissão Automotiva', 'Industrial'],
  'ATF': ['Transmissão Automotiva'],
  'Hidráulico': ['Industrial', 'Agrícola'],
  'Industrial': ['Hidráulico', 'Engrenagens/Diferencial'],
  'Moto 2T': ['Náutico/Outros'],
  'Náutico/Outros': ['Moto 2T'],
  'Marítimo': ['Diesel Pesado'],
};
const ISO_SERIE = [2, 3, 5, 7, 10, 15, 22, 32, 46, 68, 100, 150, 220, 320, 460, 680, 1000, 1500];

function lerVisc(v) {
  const out = [];
  for (const parte of String(v || '').toUpperCase().split('/')) {
    const s = parte.trim();
    let m;
    if ((m = s.match(/^(?:SAE\s*)?(\d+)W-?(\d+)$/))) out.push({ t: 'M', w: +m[1], h: +m[2] });
    else if ((m = s.match(/^(?:SAE\s*)?(\d+)W$/))) out.push({ t: 'W', w: +m[1] });
    else if ((m = s.match(/^SAE\s*(\d+)$/))) out.push({ t: 'S', h: +m[1] });
    else if ((m = s.match(/^ISO\s*(?:VG\s*)?(\d+)$/))) out.push({ t: 'I', n: +m[1] });
    else if ((m = s.match(/^NLGI\s*(\d+)/))) out.push({ t: 'N', n: +m[1] });
  }
  return out;
}

function notaVisc(a, b) {
  let best = 0;
  for (const x of a) for (const y of b) {
    let n = 0;
    if (x.t === 'M' && y.t === 'M') {
      if (x.w === y.w && x.h === y.h) n = 1;
      else if (x.h === y.h && Math.abs(x.w - y.w) <= 5) n = .6;
      else if (x.w === y.w && Math.abs(x.h - y.h) <= 10) n = .45;
      else if (Math.abs(x.h - y.h) <= 10 && Math.abs(x.w - y.w) <= 5) n = .3;
    } else if ((x.t === 'S' && y.t === 'M') || (x.t === 'M' && y.t === 'S')) {
      n = x.h === y.h ? .45 : 0;
    } else if (x.t === y.t && x.t === 'S') n = x.h === y.h ? 1 : Math.abs(x.h - y.h) <= 10 ? .4 : 0;
    else if (x.t === y.t && x.t === 'W') n = x.w === y.w ? 1 : 0;
    else if (x.t === y.t && x.t === 'I') {
      const d = Math.abs(ISO_SERIE.indexOf(x.n) - ISO_SERIE.indexOf(y.n));
      n = x.n === y.n ? 1 : (ISO_SERIE.includes(x.n) && ISO_SERIE.includes(y.n) && d === 1) ? .4 : 0;
    } else if (x.t === y.t && x.t === 'N') n = x.n === y.n ? 1 : Math.abs(x.n - y.n) === 1 ? .4 : 0;
    best = Math.max(best, n);
  }
  return best;
}

const BASE_ORD = { 'Mineral': 0, 'Semissintético': 1, 'Sintético': 2 };
const PALAVRAS = ['MOTO', '4T', '2T', 'SCOOTER', 'ATF', 'CVT', 'DEXRON', 'DCT', 'UTTO', 'TO4', 'TURBINA', 'COMPRESS',
  'HIDRAUL', 'HYDRAUL', 'CIRCULA', 'GRAXA', 'GREASE', 'EP', 'GEAR', 'ENGREN', 'DIFERENC', 'AXLE', 'FREIO', 'DOT',
  'COOLANT', 'RADIADOR', 'ARREFEC', 'FLEX', 'GNV', 'RACING', 'HYBRID', 'HIBRID', 'CORTE', 'CUT', 'VACUO', 'ESTACION',
  'CORRENTE', 'CHAIN', 'SUSPENS', 'FORK', 'GARFO', 'CILINDRO', 'GUIA', 'SLIDEWAY', 'TERMIC', 'REFRIGER', 'FOOD', 'FG'];

function specKey(s) {
  return compact(s).replace(/^API/, '').replace(/^JASO/, '');
}

function similaridade(mob, c) {
  const motivos = [];
  let pts = 0;
  if (mob.s === c.s) { pts += 40; motivos.push('Mesmo segmento'); }
  else if ((SEG_VIZINHOS[mob.s] || []).includes(c.s)) { pts += 15; }

  const vm = lerVisc(mob.v), vc = lerVisc(c.v);
  if (vm.length && vc.length) {
    const n = notaVisc(vm, vc);
    pts += 35 * n;
    if (n === 1) motivos.push('Mesma viscosidade');
    else if (n >= .4) motivos.push('Viscosidade próxima');
  } else if (!vm.length && !vc.length) pts += 10; // ATF, fluido de freio etc.: não penaliza

  if (mob.b && c.b) {
    const d = Math.abs(BASE_ORD[mob.b] - BASE_ORD[c.b]);
    if (d === 0) { pts += 12; motivos.push('Mesma base'); } else if (d === 1) pts += 4;
  } else pts += 4;

  if (mob.e.length && c.e.length) {
    const ce = new Set(c.e.map(specKey));
    const comuns = mob.e.filter(e => ce.has(specKey(e)));
    if (comuns.length) { pts += 8; motivos.push(comuns[0]); }
  }

  const nm = compact(mob.nome), nc = compact(c.n + ' ' + c.li);
  const kw = PALAVRAS.filter(p => nm.includes(p) && nc.includes(p)).length;
  pts += Math.min(5, kw * 2.5);

  if (c.st === 'Incerto') pts -= 4;
  if (c.st === 'Descontinuado') pts -= 12;
  return { pct: Math.max(0, Math.min(100, Math.round(pts))), motivos };
}

/* ============================================================ navegação */
function irPara(nome) {
  tela = nome;
  window.scrollTo(0, 0);
  const passo = PASSOS.indexOf(nome);
  $('#topo').hidden = nome === 'login';
  $('#btnVoltar').hidden = nome === 'inicio' || nome === 'login';
  $('#passos').hidden = passo < 0;
  $('#hLogo').hidden = passo >= 0;
  if (passo >= 0) {
    $('#passos').innerHTML = PASSOS.map((_, i) => `<i class="${i <= passo ? 'on' : ''}"></i>`).join('');
    $('#hTitulo').textContent = `${passo + 1}/${PASSOS.length} · ${TITULO_PASSO[nome]}`;
    $('#hSub').textContent = 'Nova pesquisa de preço';
  } else {
    $('#hTitulo').textContent = nome === 'historico' ? 'Histórico de pesquisas' : 'Pesquisa de Preço';
    $('#hSub').textContent = sessao ? sessao.email : '';
  }
  ({ login: telaLogin, inicio: telaInicio, historico: telaHistorico, sucesso: telaSucesso,
     cliente: telaCliente, mobil: telaMobil, marca: telaMarca, concorrente: telaConcorrente,
     preco: telaPreco, fotos: telaFotos, revisao: telaRevisao })[nome]();
}

function voltar() {
  if (!$('#camera').hidden) return fecharCamera();
  if (!$('#modal').hidden) return fecharModal();
  const passo = PASSOS.indexOf(tela);
  if (passo > 0) return irPara(PASSOS[passo - 1]);
  if (passo === 0) {
    if (P && (P.mobil || P.conc) && !confirm('Descartar esta pesquisa?')) return;
    P = null;
    return irPara('inicio');
  }
  if (tela === 'historico' || tela === 'sucesso') return irPara('inicio');
}

$('#btnVoltar').onclick = voltar;
$('#btnSair').onclick = () => {
  if (!confirm('Sair do aplicativo?')) return;
  localStorage.removeItem('pp_sessao');
  sessao = null; P = null;
  irPara('login');
};
// botão "voltar" do Android
history.pushState(null, '');
window.addEventListener('popstate', () => { if (tela !== 'inicio' && tela !== 'login') voltar(); history.pushState(null, ''); });

function contexto(ate) {
  const linhas = [];
  if (P.cliente && ate > 0) linhas.push(['Cliente', `<b class="cod" style="min-width:0;color:var(--blue)">${esc(P.cliente.cod)}</b> ${esc(P.cliente.nome)}`]);
  if (P.mobil && ate > 1) linhas.push(['Mobil', esc(P.mobil.nome)]);
  if (P.marca && ate > 2) linhas.push(['Concorr.', esc(P.marca)]);
  if (P.conc && ate > 3) linhas.push(['Produto', esc(P.conc.n)]);
  if (!linhas.length) return '';
  return `<div class="ctx">${linhas.map(([a, b]) => `<div><b>${a}</b><span>${b}</span></div>`).join('')}</div>`;
}

/* ============================================================ login */
function telaLogin() {
  app.innerHTML = `
  <form class="login" id="fLogin" autocomplete="on">
    <div class="login-marca">
      <img class="login-logo" src="logo-west.png" alt="West Brasil Distribuidora">
      <h1>Pesquisa de Preço</h1>
      <p>Preços da concorrência nos clientes</p>
    </div>
    <label class="campo"><span>E-mail</span>
      <input class="inp" id="lEmail" type="email" inputmode="email" autocomplete="username" placeholder="nome@westbrasil.com.br" required></label>
    <label class="campo"><span>Senha</span>
      <input class="inp" id="lSenha" type="password" autocomplete="current-password" required></label>
    <div class="erro" id="lErro"></div>
    <button class="btn" type="submit">Entrar</button>
  </form>`;
  $('#fLogin').onsubmit = e => {
    e.preventDefault();
    const email = $('#lEmail').value.trim().toLowerCase();
    const u = USUARIOS[email];
    if (!u || u.senha !== $('#lSenha').value) { $('#lErro').textContent = 'E-mail ou senha inválidos.'; return; }
    sessao = { email, nome: u.nome };
    localStorage.setItem('pp_sessao', JSON.stringify(sessao));
    irPara('inicio');
  };
}

/* ============================================================ início */
async function telaInicio() {
  const primeiro = (sessao.nome || sessao.email).split(' ')[0];
  app.innerHTML = `
    <div class="saud"><h2>Olá, ${esc(primeiro)}</h2><p>Registre os preços da concorrência nos seus clientes.</p></div>
    <button class="btn grande" id="bNova">${ICON.lupa}<span>Realizar nova pesquisa</span></button>
    <div class="kpis" id="kpis"></div>
    <button class="btn sec" id="bHist">Ver histórico de pesquisas</button>
    <div class="sec-t">Últimas pesquisas</div>
    <div class="lista" id="ultimas"><div class="vazio">Carregando…</div></div>
    <p class="dica" style="text-align:center;margin-top:24px">Base de clientes e produtos atualizada em ${esc(D.gerado)}</p>`;
  $('#bNova').onclick = () => { P = { fotos: {} }; irPara('cliente'); };
  $('#bHist').onclick = () => irPara('historico');

  const todas = (await DB.todas()).sort((a, b) => b.data.localeCompare(a.data));
  const hoje = new Date().toDateString();
  const d30 = Date.now() - 30 * 864e5;
  $('#kpis').innerHTML = `
    <div class="kpi"><b>${todas.filter(p => new Date(p.data).toDateString() === hoje).length}</b><span>hoje</span></div>
    <div class="kpi"><b>${todas.filter(p => new Date(p.data) >= d30).length}</b><span>últimos 30 dias</span></div>
    <div class="kpi"><b>${new Set(todas.map(p => p.cliente.cod)).size}</b><span>clientes</span></div>`;
  $('#ultimas').innerHTML = todas.length ? '' : '<div class="vazio">Nenhuma pesquisa registrada ainda.</div>';
  todas.slice(0, 4).forEach(p => $('#ultimas').appendChild(itemHistorico(p)));
}

/* ============================================================ 1. cliente */
function telaCliente() {
  app.innerHTML = `
    <div class="busca">${ICON.busca}<input class="inp" id="q" placeholder="Código ou nome do cliente" autocomplete="off" enterkeyhint="search"></div>
    <p class="dica">Busque pelo código, nome ou cidade.</p>
    <div class="lista" id="res"></div>`;
  const q = $('#q');
  const buscar = () => {
    const tk = tokens(q.value);
    const res = $('#res');
    if (!tk.length) {
      res.innerHTML = P.cliente ? '' : '<div class="vazio">Digite para buscar entre ' + CLIENTES.length.toLocaleString('pt-BR') + ' clientes.</div>';
      if (P.cliente) res.appendChild(itemCliente(P.cliente, true));
      return;
    }
    const soNum = /^\d+$/.test(q.value.trim());
    let lista = CLIENTES.filter(c => tk.every(t => c.k.includes(t)));
    if (soNum) {
      const v = q.value.trim();
      lista.sort((a, b) => (b.cod === v) - (a.cod === v) || b.cod.startsWith(v) - a.cod.startsWith(v));
    }
    res.innerHTML = lista.length ? '' : '<div class="vazio">Nenhum cliente encontrado.</div>';
    lista.slice(0, 40).forEach(c => res.appendChild(itemCliente(c, P.cliente && P.cliente.cod === c.cod)));
    if (lista.length > 40) res.insertAdjacentHTML('beforeend', `<div class="vazio">+${lista.length - 40} clientes — refine a busca.</div>`);
  };
  q.oninput = debounce(buscar);
  buscar();
  if (!P.cliente) q.focus();
}

function itemCliente(c, sel) {
  const b = document.createElement('button');
  b.className = 'item' + (sel ? ' sel' : '') + (c.sit !== 'Ativo' ? ' apagado' : '');
  const sit = c.sit === 'Ativo' ? '' : `<span class="tag ${c.sit === 'Bloqueado' ? 'vm' : 'am'}">${esc(c.sit)}</span>`;
  b.innerHTML = `<div class="tx"><div class="t1"><span class="cod">${esc(c.cod)}</span> · ${esc(c.nome)}</div>
    <div class="t2">${esc(c.cidade)} · ${esc(c.vend)}</div><div>${sit}<span class="tag">${esc(c.seg)}</span></div></div>${ICON.chev}`;
  b.onclick = () => {
    if (P.cliente && P.cliente.cod !== c.cod) P.fotos = {};
    P.cliente = { cod: c.cod, nome: c.nome, cidade: c.cidade, vendedor: c.vend, segmento: c.seg, situacao: c.sit };
    irPara('mobil');
  };
  return b;
}

/* ============================================================ 2. produto Mobil */
function telaMobil() {
  app.innerHTML = `${contexto(1)}
    <div class="busca">${ICON.busca}<input class="inp" id="q" placeholder="Código ou nome do produto Mobil" autocomplete="off" enterkeyhint="search"></div>
    <p class="dica">Ex.: <i>moto 4t 20w50</i>, <i>delvac 15w40</i> ou o código <i>123073</i>.</p>
    <div class="lista" id="res"></div>`;
  const q = $('#q');
  const buscar = () => {
    const tk = tokens(q.value);
    const res = $('#res');
    if (!tk.length) {
      res.innerHTML = P.mobil ? '' : '<div class="vazio">Digite o nome ou código do produto.</div>';
      if (P.mobil) res.appendChild(itemMobil(MOBIL.find(m => m.key === P.mobil.key), true));
      return;
    }
    const v = q.value.trim().toUpperCase();
    const lista = MOBIL.filter(m => tk.every(t => m.k.includes(t)))
      .sort((a, b) => b.codigos.includes(v) - a.codigos.includes(v) || a.nome.length - b.nome.length);
    res.innerHTML = lista.length ? '' : '<div class="vazio">Nenhum produto encontrado.</div>';
    lista.slice(0, 40).forEach(m => res.appendChild(itemMobil(m, P.mobil && P.mobil.key === m.key)));
  };
  q.oninput = debounce(buscar);
  buscar();
  if (!P.mobil) q.focus();
}

function tagsProduto(p) {
  return `<span class="tag az">${esc(p.s)}</span>${p.v ? `<span class="tag">${esc(p.v)}</span>` : ''}${p.b ? `<span class="tag">${esc(p.b)}</span>` : ''}`;
}

function itemMobil(m, sel) {
  const b = document.createElement('button');
  b.className = 'item' + (sel ? ' sel' : '');
  const cods = m.codigos.slice(0, 4).join(', ') + (m.codigos.length > 4 ? ` +${m.codigos.length - 4}` : '');
  b.innerHTML = `<div class="tx"><div class="t1">${esc(m.nome)}</div>
    <div class="t2">${m.skus.length} embalage${m.skus.length > 1 ? 'ns' : 'm'} · cód. ${esc(cods)}</div><div>${tagsProduto(m)}</div></div>${ICON.chev}`;
  b.onclick = () => {
    if (!P.mobil || P.mobil.key !== m.key) { P.conc = null; }
    P.mobil = { key: m.key, nome: m.nome, codigos: m.codigos, s: m.s, v: m.v, b: m.b, e: m.e };
    irPara('marca');
  };
  return b;
}

/* ============================================================ 3. marca */
function telaMarca() {
  const grupos = [];
  for (const [g, m] of D.marcas) {
    let x = grupos.find(y => y.g === g);
    if (!x) grupos.push(x = { g, marcas: [] });
    x.marcas.push(m);
  }
  app.innerHTML = `${contexto(2)}<p class="dica">Escolha a marca do produto que está na prateleira.</p><div class="marcas" id="mc"></div>`;
  const mc = $('#mc');
  for (const { g, marcas } of grupos) for (const m of marcas) {
    const n = CONC.filter(c => c.m === m && c.s === P.mobil.s).length;
    const b = document.createElement('button');
    b.className = 'marca' + (P.marca === m ? ' on' : '');
    b.innerHTML = `<div><b>${esc(m)}</b><br><small>${esc(g)}</small></div>
      <div class="qt ${n ? '' : 'zero'}">${n ? `${n} em ${esc(P.mobil.s)}` : 'Sem produto no segmento'}</div>`;
    b.onclick = () => { if (P.marca !== m) P.conc = null; P.marca = m; irPara('concorrente'); };
    mc.appendChild(b);
  }
}

/* ============================================================ 4. produto concorrente */
function telaConcorrente() {
  const daMarca = CONC.filter(c => c.m === P.marca).map(c => ({ c, ...similaridade(P.mobil, c) }))
    .sort((a, b) => b.pct - a.pct || a.c.n.localeCompare(b.c.n));
  // sugestões só do mesmo segmento (ou vizinho): óleo de carro nunca aparece como "parecido" com óleo de moto
  const segOk = s => s === P.mobil.s || (SEG_VIZINHOS[P.mobil.s] || []).includes(s);
  const sugest = daMarca.filter(x => x.pct >= 45 && x.c.st !== 'Descontinuado' && segOk(x.c.s)).slice(0, 5);
  const segs = [...new Set(daMarca.map(x => x.c.s))].sort();
  let filtroSeg = segs.includes(P.mobil.s) ? P.mobil.s : '';

  app.innerHTML = `${contexto(3)}
    <div class="sec-t" style="margin-top:4px">Mais parecidos com o Mobil escolhido</div>
    <div class="lista" id="sug"></div>
    <div class="sec-t">Todos os produtos ${esc(P.marca)}</div>
    <div class="busca">${ICON.busca}<input class="inp" id="q" placeholder="Buscar produto ${esc(P.marca)}" autocomplete="off"></div>
    <div class="filtros" id="fs"></div>
    <div class="lista" id="todos"></div>`;

  const sug = $('#sug');
  if (!sugest.length) sug.innerHTML = `<div class="vazio">Nenhum produto ${esc(P.marca)} parecido com este Mobil. Procure na lista abaixo.</div>`;
  sugest.forEach((x, i) => sug.appendChild(cardSugestao(x, i === 0)));

  const desenharFiltros = () => {
    $('#fs').innerHTML = [['', 'Todos'], ...segs.map(s => [s, s])]
      .map(([v, t]) => `<button class="chip ${v === filtroSeg ? 'on' : ''}" data-v="${esc(v)}">${esc(t)}</button>`).join('');
    $('#fs').querySelectorAll('.chip').forEach(b => b.onclick = () => { filtroSeg = b.dataset.v; desenharFiltros(); listar(); });
  };
  const listar = () => {
    const tk = tokens($('#q').value);
    const lista = daMarca.filter(x => (!filtroSeg || tk.length || x.c.s === filtroSeg) && tk.every(t => x.c.k.includes(t)));
    const el = $('#todos');
    el.innerHTML = lista.length ? '' : '<div class="vazio">Nenhum produto encontrado.</div>';
    lista.slice(0, 80).forEach(x => el.appendChild(itemConc(x)));
    if (lista.length > 80) el.insertAdjacentHTML('beforeend', `<div class="vazio">+${lista.length - 80} produtos — refine a busca.</div>`);
  };
  $('#q').oninput = debounce(listar);
  desenharFiltros();
  listar();
}

function escolherConc(x) {
  P.conc = x.c;
  P.similaridade = x.pct;
  if (P.embalagem && !embalagensDe(x.c).includes(P.embalagem)) P.embalagem = null;
  irPara('preco');
}

function statusTag(c) {
  return c.st === 'Incerto' ? '<span class="tag am">A confirmar</span>' : c.st === 'Descontinuado' ? '<span class="tag vm">Descontinuado</span>' : '';
}

function cardSugestao(x, top) {
  const b = document.createElement('button');
  b.className = 'sug' + (top ? ' top' : '') + (P.conc && P.conc.id === x.c.id ? ' on' : '');
  b.innerHTML = `<div class="pct" style="--p:${x.pct}"><span>${x.pct}%</span></div>
    <div class="tx" style="flex:1;min-width:0">${top ? '<div class="melhor">Mais semelhante</div>' : ''}
      <div class="t1" style="font-weight:650">${esc(x.c.n)}</div>
      <div>${x.motivos.map(m => `<span class="tag vd">${esc(m)}</span>`).join('')}${statusTag(x.c)}</div></div>${ICON.chev}`;
  b.onclick = () => escolherConc(x);
  return b;
}

function itemConc(x) {
  const b = document.createElement('button');
  b.className = 'item' + (P.conc && P.conc.id === x.c.id ? ' sel' : '') + (x.c.st === 'Descontinuado' ? ' apagado' : '');
  const antigos = SINONIMOS[x.c.id] ? `<div class="t2">Nome antigo: ${esc(SINONIMOS[x.c.id].join(' · '))}</div>` : '';
  b.innerHTML = `<div class="tx"><div class="t1">${esc(x.c.n)}</div>${antigos}
    <div>${tagsProduto(x.c)}${statusTag(x.c)}</div></div>
    <span class="tag ${x.pct >= 70 ? 'vd' : x.pct >= 45 ? 'az' : ''}" style="flex:none">${x.pct}%</span>`;
  b.onclick = () => escolherConc(x);
  return b;
}

/* ============================================================ 5. preço */
const EMB_PADRAO = ['200mL', '500mL', '1L', '3L', '4L', '5L', '20L', '200L'];
function litros(emb) {
  const m = String(emb).replace(',', '.').match(/([\d.]+)\s*(ml|l|kg|g)\b/i);
  if (!m) return null;
  const v = parseFloat(m[1]);
  return /^ml$|^g$/i.test(m[2]) ? v / 1000 : v;
}
function embalagensDe(c) {
  const proprias = (c.em || []).filter(e => litros(e) && litros(e) <= 1000).map(e => e.replace(/\s+/g, ''));
  return [...new Set([...proprias, ...EMB_PADRAO])].sort((a, b) => litros(a) - litros(b));
}

function telaPreco() {
  const embs = embalagensDe(P.conc);
  const unid = e => /kg|g\b/i.test(e) ? 'kg' : 'L';
  app.innerHTML = `${contexto(4)}
    <div class="sec-t" style="margin-top:4px">Embalagem na prateleira</div>
    <div class="embs" id="embs">${embs.map(e => `<button class="chip ${P.embalagem === e ? 'on' : ''}" data-e="${esc(e)}">${esc(e)}</button>`).join('')}</div>
    <div class="sec-t">Preço de venda</div>
    <div class="preco-box">
      <input class="preco-inp" id="preco" inputmode="numeric" autocomplete="off" value="${P.preco ? brl(P.preco) : 'R$ 0,00'}">
      <small id="porL">&nbsp;</small>
    </div>
    <div class="rodape"><button class="btn" id="seguir" disabled>Continuar para as fotos</button></div>`;
  const inp = $('#preco');
  const atualizar = () => {
    const l = P.embalagem ? litros(P.embalagem) : null;
    $('#porL').textContent = P.preco && l ? `${brl(P.preco / l)} por ${unid(P.embalagem)}` : P.embalagem ? ' ' : 'Escolha a embalagem';
    $('#seguir').disabled = !(P.preco > 0 && P.embalagem);
  };
  $('#embs').querySelectorAll('.chip').forEach(b => b.onclick = () => {
    P.embalagem = b.dataset.e;
    $('#embs').querySelectorAll('.chip').forEach(x => x.classList.toggle('on', x === b));
    atualizar();
  });
  // máscara de moeda: os dígitos entram pela direita (centavos)
  inp.oninput = () => {
    const cent = parseInt(inp.value.replace(/\D/g, '') || '0', 10);
    P.preco = Math.min(cent, 9999999) / 100;
    inp.value = brl(P.preco);
    atualizar();
  };
  inp.onfocus = () => setTimeout(() => inp.setSelectionRange(inp.value.length, inp.value.length), 0);
  $('#seguir').onclick = () => irPara('fotos');
  atualizar();
}

/* ============================================================ 6. fotos (somente câmera) */
const FOTOS = [['produto', 'Foto do produto', 'Frente da embalagem com o nome'], ['etiqueta', 'Foto da etiqueta', 'Etiqueta de preço da prateleira']];

function telaFotos() {
  app.innerHTML = `${contexto(4)}
    <p class="dica">As fotos são tiradas na hora pela câmera do app e recebem data, hora e código do cliente.</p>
    <div class="fotos" id="fts"></div>
    <div class="rodape"><button class="btn" id="seguir">Revisar pesquisa</button></div>`;
  const fts = $('#fts');
  for (const [k, titulo, dica] of FOTOS) {
    const b = document.createElement('button');
    const blob = P.fotos[k];
    b.className = 'foto' + (blob ? ' ok' : '');
    b.innerHTML = blob
      ? `<img src="${URL.createObjectURL(blob)}" alt="${titulo}"><span class="ok-ico">${ICON.ok}</span><span class="refazer">Tirar de novo</span>`
      : `${ICON.cam}<span>${titulo}</span><small style="font-weight:500;font-size:12px">${dica}</small>`;
    b.onclick = async () => {
      const foto = await abrirCamera(titulo);
      if (foto) { P.fotos[k] = foto; telaFotos(); }
    };
    fts.appendChild(b);
  }
  const ok = FOTOS.every(([k]) => P.fotos[k]);
  $('#seguir').disabled = !ok;
  $('#seguir').onclick = () => irPara('revisao');
}

let stream = null, resolverCamera = null;

async function abrirCamera(titulo) {
  $('#camTitulo').textContent = titulo;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false,
    });
  } catch (err) {
    if (DEMO) return fotoDemo(titulo);
    mostrarModal(`<h3>Câmera indisponível</h3>
      <p style="font-size:14px;line-height:1.5;color:var(--muted)">Permita o acesso à câmera para este app nas configurações do navegador e tente de novo.
      As fotos só podem ser feitas pela câmera, não é possível enviar da galeria.</p>
      <p class="dica" style="margin-top:10px">Detalhe: ${esc(err.name || err.message)}</p>
      <div class="acoes"><button class="btn" onclick="fecharModal()">Entendi</button></div>`);
    return null;
  }
  const v = $('#camVideo');
  v.srcObject = stream;
  $('#camera').hidden = false;
  return new Promise(res => (resolverCamera = res));
}

function fecharCamera(foto = null) {
  if (stream) stream.getTracks().forEach(t => t.stop());
  stream = null;
  $('#camera').hidden = true;
  $('#camVideo').srcObject = null;
  if (resolverCamera) { resolverCamera(foto); resolverCamera = null; }
}

$('#camCancelar').onclick = () => fecharCamera(null);
$('#camDisparo').onclick = async () => {
  const v = $('#camVideo');
  if (!v.videoWidth) return;
  const foto = await carimbar(v, v.videoWidth, v.videoHeight);
  fecharCamera(foto);
};

// Reduz para no máx. 1600px e grava data/hora + cliente + usuário na própria imagem
function carimbar(fonte, w, h) {
  const esc_ = Math.min(1, 1600 / Math.max(w, h));
  const cv = document.createElement('canvas');
  cv.width = Math.round(w * esc_); cv.height = Math.round(h * esc_);
  const g = cv.getContext('2d');
  g.drawImage(fonte, 0, 0, cv.width, cv.height);
  const fs = Math.max(14, Math.round(cv.width / 42));
  const txt = `${new Date().toLocaleString('pt-BR')} · Cliente ${P.cliente.cod} · ${sessao.email}`;
  g.fillStyle = 'rgba(0,0,0,.55)';
  g.fillRect(0, cv.height - fs * 1.9, cv.width, fs * 1.9);
  g.fillStyle = '#fff';
  g.font = `600 ${fs}px sans-serif`;
  g.fillText(txt, fs * .6, cv.height - fs * .65, cv.width - fs * 1.2);
  return new Promise(res => cv.toBlob(res, 'image/jpeg', .78));
}

function fotoDemo(titulo) {
  const cv = document.createElement('canvas');
  cv.width = 900; cv.height = 1200;
  const g = cv.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 900, 1200);
  gr.addColorStop(0, '#5b7ea3'); gr.addColorStop(1, '#1d3a57');
  g.fillStyle = gr; g.fillRect(0, 0, 900, 1200);
  g.fillStyle = '#fff'; g.font = '700 54px sans-serif'; g.textAlign = 'center';
  g.fillText('FOTO DE TESTE', 450, 520);
  g.font = '500 36px sans-serif';
  g.fillText(titulo, 450, 590);
  g.fillText(P.conc ? P.conc.n.slice(0, 34) : '', 450, 650);
  g.textAlign = 'left';
  return carimbar(cv, 900, 1200);
}

/* ============================================================ 7. revisão */
function telaRevisao() {
  const l = litros(P.embalagem);
  app.innerHTML = `
    <div class="card"><div class="rev">
      <div class="l"><b>Cliente</b><span>${esc(P.cliente.cod)} · ${esc(P.cliente.nome)}<br><small style="color:var(--muted)">${esc(P.cliente.cidade)}</small></span></div>
      <div class="l"><b>Produto Mobil</b><span>${esc(P.mobil.nome)}</span></div>
      <div class="l"><b>Concorrente</b><span>${esc(P.conc.n)}<br><small style="color:var(--muted)">${esc(P.conc.g)} · semelhança ${P.similaridade}%</small></span></div>
      <div class="l"><b>Embalagem</b><span>${esc(P.embalagem)}</span></div>
      <div class="l"><b>Preço</b><span><span class="preco">${brl(P.preco)}</span>${l ? `<br><small style="color:var(--muted)">${brl(P.preco / l)} por ${/kg|g\b/i.test(P.embalagem) ? 'kg' : 'L'}</small>` : ''}</span></div>
    </div>
    <div class="mini-fotos">${FOTOS.map(([k, t]) => `<figure><img src="${URL.createObjectURL(P.fotos[k])}" alt="${t}"><figcaption>${t}</figcaption></figure>`).join('')}</div>
    </div>
    <label class="campo" style="margin-top:14px"><span>Observação (opcional)</span>
      <textarea class="inp" id="obs" maxlength="300" placeholder="Ex.: preço promocional, leve 3 pague 2…">${esc(P.obs || '')}</textarea></label>
    <div class="rodape"><button class="btn verde" id="fim">${ICON.ok} Finalizar pesquisa</button></div>`;
  $('#obs').oninput = e => (P.obs = e.target.value);
  $('#fim').onclick = finalizar;
}

async function finalizar() {
  const b = $('#fim');
  b.disabled = true;
  const l = litros(P.embalagem);
  const reg = {
    id: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()),
    data: new Date().toISOString(),
    usuario: sessao.email,
    cliente: P.cliente,
    mobil: { nome: P.mobil.nome, codigos: P.mobil.codigos, segmento: P.mobil.s, viscosidade: P.mobil.v },
    conc: { id: P.conc.id, nome: P.conc.n, marca: P.conc.m, grupo: P.conc.g, segmento: P.conc.s, viscosidade: P.conc.v },
    similaridade: P.similaridade,
    embalagem: P.embalagem,
    preco: P.preco,
    precoUnidade: l ? Math.round(P.preco / l * 100) / 100 : null,
    unidade: /kg|g\b/i.test(P.embalagem) ? 'kg' : 'L',
    obs: (P.obs || '').trim(),
    fotos: { ...P.fotos },
  };
  try {
    await DB.salvar(reg);
    irPara('sucesso');
  } catch (e) {
    b.disabled = false;
    toast('Não foi possível salvar: ' + (e.message || e));
  }
}

function telaSucesso() {
  app.innerHTML = `<div class="sucesso">
      <div class="ck">${ICON.okG}</div>
      <h2>Pesquisa registrada</h2>
      <p>${esc(P.conc.n)} · ${brl(P.preco)}<br>${esc(P.cliente.nome)}</p>
      <button class="btn" id="mesmo">Nova pesquisa neste cliente</button>
      <div style="height:10px"></div>
      <button class="btn sec" id="ini">Voltar ao início</button>
    </div>`;
  $('#mesmo').onclick = () => { P = { cliente: P.cliente, fotos: {} }; irPara('mobil'); };
  $('#ini').onclick = () => { P = null; irPara('inicio'); };
}

/* ============================================================ histórico */
const H = { aba: 'lista', cliente: '', cidade: '', mobil: '', marca: '', periodo: '', agrupar: 'conc', q: '' };

async function telaHistorico() {
  const todas = (await DB.todas()).sort((a, b) => b.data.localeCompare(a.data));
  const opc = (campo, rot) => {
    const vals = [...new Set(todas.map(campo))].filter(Boolean).sort((a, b) => a.localeCompare(b));
    return `<option value="">${rot}</option>` + vals.map(v => `<option>${esc(v)}</option>`).join('');
  };
  app.innerHTML = `
    <div class="abas"><button data-a="lista">Pesquisas</button><button data-a="resumo">Resumo de preços</button></div>
    <div class="busca">${ICON.busca}<input class="inp" id="hq" placeholder="Buscar cliente, produto, marca…" value="${esc(H.q)}"></div>
    <div class="fgrid">
      <select class="fsel" id="fCli">${opc(p => `${p.cliente.cod} · ${p.cliente.nome}`, 'Todos os clientes')}</select>
      <select class="fsel" id="fCid">${opc(p => p.cliente.cidade, 'Todas as cidades')}</select>
      <select class="fsel" id="fMob">${opc(p => p.mobil.nome, 'Todos os Mobil')}</select>
      <select class="fsel" id="fMar">${opc(p => p.conc.marca, 'Todas as marcas')}</select>
      <select class="fsel" id="fPer"><option value="">Todo o período</option><option value="7">Últimos 7 dias</option><option value="30">Últimos 30 dias</option><option value="90">Últimos 90 dias</option></select>
      <select class="fsel" id="fAgr" ${H.aba === 'lista' ? 'hidden' : ''}>
        <option value="conc">Agrupar: produto concorrente</option><option value="mobil">Agrupar: produto Mobil</option>
        <option value="marca">Agrupar: marca</option><option value="cliente">Agrupar: cliente</option><option value="cidade">Agrupar: cidade</option></select>
    </div>
    <div id="hres"></div>
    <div class="acoes"><button class="btn sec" id="bCsv">Exportar planilha (CSV)</button></div>`;

  const sels = { fCli: 'cliente', fCid: 'cidade', fMob: 'mobil', fMar: 'marca', fPer: 'periodo', fAgr: 'agrupar' };
  for (const [id, k] of Object.entries(sels)) {
    const el = $('#' + id); el.value = H[k];
    el.onchange = () => { H[k] = el.value; desenhar(); };
  }
  document.querySelectorAll('.abas button').forEach(b => {
    b.classList.toggle('on', b.dataset.a === H.aba);
    b.onclick = () => { H.aba = b.dataset.a; telaHistorico(); };
  });
  $('#hq').oninput = debounce(() => { H.q = $('#hq').value; desenhar(); });

  const filtrar = () => {
    const tk = tokens(H.q);
    const lim = H.periodo ? Date.now() - +H.periodo * 864e5 : 0;
    return todas.filter(p =>
      (!H.cliente || `${p.cliente.cod} · ${p.cliente.nome}` === H.cliente) &&
      (!H.cidade || p.cliente.cidade === H.cidade) &&
      (!H.mobil || p.mobil.nome === H.mobil) &&
      (!H.marca || p.conc.marca === H.marca) &&
      (!lim || new Date(p.data) >= lim) &&
      (!tk.length || tk.every(t => compact(`${p.cliente.cod} ${p.cliente.nome} ${p.cliente.cidade} ${p.mobil.nome} ${p.conc.nome} ${p.conc.marca}`).includes(t))));
  };

  const desenhar = () => {
    const lista = filtrar();
    const el = $('#hres');
    if (!lista.length) { el.innerHTML = `<div class="vazio">${todas.length ? 'Nenhuma pesquisa com esses filtros.' : 'Nenhuma pesquisa registrada ainda.'}</div>`; return; }
    if (H.aba === 'lista') {
      el.innerHTML = `<p class="dica">${lista.length} pesquisa${lista.length > 1 ? 's' : ''}</p><div class="lista" id="hl"></div>`;
      lista.forEach(p => $('#hl').appendChild(itemHistorico(p)));
    } else {
      el.innerHTML = tabelaResumo(lista);
    }
  };
  $('#bCsv').onclick = () => exportarCsv(filtrar());
  desenhar();
}

function itemHistorico(p) {
  const b = document.createElement('button');
  b.className = 'item hist-item';
  const img = document.createElement('img');
  img.className = 'th';
  if (p.fotos && p.fotos.etiqueta) img.src = URL.createObjectURL(p.fotos.etiqueta);
  b.appendChild(img);
  b.insertAdjacentHTML('beforeend', `<div class="tx"><div class="t1">${esc(p.conc.nome)}</div>
    <div class="t2">${esc(p.cliente.cod)} · ${esc(p.cliente.nome)} · ${esc(p.cliente.cidade)}</div>
    <div class="t2">vs ${esc(p.mobil.nome)} · ${dataHora(p.data)}</div></div>
    <div class="pr">${brl(p.preco)}<small>${esc(p.embalagem)}</small></div>`);
  b.onclick = () => detalhe(p);
  return b;
}

function tabelaResumo(lista) {
  const chave = { conc: p => p.conc.nome, mobil: p => p.mobil.nome, marca: p => p.conc.marca, cliente: p => `${p.cliente.cod} · ${p.cliente.nome}`, cidade: p => p.cliente.cidade }[H.agrupar];
  const g = new Map();
  for (const p of lista) {
    const k = chave(p);
    if (!g.has(k)) g.set(k, []);
    g.get(k).push(p);
  }
  const linhas = [...g.entries()].map(([k, ps]) => {
    const v = ps.map(p => p.precoUnidade ?? p.preco);
    return { k, n: ps.length, med: v.reduce((a, b) => a + b, 0) / v.length, min: Math.min(...v), max: Math.max(...v), ult: ps[0].data };
  }).sort((a, b) => b.n - a.n || a.k.localeCompare(b.k));
  return `<p class="dica">Valores por litro (ou kg) para comparar embalagens diferentes.</p>
  <table class="res"><thead><tr><th>${{ conc: 'Produto concorrente', mobil: 'Produto Mobil', marca: 'Marca', cliente: 'Cliente', cidade: 'Cidade' }[H.agrupar]}</th>
    <th>Qtd</th><th>Médio</th><th>Mín</th><th>Máx</th></tr></thead><tbody>
    ${linhas.map(l => `<tr><td>${esc(l.k)}<br><small style="color:var(--muted);font-weight:500">última ${dataHora(l.ult)}</small></td>
      <td>${l.n}</td><td><b>${brl(l.med)}</b></td><td>${brl(l.min)}</td><td>${brl(l.max)}</td></tr>`).join('')}
  </tbody></table>`;
}

function detalhe(p) {
  const fotos = FOTOS.filter(([k]) => p.fotos && p.fotos[k])
    .map(([k, t]) => `<p class="dica" style="margin:12px 0 0">${t}</p><img class="full" src="${URL.createObjectURL(p.fotos[k])}" alt="${t}">`).join('');
  mostrarModal(`<h3>${esc(p.conc.nome)}</h3>
    <div class="card"><div class="rev">
      <div class="l"><b>Data</b><span>${dataHora(p.data)}</span></div>
      <div class="l"><b>Cliente</b><span>${esc(p.cliente.cod)} · ${esc(p.cliente.nome)}<br><small style="color:var(--muted)">${esc(p.cliente.cidade)}</small></span></div>
      <div class="l"><b>Produto Mobil</b><span>${esc(p.mobil.nome)}</span></div>
      <div class="l"><b>Marca</b><span>${esc(p.conc.marca)} (${esc(p.conc.grupo)})</span></div>
      <div class="l"><b>Preço</b><span><span class="preco">${brl(p.preco)}</span> · ${esc(p.embalagem)}${p.precoUnidade ? `<br><small style="color:var(--muted)">${brl(p.precoUnidade)} por ${p.unidade}</small>` : ''}</span></div>
      ${p.obs ? `<div class="l"><b>Obs.</b><span>${esc(p.obs)}</span></div>` : ''}
      <div class="l"><b>Registrado por</b><span>${esc(p.usuario)}</span></div>
    </div></div>
    ${fotos}
    <div class="acoes"><button class="btn sec" id="mFechar">Fechar</button><button class="btn sec" id="mExcluir" style="color:var(--red)">Excluir</button></div>`);
  $('#mFechar').onclick = fecharModal;
  $('#mExcluir').onclick = async () => {
    if (!confirm('Excluir esta pesquisa? Não dá para desfazer.')) return;
    await DB.excluir(p.id);
    fecharModal();
    toast('Pesquisa excluída');
    irPara(tela);
  };
}

function exportarCsv(lista) {
  if (!lista.length) return toast('Nada para exportar');
  const cab = ['Data', 'Usuario', 'Cod_Cliente', 'Cliente', 'Cidade', 'Vendedor_Carteira', 'Segmento_Cliente',
    'Produto_Mobil', 'Codigos_Mobil', 'ID_Concorrente', 'Produto_Concorrente', 'Marca', 'Grupo', 'Similaridade',
    'Embalagem', 'Preco', 'Preco_por_L_kg', 'Observacao'];
  const num = v => v == null ? '' : String(v).replace('.', ',');
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const linhas = lista.map(p => [dataHora(p.data), p.usuario, p.cliente.cod, p.cliente.nome, p.cliente.cidade, p.cliente.vendedor,
    p.cliente.segmento, p.mobil.nome, p.mobil.codigos.join(' '), p.conc.id, p.conc.nome, p.conc.marca, p.conc.grupo,
    p.similaridade, p.embalagem, num(p.preco), num(p.precoUnidade), p.obs].map(q).join(';'));
  const blob = new Blob(['﻿' + [cab.join(';'), ...linhas].join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `pesquisas_preco_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
}

/* ============================================================ modal */
function mostrarModal(html) {
  $('#modalBox').innerHTML = html;
  $('#modal').hidden = false;
}
function fecharModal() { $('#modal').hidden = true; $('#modalBox').innerHTML = ''; }
$('#modal').onclick = e => { if (e.target.id === 'modal') fecharModal(); };
window.fecharModal = fecharModal;

/* ============================================================ início do app */
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');
irPara(sessao ? 'inicio' : 'login');
