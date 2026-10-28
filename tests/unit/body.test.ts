import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { parseRequestBody } from '../../src/app/http/body.ts';
import { AppError } from '../../src/errors.ts';

const LIMITS = { maxBodyBytes: 1_000_000, maxFileBytes: 500_000 };

function request(body: string | Buffer, headers: Record<string, string>): IncomingMessage {
  const stream = Readable.from([Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8')]);
  Object.assign(stream, { headers });
  return stream as unknown as IncomingMessage;
}

test('parses URL-encoded forms into fields', async () => {
  const parsed = await parseRequestBody(
    request('name=Aporia+Project&locale=en&_csrf=token', {
      'content-type': 'application/x-www-form-urlencoded',
      'content-length': '43',
    }),
    LIMITS,
  );
  assert.equal(parsed.fields.get('name'), 'Aporia Project');
  assert.equal(parsed.fields.get('locale'), 'en');
  assert.equal(parsed.fields.get('_csrf'), 'token');
  assert.equal(parsed.file, null);
});

test('rejects unsupported media types and oversized forms', async () => {
  await assert.rejects(
    parseRequestBody(
      request('{"name":"x"}', {
        'content-type': 'application/json',
        'content-length': '12',
      }),
      LIMITS,
    ),
    (error: unknown) => error instanceof AppError && error.code === 'UNSUPPORTED_MEDIA_TYPE',
  );
  await assert.rejects(
    parseRequestBody(
      request('x'.repeat(200), {
        'content-type': 'application/x-www-form-urlencoded',
        'content-length': '200',
      }),
      { maxBodyBytes: 100, maxFileBytes: 100 },
    ),
    (error: unknown) => error instanceof AppError && error.code === 'PAYLOAD_TOO_LARGE',
  );
});

function multipartBody(
  boundary: string,
  file?: { name: string; filename: string; content: string },
): string {
  let body = `--${boundary}\r\nContent-Disposition: form-data; name="label"\r\n\r\nHomepage\r\n`;
  body += `--${boundary}\r\nContent-Disposition: form-data; name="_csrf"\r\n\r\ntoken\r\n`;
  if (file !== undefined) {
    body += `--${boundary}\r\nContent-Disposition: form-data; name="${file.name}"; filename="${file.filename}"\r\nContent-Type: text/html\r\n\r\n${file.content}\r\n`;
  }
  body += `--${boundary}--\r\n`;
  return body;
}

test('parses multipart fields and one HTML file with a sanitized filename', async () => {
  const boundary = 'aporia-boundary';
  const body = multipartBody(boundary, {
    name: 'htmlFile',
    filename: '../nested/page.html',
    content: '<html><body>page</body></html>',
  });
  const parsed = await parseRequestBody(
    request(body, {
      'content-type': `multipart/form-data; boundary=${boundary}`,
      'content-length': String(Buffer.byteLength(body)),
    }),
    LIMITS,
  );
  assert.equal(parsed.fields.get('label'), 'Homepage');
  assert.equal(parsed.fields.get('_csrf'), 'token');
  assert.equal(parsed.file?.filename, 'page.html');
  assert.equal(
    Buffer.from(parsed.file?.bytes ?? []).toString('utf8'),
    '<html><body>page</body></html>',
  );
});

test('rejects oversized multipart files', async () => {
  const boundary = 'aporia-boundary';
  const body = multipartBody(boundary, {
    name: 'htmlFile',
    filename: 'page.html',
    content: 'x'.repeat(500),
  });
  await assert.rejects(
    parseRequestBody(
      request(body, {
        'content-type': `multipart/form-data; boundary=${boundary}`,
        'content-length': String(Buffer.byteLength(body)),
      }),
      { maxBodyBytes: 10_000, maxFileBytes: 100 },
    ),
    (error: unknown) => error instanceof AppError && error.code === 'PAYLOAD_TOO_LARGE',
  );
});

test('rejects malformed multipart boundaries', async () => {
  await assert.rejects(
    parseRequestBody(
      request('not multipart', {
        'content-type': 'multipart/form-data; boundary=',
        'content-length': '13',
      }),
      LIMITS,
    ),
    (error: unknown) => error instanceof AppError,
  );
});

test('accepts an empty body with no content type', async () => {
  const parsed = await parseRequestBody(request('', {}), LIMITS);
  assert.equal(parsed.fields.size, 0);
  assert.equal(parsed.file, null);
});
