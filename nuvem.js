'use strict';
/* Conexão com o banco do Fabric (API for GraphQL) e com o SharePoint (fotos),
 * sempre com o token Microsoft do próprio vendedor (MSAL, SPA com PKCE, sem segredo no app).
 * Referência: "Guia do banco - para a IA do app Pesquisa de Preço.md" (13/10/2026).
 *   - A API responde HTTP 200 mesmo com erro: sempre olhar errors[].
 *   - createPesquisaPreco SEM variables (quebra no padrão de Anulada/RecebidoEm): objeto montado na mutation.
 *   - UsuarioEmail, Anulada e RecebidoEm o banco preenche. Não existe DELETE: "Excluir" = Anulada: true. */

const Nuvem = (() => {
  const CFG = window.CONFIG;
  if (CFG.MODO_TESTE) return modoTeste();
  const SP = CFG.SHAREPOINT || {};
  const configurado = !!(CFG.CLIENT_ID && CFG.TENANT_ID && window.msal);
  const fotosConfiguradas = !!(CFG.FOTOS_NUVEM && SP.driveId && SP.pastaId);
  const redirectUri = location.origin + location.pathname.replace(/index\.html$/, '');
  let app = null, conta = null;

  async function iniciar() {
    if (!configurado) return null;
    app = new msal.PublicClientApplication({
      auth: { clientId: CFG.CLIENT_ID, authority: `https://login.microsoftonline.com/${CFG.TENANT_ID}`, redirectUri },
      cache: { cacheLocation: 'localStorage' },
    });
    await app.initialize();
    const r = await app.handleRedirectPromise();
    // só contas @westbrasil.com.br do tenant da West; convidados externos e outras contas são recusados
    const contas = [(r && r.account), ...app.getAllAccounts()].filter(Boolean);
    const recusada = contas.find(c => !contaPermitida(c));
    conta = contas.find(contaPermitida) || null;
    if (recusada && !conta) {
      await app.clearCache({ account: recusada }).catch(() => {});
      throw new Error(`a conta ${recusada.username} não é da West Brasil. Entre com o seu e-mail @${CFG.DOMINIO_PERMITIDO}.`);
    }
    if (conta) app.setActiveAccount(conta);
    return conta;
  }

  function contaPermitida(c) {
    const email = String(c.username || '').toLowerCase();
    return email.endsWith('@' + CFG.DOMINIO_PERMITIDO.toLowerCase()) && c.tenantId === CFG.TENANT_ID;
  }

  const entrar = () => app.loginRedirect({
    scopes: CFG.ESCOPO_API, prompt: 'select_account', extraQueryParameters: { domain_hint: CFG.DOMINIO_PERMITIDO },
  });
  const sair = () => app.logoutRedirect({ account: conta, postLogoutRedirectUri: redirectUri });

  async function token(escopos, interativo = true) {
    try {
      return (await app.acquireTokenSilent({ scopes: escopos, account: conta })).accessToken;
    } catch (e) {
      // fotos: nunca tira o vendedor da tela no meio do envio; o erro fica registrado e tenta de novo depois
      if (!interativo) throw new Error('sem autorização para enviar fotos (' + (e.errorCode || e.message) + ')');
      if (e instanceof msal.InteractionRequiredAuthError) await app.acquireTokenRedirect({ scopes: escopos, account: conta });
      throw e;
    }
  }

  async function gql(query, variables) {
    const t = await token(CFG.ESCOPO_API);
    const r = await fetch(CFG.GRAPHQL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
      body: JSON.stringify(variables ? { query, variables } : { query }),
    });
    if (!r.ok) {
      // o corpo do erro do Fabric diz o motivo (ex.: sem permissão na API): mostra para o BI diagnosticar
      let motivo = '';
      try {
        const t = await r.text();
        try { const j = JSON.parse(t); motivo = [j.errorCode || j.code, j.message || (j.error && j.error.message)].filter(Boolean).join(': '); }
        catch { motivo = t; }
      } catch { /* sem corpo */ }
      throw new Error(`API do banco: HTTP ${r.status}${motivo ? ' (' + String(motivo).slice(0, 180) + ')' : ''}`);
    }
    const d = await r.json();
    if (d.errors && d.errors.length) throw new Error(d.errors.map(e => e.message).join(' | '));
    return d.data;
  }

  // { Campo: valor } como literal GraphQL; ignora vazio/null. JSON.stringify gera string GraphQL válida.
  const gqlObj = o => '{ ' + Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? JSON.stringify(v) : v}`)
    .join(', ') + ' }';

  /* ---------- clientes (RLS: só o escopo de quem entrou) */
  async function carregarClientes(progresso) {
    const q = `query ($n: Int, $depois: String) {
      clientes(first: $n, after: $depois, orderBy: { Nome: ASC }) {
        items { ClienteKey Codigo Nome Cidade UF Segmento Situacao Vendedor }
        hasNextPage endCursor } }`;
    const lista = [];
    let depois = null;
    do {
      const d = await gql(q, { n: 5000, depois });
      lista.push(...d.clientes.items);
      if (progresso) progresso(lista.length);
      depois = d.clientes.hasNextPage ? d.clientes.endCursor : null;
    } while (depois);
    return lista;
  }

  /* ---------- pesquisas */
  async function enviarPesquisa(reg) {
    const f = reg.fotosUrl || {};
    const item = {
      Id: reg.id, DataHora: reg.data,
      ClienteKey: reg.cliente.key, CodCliente: reg.cliente.cod, ClienteNome: reg.cliente.nome,
      Cidade: reg.cliente.cidade, VendedorCarteira: reg.cliente.vendedor,
      SegmentoCliente: reg.cliente.segmento, SituacaoCliente: reg.cliente.situacao,
      ProdutoMobil: reg.mobil.nome, CodigosMobil: reg.mobil.codigos.join(' '),
      SegmentoMobil: reg.mobil.segmento, ViscosidadeMobil: reg.mobil.viscosidade,
      IdConcorrente: reg.conc.id, ProdutoConcorrente: reg.conc.nome, Marca: reg.conc.marca, Grupo: reg.conc.grupo,
      Similaridade: reg.similaridade, Embalagem: reg.embalagem, Preco: reg.preco,
      PrecoPorUnidade: reg.precoUnidade, Unidade: reg.unidade, Observacao: (reg.obs || '').trim(), ...camposSemFoto(reg),
      ...(CFG.COLUNA_ARQUIVOS && reg.anexosUrl ? { ArquivosUrl: reg.anexosUrl.join(' | ') } : {}),
      FotoProdutoUrl: f.produto, FotoEtiquetaUrl: f.etiqueta, VersaoApp: reg.versao || CFG.VERSAO,
    };
    try {
      await gql(`mutation { createPesquisaPreco(item: ${gqlObj(item)}) { Id RecebidoEm } }`);
      return 'gravado';
    } catch (e) {
      if (/duplicate key/i.test(e.message)) return 'ja_recebido'; // reenvio do mesmo Id = sucesso
      throw e;
    }
  }

  /* "Sem foto": colunas próprias no banco desde 26/10/2026 (SemFoto bit, ResponsavelInformacao nvarchar 150,
   * ContatoResponsavel nvarchar 100). A Observacao volta a ter só o texto do vendedor. */
  const camposSemFoto = reg => reg.semFoto
    ? { SemFoto: true, ResponsavelInformacao: (reg.responsavel || '').slice(0, 150), ContatoResponsavel: (reg.contatoResponsavel || '').slice(0, 100) }
    : { SemFoto: false };

  // nulos: colunas a esvaziar (ex.: ['Observacao']); o gqlObj ignora vazio/null, então vão à parte
  const atualizarPesquisa = (id, campos, nulos = []) => {
    const partes = gqlObj(campos).slice(2, -2).trim();
    const obj = '{ ' + [partes, ...nulos.map(c => `${c}: null`)].filter(Boolean).join(', ') + ' }';
    return gql(`mutation { updatePesquisaPreco(Id: ${JSON.stringify(id)}, item: ${obj}) { Id } }`);
  };

  const anular = id => gql(`mutation { updatePesquisaPreco(Id: ${JSON.stringify(id)}, item: { Anulada: true }) { Id Anulada } }`);

  async function historico(max = 1000) {
    const campos = `Id DataHora UsuarioEmail ClienteKey CodCliente ClienteNome Cidade VendedorCarteira SegmentoCliente
      ProdutoMobil CodigosMobil IdConcorrente ProdutoConcorrente Marca Grupo Similaridade
      Embalagem Preco PrecoPorUnidade Unidade Observacao FotoProdutoUrl FotoEtiquetaUrl
      SemFoto ResponsavelInformacao ContatoResponsavel${CFG.COLUNA_ARQUIVOS ? ' ArquivosUrl' : ''}`;
    const lista = [];
    let depois = null;
    do {
      const d = await gql(`query ($depois: String) {
        pesquisaPrecos(first: 200, after: $depois, filter: { Anulada: { eq: false } }, orderBy: { DataHora: DESC }) {
          items { ${campos} } hasNextPage endCursor } }`, { depois });
      lista.push(...d.pesquisaPrecos.items);
      depois = d.pesquisaPrecos.hasNextPage && lista.length < max ? d.pesquisaPrecos.endCursor : null;
    } while (depois);
    return lista;
  }

  /* ---------- fotos no SharePoint (Microsoft Graph)
   * O app só tem permissão na pasta "Pesquisa de Preço - Fotos" (driveId + pastaId no config.js), por isso grava
   * pelo caminho relativo a ela: /drives/{driveId}/items/{pastaId}:/{subpastas}/{arquivo}:/content.
   * As subpastas (mês/cliente) são criadas pelo próprio SharePoint no envio. */
  async function subirFoto(blob, caminho, tipo = 'image/jpeg') {
    const url = `https://graph.microsoft.com/v1.0/drives/${SP.driveId}/items/${SP.pastaId}:/${caminho.split('/').map(encodeURIComponent).join('/')}:/content`;
    const r = await fetch(url, {
      method: 'PUT',
      headers: { Authorization: 'Bearer ' + await token(CFG.ESCOPO_FOTOS, false), 'Content-Type': tipo },
      body: blob,
    });
    if (!r.ok) {
      let motivo = '';
      try { const j = await r.json(); motivo = (j.error && (j.error.code + ': ' + j.error.message)) || ''; } catch { /* sem corpo */ }
      throw new Error(`SharePoint: falha ao enviar foto (HTTP ${r.status}${motivo ? ' ' + motivo.slice(0, 160) : ''})`);
    }
    return (await r.json()).webUrl;
  }

  // Tela de diagnóstico (?diag=1): dados do token (sem o token) e a resposta crua da API nos dois endereços
  async function diagnostico() {
    const out = { versao: CFG.VERSAO, conta: conta && conta.username, tenantDaConta: conta && conta.tenantId };
    let t;
    try {
      t = (await app.acquireTokenSilent({ scopes: CFG.ESCOPO_API, account: conta })).accessToken;
      const b = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const p = JSON.parse(decodeURIComponent(escape(atob(b + '='.repeat((4 - b.length % 4) % 4)))));
      Object.assign(out, { aud: p.aud, scp: p.scp, tid: p.tid, upn: p.upn || p.unique_name || p.preferred_username,
        appid: p.appid || p.azp, validoAte: new Date(p.exp * 1000).toLocaleString('pt-BR') });
    } catch (e) { out.erroToken = e.message; return out; }
    const url2 = CFG.GRAPHQL_URL.replace('https://api.fabric.microsoft.com/v1/workspaces/c20fb156-4b2c-4186-b729-eda76f5da581',
      'https://c20fb1564b2c4186b729eda76f5da581.zc2.graphql.fabric.microsoft.com/v1/workspaces/c20fb156-4b2c-4186-b729-eda76f5da581');
    for (const [nome, url] of [['api.fabric', CFG.GRAPHQL_URL], ['regional', url2]]) {
      try {
        const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t },
          body: JSON.stringify({ query: '{ clientes(first: 1) { items { Codigo } } }' }) });
        out[nome] = `HTTP ${r.status} ${(await r.text()).slice(0, 400) || '(sem corpo)'}`;
      } catch (e) { out[nome] = 'falhou: ' + e.message; }
    }
    return out;
  }

  return {
    diagnostico, lerObservacao, camposSemFoto,
    configurado, fotosConfiguradas, iniciar, entrar, sair,
    get conta() { return conta; },
    carregarClientes, enviarPesquisa, atualizarPesquisa, anular, historico, subirFoto,
  };
})();

