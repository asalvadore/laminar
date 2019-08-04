import { existsSync, readFileSync } from 'fs';
import * as YAML from 'js-yaml';
import fetch from 'node-fetch';
import { dirname, join } from 'path';
import { URL } from 'url';
import {
  Schema,
  TraversableSchema,
  RefSchema,
  FileContext,
  RefMap,
  LoadedSchema,
  Context,
  ResolvedSchema,
} from './types';

export const isTraversable = (schema: unknown): schema is TraversableSchema =>
  schema && typeof schema === 'object';

export const toUrl = (url: string, base?: string): string | undefined => {
  try {
    return new URL(url, base).toString();
  } catch (error) {
    return undefined;
  }
};

export const getId = (schema: Schema): string | undefined => {
  if (isTraversable(schema)) {
    if ('$id' in schema && schema.$id && typeof schema.$id === 'string') {
      return schema.$id;
    } else if ('id' in schema && schema.id && typeof schema.id === 'string') {
      return schema.id;
    }
  }
  return undefined;
};

export const isRefSchema = (schema: Schema): schema is RefSchema =>
  isTraversable(schema) &&
  '$ref' in schema &&
  schema.$ref !== undefined &&
  typeof schema.$ref === 'string';

export const currentId = (schema: Schema, parentId?: string): string | undefined => {
  const id = getId(schema);
  return id ? toUrl(id, parentId) : parentId;
};

export const currentUrl = (
  url?: string,
  { cwd, parentId }: FileContext = {},
): string | undefined => {
  const fullUrl = url && toUrl(url, parentId);
  if (fullUrl) {
    return fullUrl;
  } else if (url && cwd) {
    if (!existsSync(join(cwd, url))) {
      throw new Error(`File ${url} in ${cwd} does not exist`);
    }
    return url;
  } else {
    return undefined;
  }
};

export const reduceSchema = <TResult = Schema>(
  schema: Schema,
  cb: (all: TResult, item: Schema, id?: string) => TResult,
  initial: TResult,
  id?: string,
): TResult =>
  isTraversable(schema)
    ? Object.values(schema).reduce(
        (all, item) => reduceSchema(item, cb, all, currentId(schema, id)),
        cb(initial, schema, id),
      )
    : cb(initial, schema, id);

export const extractNamedRefs = (document: Schema): RefMap =>
  reduceSchema(
    document,
    (all, item, id) => {
      const itemId = getId(item);
      const url = itemId ? toUrl(itemId, id) : false;
      return url ? { ...all, [url]: item } : all;
    },
    {},
  );

export const extractUrls = (
  schema: Schema,
  namedRefs: string[] = [],
  fileContext: FileContext = {},
): string[] =>
  reduceSchema<string[]>(
    schema,
    (all, item, parentId) => {
      if (isRefSchema(item)) {
        const [url] = item.$ref.split('#');
        const fullUrl = currentUrl(url, { ...fileContext, parentId });

        if (fullUrl && !all.includes(fullUrl) && !namedRefs.includes(fullUrl)) {
          return [...all, fullUrl];
        }
      }
      return all;
    },
    [],
  );

export const loadFile = async (uri: string, { cwd }: FileContext = {}): Promise<LoadedSchema> => {
  const url = toUrl(uri);
  if (url) {
    const result = await fetch(uri);
    if (result.headers.get('content-type') === 'application/yaml') {
      return { uri, content: YAML.load(await result.text()) };
    } else {
      return { uri, content: await result.json() };
    }
  } else {
    const file = cwd ? join(cwd, uri) : uri;
    const content = readFileSync(file, 'utf8');
    const newCwd = dirname(file);

    if (uri.endsWith('.yaml') || uri.endsWith('.yml')) {
      return { uri: `file://${file}`, content: YAML.load(content), cwd: newCwd };
    } else {
      return { uri: `file://${file}`, content: JSON.parse(content), cwd: newCwd };
    }
  }
};

export const parseJsonPointer = (name: string): string =>
  decodeURIComponent(name.replace('~1', '/').replace('~0', '~'));

export const getJsonPointer = (document: Schema, pointer: string): Schema | undefined =>
  pointer
    .split('/')
    .reduce<Schema | undefined>(
      (item, name) =>
        name ? (isTraversable(item) ? item[parseJsonPointer(name)] : undefined) : item,
      document,
    );

export const resolveNestedRefs = (
  schema: Schema,
  context: Context,
  fileContext: FileContext = {},
): Schema => {
  const parentId = currentId(schema, fileContext.parentId);

  if (isTraversable(schema)) {
    for (const [key, item] of Object.entries(schema)) {
      schema[key] = resolveNestedRefs(item, context, { ...fileContext, parentId });
    }
  }

  if (isRefSchema(schema)) {
    const [url, pointer] = schema.$ref.split('#');

    const fullUrl = currentUrl(url, { ...fileContext, parentId });
    const fullPointer = [fullUrl, pointer].join('#');
    if (!context.refs[fullPointer]) {
      const currentDocument = fullUrl ? context.refs[fullUrl] : context.schema;
      const newContent = pointer ? getJsonPointer(currentDocument, pointer) : currentDocument;
      if (newContent !== undefined) {
        context.refs[fullPointer] = newContent;
      }
    }

    return {
      $ref: fullPointer,
    };
  }

  return schema;
};

export const extractFiles = async (
  schema: Schema,
  options: FileContext = {},
): Promise<{ refs: RefMap; uris: string[] }> => {
  const initialRefs = extractNamedRefs(schema);
  const result = await Promise.all(
    extractUrls(schema, Object.keys(initialRefs), options).map(async url => {
      const { content, cwd, uri } = await loadFile(url, options);
      const { refs, uris } = await extractFiles(content, { cwd });
      const ref = resolveNestedRefs(content, { schema: content, refs }, { cwd });
      return { uris: [...uris, uri], refs: { [url]: ref, ...refs } };
    }),
  );

  return result.reduce(
    (all, item) => ({ uris: [...all.uris, ...item.uris], refs: { ...all.refs, ...item.refs } }),
    { uris: [], refs: initialRefs },
  );
};

export const resolveRefs = async (
  original: Schema,
  fileContext: FileContext = {},
): Promise<ResolvedSchema> => {
  const copy = JSON.parse(JSON.stringify(original));
  const { refs, uris } = await extractFiles(copy, fileContext);
  const context = { schema: copy, refs, uris };
  const schema = resolveNestedRefs(copy, context, fileContext);
  return { schema, refs, uris };
};

export const resolveRefsFile = async (file: string): Promise<ResolvedSchema> => {
  const { content, cwd, uri } = await loadFile(file);
  const resolved = await resolveRefs(content, { cwd });
  return { ...resolved, uris: [uri, ...resolved.uris] };
};