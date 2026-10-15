/* Configuração da conexão do app com o Fabric e o SharePoint.
 * App registrado no Microsoft Entra ID pela TI em 15/10/2026: "West Brasil - Pesquisa de Preços"
 * (SPA, somente a organização, redirect https://westbrasilbi.github.io/pesquisa_precos/).
 * Permissões delegadas aprovadas: Power BI Service → GraphQLApi.Execute.All e Microsoft Graph → User.Read. */
window.CONFIG = {
  VERSAO: '2026.10.15d',

  TENANT_ID: '1516fbda-e5c5-429f-8c31-bf8dc4dedc55',   // WEST
  CLIENT_ID: '7b109c34-9e32-47c8-970d-4f03ed0c0d08',   // West Brasil - Pesquisa de Preços
  // Só entra conta com este domínio (e do tenant acima). Convidados externos e contas @...onmicrosoft.com são recusados.
  DOMINIO_PERMITIDO: 'westbrasil.com.br',

  // API for GraphQL "api_pesquisa_preco" (banco sqldb_west_coleta_preco, workspace Banco Fabric - B.I)
  GRAPHQL_URL: 'https://api.fabric.microsoft.com/v1/workspaces/c20fb156-4b2c-4186-b729-eda76f5da581/graphqlapis/7cfcfbde-396a-473e-ac8c-a54b8fdda2f3/graphql',
  ESCOPO_API: ['https://analysis.windows.net/powerbi/api/GraphQLApi.Execute.All'],

  // FOTOS NO SHAREPOINT — DESLIGADO até a TI aprovar a permissão.
  // A TI não liberou Files.ReadWrite.All (acesso a todos os arquivos do usuário). A alternativa de menor privilégio
  // é Lists.SelectedOperations.Selected (delegada) + permissão "write" do app só na biblioteca das fotos.
  // Enquanto FOTOS_NUVEM for false, as fotos ficam no celular e a pesquisa sobe sem o link.
  FOTOS_NUVEM: false,
  ESCOPO_FOTOS: ['https://graph.microsoft.com/Lists.SelectedOperations.Selected'],
  // driveId: id da biblioteca "Pesquisa de Preço - Fotos" (com permissão só na biblioteca o app não lê o site para achá-la)
  SHAREPOINT: { host: 'westbrasil.sharepoint.com', site: '/sites/RepositorioBI', biblioteca: 'Pesquisa de Preço - Fotos', driveId: '' },

  // Lista de clientes guardada no celular: recarrega do banco depois deste tempo (horas)
  CLIENTES_VALIDADE_H: 12,
};
