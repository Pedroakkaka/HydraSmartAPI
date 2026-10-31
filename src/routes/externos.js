/**
 * Dados de fontes externas (clima, CEMADEN, OpenStreetMap) e registros históricos oficiais.
 */

import { readFile } from 'node:fs/promises';

const registrosOficiais = JSON.parse(
  await readFile(new URL('../data/registrosOficiais.json', import.meta.url), 'utf8')
);

const queryForcar = {
  type: 'object',
  properties: { forcar: { type: 'boolean', default: false, description: 'Ignora o cache e consulta a fonte agora' } }
};

export default async function rotasExternas(app, { ctx }) {
  app.get('/clima', {
    schema: { tags: ['Fontes externas'], summary: 'Clima atual e previsão (Open-Meteo) para Porto Alegre-RS', querystring: queryForcar }
  }, async (req) => ctx.clima.obter({ forcar: req.query.forcar }));

  app.get('/cemaden', {
    schema: { tags: ['Fontes externas'], summary: 'Dados da integração CEMADEN (estação ainda configurada para Cáceres)', querystring: queryForcar }
  }, async (req) => ctx.cemaden.obter({ forcar: req.query.forcar }));

  app.get('/osm/drenos', {
    schema: { tags: ['Fontes externas'], summary: 'Bueiros e drenos de Porto Alegre mapeados no OpenStreetMap', querystring: queryForcar }
  }, async (req) => ctx.osm.obterDrenos({ forcar: req.query.forcar }));

  app.get('/historico-oficial', {
    schema: { tags: ['Fontes externas'], summary: 'Registros históricos existentes (ainda referentes a Cáceres; não usar como histórico de Porto Alegre)' }
  }, async () => registrosOficiais);
}
