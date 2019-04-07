import { resolveRefs } from '@ovotech/json-refs';
import { Schema, validate } from '@ovotech/json-schema';
import {
  Context,
  HttpError,
  isResponse,
  Matcher,
  Resolver,
  response,
  RouteContext,
  selectMatcher,
  toMatcher,
} from '@ovotech/laminar';
import { readFileSync } from 'fs';
import * as YAML from 'js-yaml';
import { OapiResolverError } from './OapiResolverError';
import { OpenApi } from './schema';
import { toSchema } from './to-schema';
import { OpenAPIObject } from './types';

interface RouteMatcher<TContext extends Context> extends Matcher {
  resolver: Resolver<TContext>;
  schema: {
    context: Schema;
    response: Schema;
  };
}

export const toMatchers = <TContext extends Context & RouteContext>(
  api: OpenAPIObject,
  paths: {
    [path: string]: { [method: string]: Resolver<TContext> };
  },
) =>
  Object.entries(paths).reduce<Array<RouteMatcher<TContext>>>(
    (allPaths, [path, methods]) =>
      Object.entries(methods).reduce(
        (all, [method, resolver]) => [
          ...all,
          {
            ...toMatcher(method, path),
            resolver,
            schema: toSchema(api, path, method),
          },
        ],
        allPaths,
      ),
    [],
  );

type LoadApi = { yamlFile: string } | { jsonFile: string } | { json: string } | { yaml: string };

export const loadApi = (api: LoadApi): OpenAPIObject => {
  if ('yamlFile' in api) {
    return YAML.load(String(readFileSync(api.yamlFile)));
  } else if ('yaml' in api) {
    return YAML.load(api.yaml);
  } else if ('jsonFile' in api) {
    return JSON.parse(String(readFileSync(api.jsonFile)));
  } else if ('json' in api) {
    return JSON.parse(String(readFileSync(api.json)));
  } else {
    throw new OapiResolverError('Cannot load api');
  }
};

export const oapi = async <TContext extends Context = Context>(
  options: {
    paths: {
      [path: string]: {
        [method: string]: Resolver<TContext & RouteContext>;
      };
    };
  } & LoadApi,
): Promise<Resolver<TContext>> => {
  const api = loadApi(options);
  const checkApi = await validate(OpenApi, api);
  if (!checkApi.valid) {
    throw new OapiResolverError('Invalid API Definition', checkApi.errors);
  }

  const matchers = toMatchers(await resolveRefs(api), options.paths);

  return async ctx => {
    const select = selectMatcher(ctx.method, ctx.url.pathname!, matchers);

    if (!select) {
      throw new HttpError(404, {
        message: `Path ${ctx.method} ${ctx.url.pathname!} not found`,
      });
    }
    const {
      matcher: { resolver, schema },
      path,
    } = select;
    const context = { ...ctx, path };
    const checkContext = await validate(schema.context, context, { name: 'context' });

    if (!checkContext.valid) {
      throw new HttpError(400, {
        message: `Request Validation Error`,
        errors: checkContext.errors,
      });
    }

    const result = resolver(context);
    const laminarResponse = isResponse(result) ? result : response({ body: result });
    const checkResponse = await validate(schema.response, laminarResponse, {
      name: 'response',
    });

    if (!checkResponse.valid) {
      throw new HttpError(500, {
        message: `Response Validation Error`,
        errors: checkResponse.errors,
      });
    }

    return laminarResponse;
  };
};