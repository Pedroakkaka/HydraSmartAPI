import { FONTES_NACIONAIS, obterNivelBlumenau } from '../services/fontesBrasil.js';

export default async function rotasBrasil(app) {
  app.get('/brasil/fontes', {
    schema: { tags: ['Fontes externas'], summary: 'Catálogo de fontes oficiais hidrometeorológicas nacionais' }
  }, async () => ({
    status: 'sucesso',
    inmet: FONTES_NACIONAIS.inmet,
    blumenau: FONTES_NACIONAIS.blumenau,
    observacao: 'Produtos do INMET possuem diferentes periodicidades e nem todos oferecem acesso via API.'
  }));

  app.get('/brasil/blumenau/nivel-rio', {
    schema: { tags: ['Fontes externas'], summary: 'Leituras públicas do rio Itajaí-Açu, com data e indicação de atualização' }
  }, async () => obterNivelBlumenau());
}
