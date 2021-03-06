import { loggingMiddleware, httpServer, start, describe } from '@ovotech/laminar';
import { createPgClient } from './db.middleware';
import { routes } from './routes';

const main = async () => {
  if (process.env.PG === undefined) {
    throw new Error('Need PG env variable');
  }

  if (process.env.PORT === undefined) {
    throw new Error('Need PORT env variable');
  }

  const logging = loggingMiddleware(console);
  const pgClient = await createPgClient(process.env.PG);

  const app = logging(pgClient(routes));

  const server = httpServer({ app, port: Number(process.env.PORT) });
  await start(server);

  console.log(describe(server));
};

main();
