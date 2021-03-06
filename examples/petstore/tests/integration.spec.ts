import { start, stop } from '@ovotech/laminar';
import { createApp } from '../src/app';
import { sign } from 'jsonwebtoken';
import axios from 'axios';
import { Pool } from 'pg';

const secret = 'TEST_SECRET';
const logger = { info: jest.fn(), error: jest.fn() };
const port = 8822;
const hostname = 'localhost';
const connectionString = 'postgres://example-admin:example-pass@localhost:5432/example';
const token = sign({ email: 'me@example.com', scopes: [] }, secret);
const client = axios.create({
  baseURL: `http://${hostname}:${port}`,
  headers: { Authorization: `Bearer ${token}` },
});

describe('Petstore Integration Tests', () => {
  it('Should work as a petstore', async () => {
    const pool = new Pool({ connectionString });
    const petstore = await createApp({ secret, pool, logger, port, hostname });
    await pool.query('DELETE FROM pets');
    await start(petstore);

    try {
      await expect(client.get('/pets')).resolves.toMatchObject({
        status: 200,
        data: [],
      });

      const charlie = await client.post(
        '/pets',
        { name: 'Charlie', tag: 'dog' },
        { headers: { 'x-trace-token': 'me' } },
      );

      expect(charlie).toMatchObject({
        status: 200,
        data: { id: expect.any(Number), name: 'Charlie', tag: 'dog' },
      });

      const leya = await client.post(
        '/pets',
        { name: 'Leya', tag: 'cat' },
        { headers: { 'x-trace-token': 'me' } },
      );

      expect(leya).toMatchObject({
        status: 200,
        data: { id: expect.any(Number), name: 'Leya', tag: 'cat' },
      });

      await expect(client.get('/pets?limit=2')).resolves.toMatchObject({
        status: 200,
        data: [
          { id: expect.any(Number), name: 'Charlie', tag: 'dog' },
          { id: expect.any(Number), name: 'Leya', tag: 'cat' },
        ],
      });

      await expect(client.get('/pets?tags[]=dog')).resolves.toMatchObject({
        status: 200,
        data: [{ id: expect.any(Number), name: 'Charlie', tag: 'dog' }],
      });

      await expect(client.get(`/pets/${charlie.data.id}`)).resolves.toMatchObject({
        status: 200,
        data: { id: expect.any(Number), name: 'Charlie', tag: 'dog' },
      });

      await expect(client.get(`/pets/${leya.data.id}`)).resolves.toMatchObject({
        status: 200,
        data: { id: expect.any(Number), name: 'Leya', tag: 'cat' },
      });

      await expect(client.delete(`/pets/${leya.data.id}`)).resolves.toMatchObject({
        status: 204,
      });

      await expect(client.delete(`/pets/${charlie.data.id}`)).resolves.toMatchObject({
        status: 204,
      });

      await expect(client.get('/pets')).resolves.toMatchObject({
        status: 200,
        data: [],
      });
    } finally {
      await pool.end();
      await stop(petstore);
    }
  });
});
