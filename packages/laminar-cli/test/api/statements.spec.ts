import {
  httpServer,
  start,
  stop,
  htmlOk,
  jsonOk,
  ok,
  csv,
  yaml,
  pdf,
  jsonNotFound,
  jsonUnauthorized,
  securityOk,
} from '@ovotech/laminar';
import axios from 'axios';
import { join } from 'path';
import { openApiTyped } from './__generated__/statements';
import { LoggerContext, withLogger } from './middleware/logger';
import { createReadStream } from 'fs';
import { StatementService, ReportsService } from './statements';

interface AuthInfo {
  email: string;
}

const statementsService = new StatementService();
const reportsService = new ReportsService();

describe('Statements', () => {
  it('Should process response', async () => {
    const app = await openApiTyped<LoggerContext, AuthInfo>({
      api: join(__dirname, 'statements.yaml'),
      security: {
        BearerAuth: ({ headers }) => {
          if (headers.authorization !== 'Bearer Me') {
            return jsonUnauthorized({ message: 'Unauthorized' });
          }
          return securityOk({ email: 'me@example.com' });
        },
      },
      paths: {
        '/.well-known/health-check': { get: () => jsonOk({ success: true }) },
        '/.well-known/openapi.html': {
          get: () => htmlOk(createReadStream(join(__dirname, 'statements.html'))),
        },
        '/.well-known/openapi.yaml': {
          get: () => yaml(ok({ body: createReadStream(join(__dirname, 'statements.yaml')) })),
        },
        '/v2/reports/daily': {
          post: () => {
            reportsService.set('errors', 'daily', 'daily');
            return jsonOk({ success: true });
          },
        },
        '/v2/reports/{type}': {
          get: ({ path: { type } }) => {
            const items = reportsService.getAll(type);
            return jsonOk({
              total: items.length,
              items: items.map((item) => ({ filename: item.filename, createdAt: item.createdAt })),
            });
          },
          post: ({ path: { type }, body }) => {
            reportsService.set(type, 'date' in body ? body.date : `${body.fromDate}-${body.toDate}`, 'report');
            return jsonOk({ success: true });
          },
        },
        '/v2/reports/{type}/{filename}': {
          get: ({ path: { type, filename } }) => {
            const report = reportsService.get(type, filename);
            return report ? csv(ok({ body: report.content })) : jsonNotFound({ message: 'Report not found' });
          },
        },
        '/v2/statements': {
          get: () =>
            jsonOk(
              statementsService.getAll().map((item) => ({
                id: item.id,
                ref: item.ref,
                accountId: item.account.id,
                createdAt: '2020-01-01',
                isModified: false,
                errors: item.errors ?? [],
                state: item.state,
              })),
            ),
          post: ({ body }) => {
            const statement = {
              id: body.accountId,
              ref: 'REF111',
              state: 'CREATED' as const,
              account: { id: body.accountId, transactions: [] },
              supplies: [],
            };
            statementsService.add(statement);
            return jsonOk({
              id: body.accountId,
              ref: body.accountId,
              accountId: body.accountId,
              createdAt: '2020-01-01',
              isModified: false,
              errors: [],
              state: 'CREATED' as const,
            });
          },
        },
        '/v2/statements/{id}/approval': {
          post: ({ path: { id } }) => {
            const result = statementsService.approve(id);
            return result ? jsonOk({ success: true }) : jsonNotFound({ message: 'Cannot approve: Not Found' });
          },
        },
        '/v2/statements/{id}/data': {
          get: ({ path: { id } }) => {
            const item = statementsService.get(id);
            return item ? jsonOk(item) : jsonNotFound({ message: 'NoData: Statement not found' });
          },
        },
        '/v2/statements/{id}/html': {
          get: ({ path: { id } }) => {
            const html = statementsService.html(id);
            return html ? htmlOk(html) : jsonNotFound({ message: 'NoHtml: Statement not found' });
          },
        },
        '/v2/statements/{id}/modifications': {
          post: ({ path: { id }, body: { modification } }) => {
            const item = statementsService.modify(id, modification);
            return item ? jsonOk(item) : jsonNotFound({ message: 'Cannot modify: Statement not found' });
          },
        },
        '/v2/statements/{id}/pdf': {
          get: async ({ path: { id } }) => {
            const body = await statementsService.pdf(id);
            return body ? pdf(ok({ body })) : jsonNotFound({ message: 'NoPdf: Statement not found' });
          },
        },
      },
    });
    const log = jest.fn();
    const logger = withLogger(log);
    const server = httpServer({ app: logger(app), port: 8067 });
    try {
      await start(server);

      const api = axios.create({ baseURL: 'http://localhost:8067' });

      const { data: statementHtml } = await api.get('/v2/statements/111/html', {
        headers: { Authorization: 'Bearer Me' },
      });

      expect(statementHtml).toMatchSnapshot();

      const { data: statementPdf } = await api.get('/v2/statements/111/pdf', {
        headers: { Authorization: 'Bearer Me' },
      });

      expect(statementPdf).toMatchSnapshot();
    } finally {
      await stop(server);
    }
  });
});
