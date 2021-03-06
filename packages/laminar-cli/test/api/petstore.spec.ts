import {
  httpServer,
  start,
  stop,
  jsonUnauthorized,
  jsonNotFound,
  jsonOk,
  jsonNoContent,
  securityOk,
  optional,
} from '@ovotech/laminar';
import axios from 'axios';
import { join } from 'path';
import { LoggerContext, withLogger } from './middleware/logger';
import { openApiTyped, Pet } from './__generated__/petstore';

interface AuthInfo {
  user: string;
}

describe('Petstore', () => {
  it('Should process response', async () => {
    const db: Pet[] = [
      { id: 111, name: 'Catty', tag: 'kitten' },
      { id: 222, name: 'Doggy' },
    ];
    const log = jest.fn();

    const oapi = await openApiTyped<LoggerContext, AuthInfo>({
      api: join(__dirname, 'petstore.yaml'),
      security: {
        BearerAuth: ({ headers, logger }) => {
          if (headers.authorization === 'Bearer 123') {
            logger('Auth Successful');
            return securityOk({ user: 'dinkey' });
          } else {
            return jsonUnauthorized({ message: 'Unathorized user' });
          }
        },
        BasicAuth: ({ headers }) => {
          if (headers.authorization === 'Basic 123') {
            return securityOk({ user: 'dinkey' });
          } else {
            return jsonUnauthorized({ message: 'Unathorized user' });
          }
        },
        ApiKeyAuth: ({ headers }) => {
          if (headers['x-api-key'] === 'Me') {
            return securityOk({ user: 'dinkey' });
          } else {
            return jsonUnauthorized({ message: 'Unathorized user' });
          }
        },
      },
      paths: {
        '/pets': {
          get: ({ logger }) => {
            logger('Get all');
            return jsonOk(db);
          },
          post: ({ body, authInfo, logger, headers }) => {
            const pet = { ...body, id: Math.max(...db.map((item) => item.id)) + 1 };
            logger(`new pet ${pet.name}, trace token: ${headers['x-trace-token']}`);

            db.push(pet);
            return jsonOk({ pet, user: authInfo.user });
          },
        },
        '/pets/{id}': {
          get: ({ path }) => {
            const pet = db.find((item) => item.id === Number(path.id));
            return optional(jsonOk, pet) ?? jsonNotFound({ code: 123, message: 'Not Found' });
          },
          delete: ({ path }) => {
            const index = db.findIndex((item) => item.id === Number(path.id));
            if (index !== -1) {
              db.splice(index, 1);
              return jsonNoContent({ body: 'OK' });
            } else {
              return jsonNotFound({ code: 12, message: 'Item not found' });
            }
          },
        },
      },
    });
    const logger = withLogger(log);
    const server = httpServer({ app: logger(oapi), port: 8065 });

    try {
      await start(server);

      const api = axios.create({ baseURL: 'http://localhost:8065' });

      await expect(api.get('/unknown-url').catch((error) => error.response)).resolves.toMatchObject({
        status: 404,
        data: {
          message: 'Request for "GET /unknown-url" did not match any of the paths defined in the OpenApi Schema',
        },
      });

      await expect(api.get('/pets')).resolves.toMatchObject({
        status: 200,
        data: [
          { id: 111, name: 'Catty', tag: 'kitten' },
          { id: 222, name: 'Doggy' },
        ],
      });

      await expect(api.post('/pets', { other: 'New Puppy' }).catch((error) => error.response)).resolves.toMatchObject({
        status: 400,
        data: {
          errors: [
            '[request.headers] (required) is missing [x-trace-token] keys',
            '[request.body] (required) is missing [name] keys',
          ],
          message: 'Request for "POST /pets" does not match OpenApi Schema',
        },
      });

      await expect(
        api
          .post('/pets', { name: 'New Puppy' }, { headers: { Authorization: 'Bearer 000', 'X-Trace-Token': '123' } })
          .catch((error) => error.response),
      ).resolves.toMatchObject({
        status: 401,
        data: { message: 'Unathorized user' },
      });

      await expect(
        api
          .post('/pets', { other: 'New Puppy' }, { headers: { Authorization: 'Bearer 123', 'X-Trace-Token': '123' } })
          .catch((error) => error.response),
      ).resolves.toMatchObject({
        status: 400,
        data: {
          errors: ['[request.body] (required) is missing [name] keys'],
          message: 'Request for "POST /pets" does not match OpenApi Schema',
        },
      });

      await expect(
        api.post('/pets', { name: 'New Puppy' }, { headers: { Authorization: 'Bearer 123', 'X-Trace-Token': '123' } }),
      ).resolves.toMatchObject({
        status: 200,
        data: { pet: { id: 223, name: 'New Puppy' }, user: 'dinkey' },
      });

      await expect(api.get('/pets/111', { headers: { Authorization: 'Basic 123' } })).resolves.toMatchObject({
        status: 200,
        data: { id: 111, name: 'Catty', tag: 'kitten' },
      });

      await expect(
        api.get('/pets/000', { headers: { Authorization: 'Basic 123' } }).catch((error) => error.response),
      ).resolves.toMatchObject({
        status: 404,
        data: {
          code: 123,
          message: 'Not Found',
        },
      });

      await expect(api.get('/pets/223', { headers: { Authorization: 'Basic 123' } })).resolves.toMatchObject({
        status: 200,
        data: { id: 223, name: 'New Puppy' },
      });

      await expect(api.get('/pets')).resolves.toMatchObject({
        status: 200,
        data: [
          { id: 111, name: 'Catty', tag: 'kitten' },
          { id: 222, name: 'Doggy' },
          { id: 223, name: 'New Puppy' },
        ],
      });

      await expect(
        api.delete('/pets/228', { headers: { 'X-API-KEY': 'Me' } }).catch((error) => error.response),
      ).resolves.toMatchObject({
        status: 404,
        data: {
          code: 12,
          message: 'Item not found',
        },
      });

      await expect(
        api.delete('/pets/222', { headers: { 'X-API-missing': 'Me' } }).catch((error) => error.response),
      ).resolves.toMatchObject({
        status: 401,
        data: {
          message: 'Unathorized user',
        },
      });

      await expect(api.delete('/pets/222', { headers: { 'X-API-KEY': 'Me' } })).resolves.toMatchObject({
        status: 204,
        data: {},
      });

      await expect(api.get('/pets')).resolves.toMatchObject({
        status: 200,
        data: [
          { id: 111, name: 'Catty', tag: 'kitten' },
          { id: 223, name: 'New Puppy' },
        ],
      });

      expect(log).toHaveBeenNthCalledWith(1, 'Get all');
      expect(log).toHaveBeenNthCalledWith(2, 'Auth Successful');
      expect(log).toHaveBeenNthCalledWith(3, 'new pet New Puppy, trace token: 123');
      expect(log).toHaveBeenNthCalledWith(4, 'Get all');
      expect(log).toHaveBeenNthCalledWith(5, 'Get all');
    } finally {
      await stop(server);
    }
  });
});