/* Modo teste (só no link pesquisa_precos_teste): sem login Microsoft, clientes fictícios, nada vai ao banco.
 * Serve para testar telas, câmera e sugestões enquanto a TI não passa o Client ID. */
function modoTeste() {
  const CHAVE = 'pp_modo_teste';
  const conta = () => (localStorage.getItem(CHAVE) ? { username: 'modo.teste@westbrasil.com.br', name: 'Vendedor Teste' } : null);
  const cli = (cod, nome, cidade, seg, sit) => ({ ClienteKey: 'TESTE' + cod, Codigo: cod, Nome: nome, Cidade: cidade, UF: 'SP', Segmento: seg, Situacao: sit, Vendedor: 'VENDEDOR TESTE' });
  const CLIENTES_TESTE = [
    cli('90001', 'CLIENTE TESTE MOTOPEÇAS', 'CAMPINAS', '509-OFICINAS/MOTOPEÇAS', 'Ativo'),
    cli('90002', 'CLIENTE TESTE AUTO PEÇAS', 'LIMEIRA', '506-AUTOPEÇAS', 'Ativo'),
    cli('90003', 'CLIENTE TESTE POSTO', 'PIRACICABA', '501-POSTOS', 'Ativo'),
    cli('90004', 'CLIENTE TESTE TRANSPORTADORA', 'AMERICANA', '603-FROTISTAS', 'Bloqueado'),
    cli('90005', 'CLIENTE TESTE INDÚSTRIA', 'SUMARÉ', '701-INDÚSTRIA', 'Inativo'),
  ];
  const semBanco = async () => { throw new Error('modo teste: nada é enviado ao banco'); };
  return {
    teste: true, configurado: true, fotosConfiguradas: false,
    iniciar: async () => conta(),
    entrar: async () => { localStorage.setItem(CHAVE, '1'); location.reload(); },
    sair: () => { localStorage.removeItem(CHAVE); location.reload(); },
    get conta() { return conta(); },
    carregarClientes: async progresso => { if (progresso) progresso(CLIENTES_TESTE.length); return CLIENTES_TESTE; },
    enviarPesquisa: semBanco, atualizarPesquisa: semBanco, anular: semBanco, subirFoto: semBanco,
    historico: async () => [],
    lerObservacao,
  };
}

// Pesquisas gravadas no formato provisório de 26/10/2026 (antes das colunas SemFoto/Responsavel/Contato):
// separa o "sem foto" que ficou dentro da Observacao
function lerObservacao(texto) {
  const t = String(texto || '');
  const m = t.match(/^\[SEM FOTO\] Responsável: (.*?) \| Contato: (.*?)(?: \| Obs: ([\s\S]*))?$/);
  return m ? { semFoto: true, responsavel: m[1], contatoResponsavel: m[2], obs: m[3] || '' } : { obs: t };
}
