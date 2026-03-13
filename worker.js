// DottedFly worker.js
// Handles /proxy?id=VIDEO_ID for Blocked Mode audio fetching.
// All other requests fall through to static assets (your site files).

const PIPED_INSTANCES = [
  'https://pipedapi.kavin.rocks',
  'https://api.piped.projectsegfau.lt',
  'https://pipedapi.tokhmi.xyz',
  'https://pipedapi.moomoo.me',
  'https://piped-api.garudalinux.org',
  'https://pa.il.ax',
  'https://pipedapi.syncpundit.io',
  'https://api.piped.yt',
];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json',
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    // Only intercept /proxy — everything else goes to your static site
    if (url.pathname !== '/proxy') {
      return env.ASSETS.fetch(request);
    }

    const videoId = url.searchParams.get('id');
    if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
      return jsonResponse({ error: 'Missing or invalid video id' }, 400);
    }

    for (const instance of PIPED_INSTANCES) {
      try {
        const res = await fetch(`${instance}/streams/${videoId}`, {
          headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
          signal: AbortSignal.timeout(8000),
        });

        if (!res.ok) continue;

        const data = await res.json();

        const audioStreams = (data.audioStreams || [])
          .filter(s => s.url && !s.videoOnly)
          .sort((a, b) => (parseInt(b.bitrate) || 0) - (parseInt(a.bitrate) || 0));

        if (audioStreams.length > 0) {
          return jsonResponse({
            url: audioStreams[0].url,
            quality: audioStreams[0].quality,
            codec: audioStreams[0].codec,
            instance,
          });
        }
      } catch (_) {
        // try next instance
      }
    }

    return jsonResponse({ error: 'All Piped instances failed' }, 502);
  },
};
