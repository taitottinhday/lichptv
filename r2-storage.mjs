import { createHash, createHmac } from 'node:crypto';

const accountId = process.env.R2_ACCOUNT_ID?.trim();
const bucketName = process.env.R2_BUCKET_NAME?.trim();
const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
export const r2UrlTtlSeconds = Math.min(604800, Math.max(60, Number(process.env.R2_URL_TTL_SECONDS || 900)));
export const r2Configured = Boolean(accountId && bucketName && accessKeyId && secretAccessKey);

function awsEncode(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function signR2Url(method, objectKey, contentType = '', expiresInSeconds = r2UrlTtlSeconds) {
  if (!r2Configured) throw new Error('R2 credentials are not configured on the server.');
  if (!['GET', 'PUT'].includes(method)) throw new Error('Unsupported R2 signing method.');
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const path = `/${awsEncode(bucketName)}/${objectKey.split('/').map(awsEncode).join('/')}`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/auto/s3/aws4_request`;
  const signedHeaders = contentType ? 'content-type;host' : 'host';
  const query = [
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${accessKeyId}/${scope}`],
    ['X-Amz-Date', amzDate],
    ['X-Amz-Expires', String(expiresInSeconds)],
    ['X-Amz-SignedHeaders', signedHeaders]
  ].map(([key, value]) => [awsEncode(key), awsEncode(value)]).sort(([a], [b]) => a.localeCompare(b));
  const canonicalQuery = query.map(([key, value]) => `${key}=${value}`).join('&');
  const canonicalHeaders = contentType ? `content-type:${contentType}\nhost:${host}\n` : `host:${host}\n`;
  const canonicalRequest = [method, path, canonicalQuery, canonicalHeaders, signedHeaders, 'UNSIGNED-PAYLOAD'].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, createHash('sha256').update(canonicalRequest).digest('hex')].join('\n');
  const hmac = (key, value) => createHmac('sha256', key).update(value).digest();
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, dateStamp), 'auto'), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  return `https://${host}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
