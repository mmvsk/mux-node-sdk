import crypto from 'crypto';

export const HeaderScheme = {
  V1: 'v1',
} as const;
// eslint-disable-next-line no-redeclare
export type HeaderScheme = (typeof HeaderScheme)[keyof typeof HeaderScheme];

const DEFAULT_TOLERANCE = 300; // 5 minutes
const EXPECTED_SCHEME: HeaderScheme = HeaderScheme.V1;

/**
 * Secure compare, from https://github.com/freewil/scmp
 */
function secureCompare(_a: string, _b: string) {
  const a = Buffer.from(_a);
  const b = Buffer.from(_b);

  // return early here if buffer lengths are not equal since timingSafeEqual
  // will throw if buffer lengths are not equal
  if (a.length !== b.length) {
    return false;
  }

  // use crypto.timingSafeEqual if available (since Node.js v6.6.0),
  // otherwise use our own scmp-internal function.
  if (crypto.timingSafeEqual) {
    return crypto.timingSafeEqual(a, b);
  }

  const len = a.length;
  let result = 0;

  for (let i = 0; i < len; i += 1) {
    /* eslint-disable no-bitwise */
    result |= a[i] ^ b[i];
  }
  return result === 0;
}

export class VerifyHeader {
  static parseHeader(header?: string, scheme: HeaderScheme = HeaderScheme.V1) {
    if (typeof header !== 'string') {
      return null;
    }

    if (scheme !== EXPECTED_SCHEME) {
      throw new Error(`Unrecognized header scheme: '${scheme}'`);
    }

    return header.split(',').reduce(
      (accum, item) => {
        const kv: string[] = item.split('=');

        if (kv[0] === 't') {
          /* eslint-disable no-param-reassign, prefer-destructuring */
          accum.timestamp = parseInt(kv[1], 10);
        }

        if (kv[0] === scheme && typeof kv[1] === 'string') {
          accum.signatures.push(kv[1]);
        }

        return accum;
      },
      {
        timestamp: -1,
        signatures: [] as string[],
      }
    );
  }

  static computeSignature(payload: string, secret: string | Buffer) {
    return crypto
      .createHmac('sha256', secret)
      .update(payload, 'utf8')
      .digest('hex');
  }

  static verify(
    _payload: string | Buffer,
    _header: string | Buffer,
    secret: string | Buffer,
    tolerance: number = DEFAULT_TOLERANCE
  ) {
    const payload = Buffer.isBuffer(_payload)
      ? _payload.toString('utf8')
      : _payload;
    const header = Buffer.isBuffer(_header)
      ? _header.toString('utf8')
      : _header;

    const details = this.parseHeader(header);

    if (!details || details.timestamp === -1) {
      throw new Error('Unable to extract timestamp and signatures from header');
    }

    if (!details.signatures.length) {
      throw new Error('No signatures found with expected scheme');
    }

    const expectedSignature = this.computeSignature(
      `${details.timestamp}.${payload}`,
      secret
    );

    const signatureFound = !!details.signatures.filter((sig) =>
      secureCompare(sig, expectedSignature)
    ).length;

    if (!signatureFound) {
      throw new Error(
        'No signatures found matching the expected signature for payload.'
      );
    }

    const timestampAge = Math.floor(Date.now() / 1000) - details.timestamp;

    if (tolerance > 0 && timestampAge > tolerance) {
      throw new Error('Timestamp outside the tolerance zone');
    }

    return true;
  }
}
