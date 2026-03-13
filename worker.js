// DottedFly worker.js
// Fetches audio from YouTube's internal API, then streams the bytes directly
// through Cloudflare so the browser never touches googlevideo.com (no CORS issues).

const YT_PLAYER_URL = 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false';

const CLIENTS = [
  {
    name: 'ANDROID_VR',
    context: {
      client: {
        clientName: 'ANDROID_VR',
        clientVersion: '1.60.19',
        androidSdkVersion: 32,
        osName: 'Android',
        osVersion: '12',
        platform: 'MOBILE',
        hl: 'en', gl: 'US',
      },
    },
    headers: {
      'User-Agent': 'com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12; Build/SQ3A.220705.002) gzip',
      'X-YouTube-Client-Name': '28',
      'X-YouTube-Client-Version': '1.60.19',
    },
  },
  {
    name: 'IOS',
    context: {
      client: {
        clientName: 'IOS',
        clientVersion: '20.03.02',
        deviceMake: 'Apple',
        deviceModel: 'iPhone16,2',
        osName: 'iPhone',
        osVersion: '18.2.1.22C161',
        hl: 'en', gl: 'US',
      },
    },
    headers: {
      'User-Agent': 'com.google.ios.youtube/20.03.02 (iPhone16,2; U; CPU iPhone OS 18_2_1 like Mac OS X)',
      'X-YouTube-Client-Name': '5',
      'X-YouTube-Client-Version': '20.03.02',
    },
  },
];

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

async function getAudioUrl(videoId) {
  for (const client of CLIENTS) {
    try {
      const res = await fetch(YT_PLAYER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'https://www.youtube.com',
          'Referer': 'https://www.youtube.com/',
          ...client.headers,
        },
        body: JSON.stringify({
          videoId,
          context: client.context,
          contentCheckOk: true,
          racyCheckOk: true,
        }),
      });

      if (!res.ok) continue;
      const data = await res.json();

      if (data?.playabilityStatus?.status !== 'OK') continue;

      // Audio-only adaptive formats, no cipher, highest bitrate first
      const audio = (data?.streamingData?.adaptiveFormats || [])
        .filter(f => f.mimeType?.startsWith('audio/') && f.url && !f.signatureCipher)
        .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

      if (audio.length > 0) return { url: audio[0].url, mime: audio[0].mimeType.split(';')[0] };

      // Fallback: combined format
      const combined = (data?.streamingData?.formats || [])
        .filter(f => f.url && !f.signatureCipher)
        .sort((a, b) => (a.bitrate || 0) - (b.bitrate || 0));

      if (combined.length > 0) return { url: combined[0].url, mime: 'video/mp4' };

    } catch (_) {}
  }
  return null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    // /proxy?id=VIDEO_ID  — stream audio bytes through Cloudflare
    if (url.pathname === '/proxy') {
      const videoId = url.searchParams.get('id');
      if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
        return jsonResp({ error: 'Invalid video id' }, 400);
      }

      const result = await getAudioUrl(videoId);
      if (!result) return jsonResp({ error: 'Could not get audio URL from YouTube' }, 502);

      // Forward the Range header so seeking works
      const rangeHeader = request.headers.get('Range');
      const upstreamHeaders = { 'User-Agent': 'Mozilla/5.0' };
      if (rangeHeader) upstreamHeaders['Range'] = rangeHeader;

      const upstream = await fetch(result.url, { headers: upstreamHeaders });

      // Stream the response back with CORS headers added
      const responseHeaders = new Headers();
      responseHeaders.set('Access-Control-Allow-Origin', '*');
      responseHeaders.set('Content-Type', result.mime || 'audio/webm');

      // Pass through important headers from upstream
      for (const h of ['Content-Length', 'Content-Range', 'Accept-Ranges', 'Cache-Control']) {
        const val = upstream.headers.get(h);
        if (val) responseHeaders.set(h, val);
      }

      return new Response(upstream.body, {
        status: upstream.status,
        headers: responseHeaders,
      });
    }

    // Everything else → static site files
    return env.ASSETS.fetch(request);
  },
};
