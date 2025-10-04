export const fiscalDocumentsMock = [
  {
    method: 'GET' as const,
    test: (url: string) => url === '/fiscal/documents',
    handler: async () => ({
      nfce: {
        chave: '41230689340586000167650010000000031000000038',
        descricao: 'Chave de acesso NFC-e – Ambiente de homologação SEFAZ/PR Nota Técnica 2023.003',
        urlConsulta: 'https://www.fazenda.pr.gov.br/servicos/nota-fiscal-consumidor-eletronica'
      },
      nfe: {
        chave: '43220506012312000190650010000000081500000080',
        descricao: 'Chave de acesso NF-e exemplo oficial disponibilizado pela SEFAZ/RS (homologação 4.0)',
        urlConsulta: 'https://www.sefaz.rs.gov.br/NFE/NFE-Consulta'
      },
      nfse: {
        numero: '00001234',
        codigoVerificacao: 'AB12-CD34',
        descricao: 'Nota Fiscal de Serviços Eletrônica - Prefeitura Municipal de São Paulo (guia de integração)',
        urlConsulta: 'https://nfse.prefeitura.sp.gov.br/contribuinte'
      }
    })
  }
];
