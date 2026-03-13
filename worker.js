// DottedFly worker.js
// Tries multiple YouTube internal clients in order until one returns direct audio URLs.
// android_vr and TVHTML5_SIMPLY don't require PO tokens (as of early 2026).

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json',
};

const YT_PLAYER_URL = 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false';

// Clients tried in order — first one to return direct (non-cipher) audio URLs wins
const CLIENTS = [
  {
    // Android VR — yt-dlp's current default, returns direct URLs, no PO token needed
    name: 'ANDROID_VR',
    context: {
      client: {
        clientName: 'ANDROID_VR',
        clientVersion: '1.60.19',
        androidSdkVersion: 32,
        osName: 'Android',
        osVersion: '12',
        platform: 'MOBILE',
        hl: 'en',
        gl: 'US',
      },
    },
    headers: {
      'User-Agent': 'com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12; Build/SQ3A.220705.002) gzip',
      'X-YouTube-Client-Name': '28',
      'X-YouTube-Client-Version': '1.60.19',
    },
  },
  {
    // TV Simply — lightweight client, no PO token, direct URLs
    name: 'TVHTML5_SIMPLY',
    context: {
      client: {
        clientName: 'TVHTML5_SIMPLY',
        clientVersion: '2.0',
        hl: 'en',
        gl: 'US',
      },
    },
    headers: {
      'User-Agent': 'Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) AppleWebKit/538.1 (KHTML, like Gecko) Version/6.0 TV Safari/538.1',
      'X-YouTube-Client-Name': '85',
      'X-YouTube-Client-Version': '2.0',
    },
  },
  {
    // iOS — fallback, sometimes works without PO token
    name: 'IOS',
    context: {
      client: {
        clientName: 'IOS',
        clientVersion: '20.03.02',
        deviceMake: 'Apple',
        deviceModel: 'iPhone16,2',
        osName: 'iPhone',
        osVersion: '18.2.1.22C161',
        hl: 'en',
        gl: 'US',
      },
    },
    headers: {
      'User-Agent': 'com.google.ios.youtube/20.03.02 (iPhone16,2; U; CPU iPhone OS 18_2_1 like Mac OS X)',
      'X-YouTube-Client-Name': '5',
      'X-YouTube-Client-Version': '20.03.02',
    },
  },
];

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}

async function fetchPlayer(videoId, client) {
  const body = {
    videoId,
    context: client.context,
    contentCheckOk: true,
    racyCheckOk: true,
  };

  const res = await fetch(YT_PLAYER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Origin': 'https://www.youtube.com',
      'Referer': 'https://www.youtube.com/',
      ...client.headers,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) return { error: `HTTP ${res.status}` };

  const data = await res.json();

  const playStatus = data?.playabilityStatus?.status;
  if (playStatus && playStatus !== 'OK') {
    return { error: `Not playable: ${data?.playabilityStatus?.reason || playStatus}` };
  }

  // Pick audio-only adaptive formats with direct URL (no signatureCipher)
  const adaptive = (data?.streamingData?.adaptiveFormats || [])
    .filter(f => f.mimeType?.startsWith('audio/') && f.url && !f.signatureCipher)
    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

  if (adaptive.length > 0) {
    return {
      url: adaptive[0].url,
      quality: adaptive[0].audioQuality,
      codec: adaptive[0].mimeType,
      client: client.name,
    };
  }

  // Fallback: combined formats (video+audio)
  const combined = (data?.streamingData?.formats || [])
    .filter(f => f.url && !f.signatureCipher)
    .sort((a, b) => (a.bitrate || 0) - (b.bitrate || 0));

  if (combined.length > 0) {
    return {
      url: combined[0].url,
      quality: combined[0].qualityLabel || 'combined',
      codec: combined[0].mimeType,
      client: client.name,
    };
  }

  return { error: 'No direct URL formats found (all cipher-protected)' };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    if (url.pathname !== '/proxy') {
      return env.ASSETS.fetch(request);
    }

    const videoId = url.searchParams.get('id');
    if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
      return jsonResponse({ error: 'Missing or invalid video id' }, 400);
    }

    const errors = [];
    for (const client of CLIENTS) {
      try {
        const result = await fetchPlayer(videoId, client);
        if (result.url) {
          return jsonResponse(result);
        }
        errors.push(`${client.name}: ${result.error}`);
      } catch (e) {
        errors.push(`${client.name}: ${e.message}`);
      }
    }

    return jsonResponse({ error: 'All clients failed', details: errors }, 502);
  },
};
