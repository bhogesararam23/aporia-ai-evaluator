import { Transform } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import Busboy from 'busboy';
import { AppError } from '../../errors.ts';
import type { UploadedFile } from './types.ts';

export interface ParsedBody {
  readonly fields: ReadonlyMap<string, string>;
  readonly file: UploadedFile | null;
}

export interface BodyLimits {
  readonly maxBodyBytes: number;
  readonly maxFileBytes: number;
}

function readLimited(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) {
        reject(
          new AppError(
            'PAYLOAD_TOO_LARGE',
            'The request body is larger than the configured limit.',
          ),
        );
        return;
      }
      resolve(Buffer.concat(chunks));
    });
    req.on('error', () => {
      reject(new AppError('INVALID_INPUT', 'The request body could not be read.'));
    });
  });
}

function sanitizeFilename(value: string): string {
  const base = value.replaceAll('\\', '/').split('/').pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return cleaned.length === 0 ? 'upload.html' : cleaned.slice(0, 200);
}

function parseMultipart(req: IncomingMessage, limits: BodyLimits): Promise<ParsedBody> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fields = new Map<string, string>();
    let file: UploadedFile | null = null;
    let fileCount = 0;

    const fail = (error: AppError): void => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    };

    let busboy: ReturnType<typeof Busboy>;
    try {
      busboy = Busboy({
        headers: req.headers,
        limits: {
          files: 1,
          fileSize: limits.maxFileBytes,
          fields: 30,
          fieldSize: 10_000,
          parts: 40,
        },
      });
    } catch {
      fail(new AppError('INVALID_INPUT', 'The multipart request is malformed.'));
      return;
    }

    busboy.on('field', (name, value) => {
      fields.set(name, value);
    });
    busboy.on('file', (_name, stream, info) => {
      fileCount += 1;
      if (fileCount > 1) {
        stream.resume();
        fail(new AppError('INVALID_INPUT', 'Only one HTML file can be uploaded at a time.'));
        return;
      }
      if (typeof info.filename !== 'string' || info.filename === '') {
        stream.resume();
        return;
      }
      const originalFilename = info.filename;
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });
      stream.on('limit', () => {
        fail(
          new AppError(
            'PAYLOAD_TOO_LARGE',
            'The uploaded HTML file is larger than the configured limit.',
          ),
        );
      });
      stream.on('end', () => {
        if (settled) {
          return;
        }
        file = {
          filename: sanitizeFilename(originalFilename),
          mimeType: typeof info.mimeType === 'string' ? info.mimeType : 'application/octet-stream',
          bytes: new Uint8Array(Buffer.concat(chunks)),
        };
      });
    });
    busboy.on('filesLimit', () =>
      fail(new AppError('INVALID_INPUT', 'Only one file can be uploaded.')),
    );
    busboy.on('fieldsLimit', () =>
      fail(new AppError('PAYLOAD_TOO_LARGE', 'Too many form fields.')),
    );
    busboy.on('partsLimit', () =>
      fail(new AppError('PAYLOAD_TOO_LARGE', 'Too many multipart parts.')),
    );
    busboy.on('error', () =>
      fail(new AppError('INVALID_INPUT', 'The multipart request is malformed.')),
    );
    busboy.on('close', () => {
      if (settled) {
        return;
      }
      settled = true;
      resolve({ fields, file });
    });

    let received = 0;
    const limiter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length;
        if (received > limits.maxBodyBytes) {
          callback(
            new AppError(
              'PAYLOAD_TOO_LARGE',
              'The request body is larger than the configured limit.',
            ),
          );
          return;
        }
        callback(null, chunk);
      },
    });
    limiter.on('error', (error: unknown) => {
      fail(
        error instanceof AppError
          ? error
          : new AppError('INVALID_INPUT', 'The request body could not be read.'),
      );
    });
    req.on('error', () =>
      fail(new AppError('INVALID_INPUT', 'The request body could not be read.')),
    );
    req.pipe(limiter).pipe(busboy);
  });
}

export async function parseRequestBody(
  req: IncomingMessage,
  limits: BodyLimits,
): Promise<ParsedBody> {
  const contentType = (req.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (contentType === 'multipart/form-data') {
    return parseMultipart(req, limits);
  }
  if (contentType === 'application/x-www-form-urlencoded') {
    const buffer = await readLimited(req, limits.maxBodyBytes);
    const text = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
    const params = new URLSearchParams(text);
    const fields = new Map<string, string>();
    for (const [key, value] of params) {
      fields.set(key, value);
    }
    return { fields, file: null };
  }
  const contentLength = req.headers['content-length'];
  if (contentType === '' && (contentLength === undefined || contentLength === '0')) {
    return { fields: new Map(), file: null };
  }
  throw new AppError('UNSUPPORTED_MEDIA_TYPE', 'Use an HTML form submission.');
}
