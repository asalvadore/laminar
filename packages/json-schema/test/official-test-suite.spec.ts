import { readdirSync, readFileSync } from 'fs';
import nock = require('nock');
import { join } from 'path';
import { Schema, validate } from '../src';

interface Test {
  description: string;
  data: any;
  valid: boolean;
}

interface Suite {
  description: string;
  schema: Schema;
  tests: Test[];
}

nock('http://localhost:1234')
  .persist()
  .get('/integer.json')
  .replyWithFile(200, join(__dirname, 'remotes/integer.json'))
  .get('/subSchemas.json')
  .replyWithFile(200, join(__dirname, 'remotes/subSchemas.json'))
  .get('/folder/folderInteger.json')
  .replyWithFile(200, join(__dirname, 'remotes/folder/folderInteger.json'))
  .get('/name.json')
  .replyWithFile(200, join(__dirname, 'remotes/name.json'));

const testFolders = ['draft4', 'draft6', 'draft7'];

expect.extend({
  async toValidateAgainstSchema(data, schema) {
    const errors = await validate(schema, data);
    const pass = errors.length === 0;
    return {
      pass,
      message: pass
        ? () =>
            `Expected data:\n` +
            this.utils.printExpected(data) +
            `\nTo not be valid against schema:\n` +
            this.utils.printExpected(schema)
        : () =>
            `Expected data:\n` +
            this.utils.printExpected(data) +
            `\nTo be valid against schema:\n` +
            this.utils.printExpected(schema) +
            `but got errors:\n` +
            this.utils.printReceived(errors),
    };
  },
});

for (const testFolder of testFolders) {
  const testFiles = readdirSync(join(__dirname, testFolder))
    .filter(file => file.endsWith('.json'))
    .map<[string, Suite[]]>(file => [
      file,
      JSON.parse(String(readFileSync(join(__dirname, testFolder, file)))),
    ]);

  for (const [name, suites] of testFiles) {
    describe(`${testFolder} ${name}`, () => {
      for (const suite of suites) {
        const tests = suite.tests.map<[string, any, boolean]>(test => [
          test.description,
          test.data,
          test.valid,
        ]);

        it.each<[string, any, boolean]>(tests)(
          `Should test ${suite.description}: %s`,
          async (testName, data, expected) => {
            if (expected) {
              await (expect as any)(data).toValidateAgainstSchema(suite.schema);
            } else {
              await (expect as any)(data).not.toValidateAgainstSchema(suite.schema);
            }
          },
        );
      }
    });
  }
}