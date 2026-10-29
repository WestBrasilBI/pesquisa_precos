/* Configuração da conexão do app com o Fabric e o SharePoint.
 * App registrado no Microsoft Entra ID pela TI em 15/10/2026: "West Brasil - Pesquisa de Preços"
 * (SPA, somente a organização, redirect https://westbrasilbi.github.io/pesquisa_precos/).
 * Permissões delegadas aprovadas: Power BI Service → GraphQLApi.Execute.All, Microsoft Graph → User.Read e
 * Microsoft Graph → Files.SelectedOperations.Selected (write só na pasta das fotos, 21/10/2026). */
window.CONFIG = {
  VERSAO: '2026.10.29d',

  TENANT_ID: '1516fbda-e5c5-429f-8c31-bf8dc4dedc55',   // WEST
  CLIENT_ID: '7b109c34-9e32-47c8-970d-4f03ed0c0d08',   // West Brasil - Pesquisa de Preços
  // Só entra conta com este domínio (e do tenant acima). Convidados externos e contas @...onmicrosoft.com são recusados.
  DOMINIO_PERMITIDO: 'westbrasil.com.br',

  // API for GraphQL "api_pesquisa_preco" (banco sqldb_west_coleta_preco, workspace Banco Fabric - B.I)
  GRAPHQL_URL: 'https://api.fabric.microsoft.com/v1/workspaces/c20fb156-4b2c-4186-b729-eda76f5da581/graphqlapis/7cfcfbde-396a-473e-ac8c-a54b8fdda2f3/graphql',
  ESCOPO_API: ['https://analysis.windows.net/powerbi/api/GraphQLApi.Execute.All'],

  // FOTOS NO SHAREPOINT — LIGADO em 21/10/2026.
  // A TI concedeu ao app "write" SÓ na pasta abaixo (Files.SelectedOperations.Selected, delegada; 201 Created no Graph).
  // O acesso real é a interseção do app (só essa pasta) com o usuário. Files.ReadWrite.All foi recusada pela TI.
  // Pasta: RepositorioBI / Documentos Compartilhados / ArquivosBI / Base Excel / Rafa / PESQUISA DE PREÇO / Pesquisa de Preço - Fotos
  FOTOS_NUVEM: true,
  ESCOPO_FOTOS: ['https://graph.microsoft.com/Files.SelectedOperations.Selected'],
  SHAREPOINT: {
    driveId: 'b!KvJ0PdsG8EC3xtmOqBH21Wsrj4dStQFEjpulHIn_9VtItG2HDsWuTIsP3EX_haAF', // biblioteca Documentos Compartilhados
    pastaId: '01GM3U576V4CDLQFKQTBC2HT6A64TMN2CV',                                 // pasta Pesquisa de Preço - Fotos
  },

  // Arquivos anexados (PDF, foto da galeria, documento) sobem na mesma pasta das fotos e o link vai na coluna
  // ArquivosUrl (até 2000 caracteres, links separados por " | "), criada e liberada na API pelo Steven em 29/10/2026.
  COLUNA_ARQUIVOS: true,

  // Tipo do preço (Custo / Preço de venda), escolhido na etapa do preço. Coluna TipoPreco criada e liberada
  // pelo Steven em 29/10/2026: só aceita "Custo" ou "Venda" (padrão "Venda"). A Observacao leva só o texto do vendedor.
  COLUNA_TIPO_PRECO: true,

  // Lista de clientes guardada no celular: recarrega do banco depois deste tempo (horas)
  CLIENTES_VALIDADE_H: 12,
  // Trocar este valor faz TODOS os celulares buscarem a lista de clientes de novo ao abrir o app
  // (ex.: depois de mudança de acessos no banco ou de nova cópia da camada ouro)
  CLIENTES_RODADA: '2026-10-22',
};
