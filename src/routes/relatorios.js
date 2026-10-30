import { normalizarBueiroId } from '../core/calibration.js';

const periodo = {
  type: 'object',
  properties: {
    desde: { type: 'string', format: 'date-time' },
    ate: { type: 'string', format: 'date-time' },
    bueiroId: { type: 'string' }
  }
};

const carimbo = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

export default async function rotasRelatorios(app, { ctx }) {
  app.get('/relatorios/leituras.csv', {
    schema: {
      tags: ['Relatórios'],
      summary: 'Exporta as leituras reais em CSV (padrão: últimas 24 horas)',
      querystring: periodo
    }
  }, async (req, reply) => {
    const desde = req.query.desde ?? new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const csv = await ctx.relatorios.leiturasCsv({
      desde,
      ate: req.query.ate,
      bueiroId: req.query.bueiroId ? normalizarBueiroId(req.query.bueiroId) : undefined
    });
    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="hydrasmart-leituras-${carimbo()}.csv"`)
      .send(csv);
  });

  app.get('/relatorios/auditoria.json', {
    schema: {
      tags: ['Relatórios'],
      summary: 'Relatório de auditoria: calibração, estatísticas por bueiro e alertas',
      querystring: periodo
    }
  }, async (req, reply) => {
    const dados = await ctx.relatorios.auditoria({ desde: req.query.desde, ate: req.query.ate });
    return reply
      .header('Content-Disposition', `attachment; filename="hydrasmart-auditoria-${carimbo()}.json"`)
      .send(dados);
  });
}
