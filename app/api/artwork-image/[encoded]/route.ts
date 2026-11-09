import { NextRequest, NextResponse } from 'next/server';
import http2 from 'http2';

export const revalidate = 604800; // 7 days

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ encoded: string }> }
) {
  const { encoded } = await params;
  if (!encoded) {
    return new NextResponse('Missing encoded parameter', { status: 400 });
  }

  let urlParam: string;
  try {
    urlParam = Buffer.from(encoded, 'base64url').toString('utf8');
  } catch {
    return new NextResponse('Invalid encoded URL', { status: 400 });
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(urlParam);
  } catch {
    return new NextResponse('Invalid URL', { status: 400 });
  }

  // Only proxy allowed artwork domains
  const allowedHosts = ['artworks.thetvdb.com', 'assets.fanart.tv', 'fanart.tv'];
  if (!allowedHosts.includes(parsedUrl.hostname)) {
    return new NextResponse('Forbidden host', { status: 403 });
  }

  try {
    const origin = `${parsedUrl.protocol}//${parsedUrl.host}`;
    const path = `${parsedUrl.pathname}${parsedUrl.search}`;

    const client = http2.connect(origin);

    const imagePromise = new Promise<{
      status: number;
      contentType: string;
      buffer: Buffer;
    }>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const h2Req = client.request({
        ':path': path,
        ':method': 'GET',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      });

      let status = 200;
      let contentType = 'image/jpeg';

      h2Req.on('response', (headers) => {
        status = Number(headers[':status'] || 200);
        contentType = String(headers['content-type'] || 'image/jpeg');
      });

      h2Req.on('data', (chunk) => {
        chunks.push(Buffer.from(chunk));
      });

      h2Req.on('end', () => {
        client.close();
        resolve({
          status,
          contentType,
          buffer: Buffer.concat(chunks),
        });
      });

      h2Req.on('error', (err) => {
        client.close();
        reject(err);
      });
    });

    const result = await imagePromise;

    if (result.status !== 200) {
      return new NextResponse('Upstream error', { status: result.status });
    }

    return new NextResponse(new Uint8Array(result.buffer), {
      status: 200,
      headers: {
        'Content-Type': result.contentType,
        'Cache-Control': 'public, max-age=604800, stale-while-revalidate=86400, immutable',
      },
    });
  } catch (err: any) {
    console.error('Artwork image proxy error:', err);
    return new NextResponse('Failed to fetch image', { status: 502 });
  }
}
