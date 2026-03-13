/*
  Simplified dependency-free DottedFly app with basic playlist support and shuffle.
*/

(async function initApp(){
  try {
    // ── Supabase backend ──────────────────────────────────────────────────────
    const SUPABASE_URL = 'https://hwglnarnkyeztvrjbxaf.supabase.co';
    const SUPABASE_KEY = 'sb_publishable_cEATRRrdHDUg6agBVektnw_ARKG8vQl';

    // With new sb_publishable_ keys, Authorization must exactly match apikey (no "Bearer" prefix)
    const _sbHeaders = {
      'apikey': SUPABASE_KEY,
      'Authorization': SUPABASE_KEY,
      'Content-Type': 'application/json',
    };

    // Each collection keeps a local cache so getList() can remain synchronous.
    const _cache = {};

    async function sbFetch(table, qs = '') {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?order=created_at${qs}`, { headers: _sbHeaders });
      if (!res.ok) { console.warn('Supabase fetch error', res.status, await res.text()); return []; }
      return res.json();
    }

    const room = {
      collection: (tableName) => {
        if (!_cache[tableName]) _cache[tableName] = [];

        return {
          // Synchronous — returns whatever is in the local cache right now.
          getList: () => _cache[tableName],

          // Fetch fresh data from Supabase and update the cache.
          subscribe: async (fn) => {
            try {
              const rows = await sbFetch(tableName);
              _cache[tableName] = rows;
              fn(rows);
            } catch(e) { console.warn('subscribe fetch failed', e); fn(_cache[tableName]); }
            return () => {};
          },

          create: async (data) => {
            const res = await fetch(`${SUPABASE_URL}/rest/v1/${tableName}`, {
              method: 'POST',
              headers: { ..._sbHeaders, Prefer: 'return=representation' },
              body: JSON.stringify(data),
            });
            if (!res.ok) {
              const err = await res.text();
              console.error('Supabase create failed', res.status, err);
              alert(`Save failed (${res.status}): ${err}\n\nMake sure you ran the SQL to create the tables in Supabase.`);
              return data;
            }
            const rows = await res.json();
            const rec = Array.isArray(rows) ? rows[0] : rows;
            _cache[tableName] = [..._cache[tableName], rec];
            return rec;
          },

          update: async (id, patch) => {
            const res = await fetch(`${SUPABASE_URL}/rest/v1/${tableName}?id=eq.${id}`, {
              method: 'PATCH',
              headers: { ..._sbHeaders, Prefer: 'return=representation' },
              body: JSON.stringify(patch),
            });
            if (!res.ok) { console.warn('update failed', res.status, await res.text()); return; }
            _cache[tableName] = _cache[tableName].map(r => r.id === id ? { ...r, ...patch } : r);
          },

          delete: async (id) => {
            const res = await fetch(`${SUPABASE_URL}/rest/v1/${tableName}?id=eq.${id}`, {
              method: 'DELETE',
              headers: _sbHeaders,
            });
            if (!res.ok) { console.warn('delete failed', res.status, await res.text()); return; }
            _cache[tableName] = _cache[tableName].filter(r => r.id !== id);
          },

          filter: (field, _op, val) => ({
            getList: () => _cache[tableName].filter(r => r[field] === val),
            subscribe: async (fn) => {
              try {
                const rows = await sbFetch(tableName, `&${field}=eq.${encodeURIComponent(val)}&order=order`);
                // Merge into cache (replace matching rows)
                const others = _cache[tableName].filter(r => r[field] !== val);
                _cache[tableName] = [...others, ...rows];
                fn(rows);
              } catch(e) { console.warn('filter subscribe failed', e); fn([]); }
              return () => {};
            },
          }),
        };
      },
    };
    // ─────────────────────────────────────────────────────────────────────────

    // Simple local account manager (stored in localStorage) — provides login/signup UI with password.
    // currentUser will be an object { username }
    let currentUser = null;

    const LS_USERS = 'dottedfly_users_v1';
    const LS_SESSION = 'dottedfly_session_v1';

    function loadUsers(){ try { return JSON.parse(localStorage.getItem(LS_USERS) || '[]'); } catch(e){ return []; } }
    function saveUsers(u){ localStorage.setItem(LS_USERS, JSON.stringify(u)); }

    function getSession(){ try { return JSON.parse(localStorage.getItem(LS_SESSION) || 'null'); } catch(e){ return null; } }
    function setSession(username){
      if (username === null || typeof username === 'undefined') {
        localStorage.removeItem(LS_SESSION);
      } else {
        localStorage.setItem(LS_SESSION, JSON.stringify({ username }));
      }
    }

    // ensure at least one "guest" user exists
    (function ensureGuest(){
      const users = loadUsers();
      if(!users.find(u=>u.username==='guest')){ users.push({ username: 'guest', password: '', created_at: new Date().toISOString() }); saveUsers(users); }
    })();

    // create an auth modal UI that blocks the app until login/signup
    function showAuthModal(){
      return new Promise((resolve)=>{
        const existing = document.getElementById('auth-modal');
        if(existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'auth-modal';
        overlay.style.position = 'fixed';
        overlay.style.inset = '0';
        overlay.style.display = 'flex';
        overlay.style.alignItems = 'center';
        overlay.style.justifyContent = 'center';
        overlay.style.background = 'rgba(2,6,10,0.7)';
        overlay.style.zIndex = '9999';
        overlay.innerHTML = `
          <div style="width:360px;max-width:92%;background:var(--panel);border-radius:12px;padding:18px;box-shadow:0 8px 40px rgba(0,0,0,0.6);color:var(--muted);">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
              <div>
                <div style="font-weight:700;color:#e6eef1">Welcome to DottedFly</div>
                <div style="font-size:13px;color:var(--muted)">Sign in or create an account</div>
              </div>
              <div style="width:44px;height:44px;border-radius:8px;overflow:hidden;background:#071018;display:flex;align-items:center;justify-content:center">
                <img src="/openfy.png" style="width:100%;height:100%;object-fit:cover">
              </div>
            </div>

            <div style="display:flex;flex-direction:column;gap:8px">
              <input id="auth-username" type="text" placeholder="Username" style="padding:10px;border-radius:8px;border:1px solid rgba(255,255,255,0.03);background:transparent;color:inherit" />
              <input id="auth-password" type="password" placeholder="Password" style="padding:10px;border-radius:8px;border:1px solid rgba(255,255,255,0.03);background:transparent;color:inherit" />
              <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:6px">
                <button id="auth-login" class="btn small">Login</button>
                <button id="auth-signup" class="btn ghost small">Sign up</button>
                <button id="auth-guest" class="btn ghost small">Continue as Guest</button>
              </div>
              <div id="auth-msg" style="font-size:13px;color:var(--muted);margin-top:8px"></div>
            </div>
          </div>
        `;
        document.body.appendChild(overlay);

        function showMsg(m){ const el = document.getElementById('auth-msg'); if(el) el.textContent = m; }

        document.getElementById('auth-login').onclick = ()=>{
          const u = (document.getElementById('auth-username').value||'').trim();
          const p = (document.getElementById('auth-password').value||'');
          if(!u){ showMsg('Enter username'); return; }
          const users = loadUsers();
          const found = users.find(x=> x.username === u);
          if(!found){ showMsg('User not found'); return; }
          if((found.password||'') !== p){ showMsg('Incorrect password'); return; }
          setSession(u);
          currentUser = { username: u };
          overlay.remove();
          resolve(currentUser);
        };

        document.getElementById('auth-signup').onclick = ()=>{
          const u = (document.getElementById('auth-username').value||'').trim();
          const p = (document.getElementById('auth-password').value||'');
          if(!u){ showMsg('Choose a username'); return; }
          if(u.length < 2){ showMsg('Username too short'); return; }
          const users = loadUsers();
          if(users.find(x=> x.username === u)){ showMsg('Username taken'); return; }
          users.push({ username: u, password: p, created_at: new Date().toISOString() });
          saveUsers(users);
          setSession(u);
          currentUser = { username: u };
          overlay.remove();
          resolve(currentUser);
        };

        document.getElementById('auth-guest').onclick = ()=>{
          setSession('guest');
          currentUser = { username: 'guest' };
          overlay.remove();
          resolve(currentUser);
        };

        // allow Enter key to trigger login
        overlay.addEventListener('keydown', (ev)=>{
          if(ev.key === 'Enter'){ document.getElementById('auth-login').click(); }
        });
        // focus first field
        setTimeout(()=> document.getElementById('auth-username').focus(), 50);
      });
    }

    // show auth modal and wait before proceeding
    try {
      const session = getSession();
      if(session && session.username){
        // attempt to auto-restore session; still require passwordless restore for convenience
        currentUser = { username: session.username };
      } else {
        // block further initialization until user logs in / signs up
        currentUser = await showAuthModal();
      }
    } catch(e){
      currentUser = { username: 'guest' };
    }

    // two collections: playlists and tracks. tracks reference playlist_id.
    const playlistsCol = room.collection('dottedfly_playlist_v1');
    const tracksCol = room.collection('dottedfly_track_v1');

    const state = { playlists: [], currentPlaylistId: null, tracks: [], playingId: null, audioEl: null, progress:0, duration:0, isPlaying:false };

    async function syncPlaylists(){
      // refresh cache from Supabase, then filter
      try { const rows = await (async()=>{ const res = await fetch(`${SUPABASE_URL}/rest/v1/dottedfly_playlist_v1?order=created_at`,{headers:_sbHeaders}); return res.ok?res.json():[]; })(); _cache['dottedfly_playlist_v1']=rows; } catch(e){}
      // load all playlists but only show those that are either shared (have a share_code) or were created by the current user
      const list = (playlistsCol.getList ? playlistsCol.getList() : []).slice();
      const filtered = list.filter(p => {
        if(!p) return false;
        if(p.share_code) return true; // shared playlists visible to everyone
        if(currentUser && p.created_by === currentUser.username) return true; // private playlists visible to creator
        return false;
      });
      state.playlists = filtered;
      // set a default playlist if none selected
      if(!state.currentPlaylistId && filtered.length) state.currentPlaylistId = filtered[0].id;
      // if the currently selected playlist no longer exists for this user, clear selection
      if(state.currentPlaylistId && !filtered.find(p=>p.id===state.currentPlaylistId)) state.currentPlaylistId = filtered[0]?.id || null;
      render();
    }
    if(playlistsCol.subscribe) playlistsCol.subscribe(syncPlaylists);
    syncPlaylists();

    async function syncTracks(){
      // refresh cache from Supabase for the current playlist
      try { const rows = await (async()=>{ const res = await fetch(`${SUPABASE_URL}/rest/v1/dottedfly_track_v1?order=order`,{headers:_sbHeaders}); return res.ok?res.json():[]; })(); _cache['dottedfly_track_v1']=rows; } catch(e){}
      const all = (tracksCol.getList ? tracksCol.getList() : []).slice();
      // filter by current playlist
      state.tracks = all.filter(t=> t.playlist_id === state.currentPlaylistId);
      // sort by optional order index
      state.tracks.sort((a,b)=> (a.order||0) - (b.order||0));
      render();
    }
    if(tracksCol.subscribe) tracksCol.subscribe(syncTracks);
    syncTracks();

    // when playlist changes, re-run track sync
    function selectPlaylist(id){
      state.currentPlaylistId = id;
      syncTracks();
    }

    async function createPlaylist(name){
      // create a single playlist record and rely on syncPlaylists to refresh the UI (prevents duplicates)
      const rec = await playlistsCol.create({ name: name || 'New playlist', created_by: currentUser?.username || null });
      // select the new playlist after creation
      state.currentPlaylistId = rec.id;
      // refresh from backend/collection
      syncPlaylists();
      syncTracks();
    }

    // generate a short share code for a playlist and persist it
    async function generateShareCode(playlistId){
      const pl = state.playlists.find(p=> p.id===playlistId);
      if(!pl) return null;
      // short code: base36 of timestamp + first 6 chars of id
      const code = (Date.now()).toString(36) + '-' + pl.id.slice(0,6);
      try {
        if(playlistsCol.update) await playlistsCol.update(pl.id, { share_code: code });
        pl.share_code = code;
      } catch(e){}
      render();
      return code;
    }

    // join a shared playlist by code: finds playlist with share_code and selects it
    async function joinSharedPlaylist(code){
      if(!code) return false;
      const all = playlistsCol.getList ? playlistsCol.getList() : state.playlists.slice();
      const target = all.find(p=> p.share_code === code);
      if(!target) return false;
      // select the shared playlist id directly so it stays in sync with origin
      state.currentPlaylistId = target.id;
      syncTracks();
      render();
      return true;
    }

    async function deletePlaylist(pl){
      if(!confirm(`Delete playlist "${pl.name}" and its tracks?`)) return;
      // remove tracks associated
      const all = tracksCol.getList ? tracksCol.getList() : [];
      all.filter(t=> t.playlist_id===pl.id).forEach(t=> tracksCol.delete && tracksCol.delete(t.id));
      playlistsCol.delete && playlistsCol.delete(pl.id);
      if(state.currentPlaylistId === pl.id) state.currentPlaylistId = (state.playlists.find(p=>p.id!==pl.id)||{}).id || null;
      syncPlaylists(); syncTracks();
    }

    function detectKind(url){
      if(!url) return 'unknown';
      const u = url.toLowerCase();
      if(u.includes('youtube.com')||u.includes('youtu.be')) return 'youtube';
      if(u.includes('soundcloud.com')) return 'soundcloud';
      if(u.includes('spotify.com')) return 'spotify';
      if(u.endsWith('.mp3')||u.includes('blob:')||u.includes('.ogg')||u.includes('.wav')) return 'audio';
      return 'link';
    }

    async function addByUrl(raw){
      const url = raw.trim();
      if(!url || !state.currentPlaylistId) return;
      const kind = detectKind(url);
      let title = url.split('/').pop().split('?')[0] || url;
      let cover_url = null;
      let thumbnail_url = null;

      if(kind === 'youtube'){
        try {
          const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
          const resp = await fetch(oembedUrl);
          if(resp.ok){
            const info = await resp.json();
            if(info.title) title = info.title;
            if(info.thumbnail_url) {
              thumbnail_url = info.thumbnail_url;
              cover_url = info.thumbnail_url;
            }
          }
        } catch (e) {}
      }

      // compute order index to append to end
      const existing = (tracksCol.getList ? tracksCol.getList() : []).filter(t=> t.playlist_id===state.currentPlaylistId);
      const order = existing.length;
      await tracksCol.create({ title, source: url, url, kind, cover_url, thumbnail_url, playlist_id: state.currentPlaylistId, order, created_by: currentUser?.username || null });
      syncTracks();
    }

    async function uploadFile(file){
      if(!file || !state.currentPlaylistId) return;
      let url;
      if(window.websim && window.websim.upload) {
        url = await window.websim.upload(file);
      } else {
        url = URL.createObjectURL(file);
      }
      const title = file.name;
      const existing = (tracksCol.getList ? tracksCol.getList() : []).filter(t=> t.playlist_id===state.currentPlaylistId);
      const order = existing.length;
      await tracksCol.create({ title, source: url, url, kind: 'audio', cover_url: null, playlist_id: state.currentPlaylistId, order, created_by: currentUser?.username || null });
      syncTracks();
    }

    function stopPlayback(){
      if(state.audioEl){
        state.audioEl.pause();
        state.audioEl.src = '';
        state.audioEl.remove();
        state.audioEl = null;
      }
      state.playingId = null; state.isPlaying=false; state.progress=0; state.duration=0;
      render();
    }

    function playTrack(track){
      if(state.audioEl && state.playingId===track.id){
        if(state.isPlaying) state.audioEl.pause(); else state.audioEl.play();
        return;
      }
      if(state.audioEl){
        state.audioEl.pause(); state.audioEl.src=''; state.audioEl.remove(); state.audioEl=null;
      }
      if(track.kind==='audio' || /\.(mp3|ogg|wav)$/i.test(track.url||'')){
        const audio = new Audio(track.url);
        audio.preload='metadata';
        audio.addEventListener('timeupdate', ()=>{ state.progress = audio.currentTime; state.duration = audio.duration || 0; render(); });
        audio.addEventListener('play', ()=>{ state.isPlaying=true; render(); });
        audio.addEventListener('pause', ()=>{ state.isPlaying=false; render(); });
        audio.addEventListener('ended', ()=>{ state.isPlaying=false; nextTrack(); render(); });
        document.body.appendChild(audio);
        state.audioEl = audio; state.playingId = track.id; audio.play().catch(()=>{});
        render();
        return;
      }
      state.playingId = track.id; state.isPlaying = true; render();
    }

    function removeTrack(track){
      if(tracksCol.delete) tracksCol.delete(track.id);
      if(state.playingId===track.id) stopPlayback();
      syncTracks();
    }

    function nextTrack(){
      const idx = state.tracks.findIndex(t=>t.id===state.playingId);
      const next = state.tracks[idx+1] || state.tracks[0] || null;
      if(next) playTrack(next);
    }
    function prevTrack(){
      const idx = state.tracks.findIndex(t=>t.id===state.playingId);
      const prev = state.tracks[idx-1] || state.tracks[state.tracks.length-1] || null;
      if(prev) playTrack(prev);
    }

    // shuffle current playlist order in-place and persist order indices
    async function randomizePlaylist(){
      if(!state.tracks || state.tracks.length<=1) return;
      // Fisher-Yates shuffle
      const arr = state.tracks.slice();
      for(let i=arr.length-1;i>0;i--){
        const j = Math.floor(Math.random()*(i+1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      state.tracks = arr;
      // persist order indexes
      if(tracksCol.update){
        for(let i=0;i<state.tracks.length;i++){
          const rec = state.tracks[i];
          try { await tracksCol.update(rec.id, { order: i }); } catch(e){ /* ignore */ }
        }
      }
      render();
    }

    // YouTube/SoundCloud/Spotify helper functions (unchanged)
    function youtubeEmbed(url){
      let id = null;
      try{
        if(url.includes('youtu.be/')) id = url.split('youtu.be/')[1].split('?')[0];
        else if(url.includes('v=')) id = new URL(url).searchParams.get('v');
        else {
          const m = url.match(/embed\/([^/?&]+)/);
          if(m) id = m[1];
        }
      }catch(e){}
      return id ? `https://www.youtube.com/embed/${id}?rel=0&enablejsapi=1&autoplay=1` : null;
    }
    function soundcloudEmbed(url){ return `https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&auto_play=true`; }
    function spotifyEmbed(url){
      if(url.includes('open.spotify.com')) {
        const parts = url.split('/');
        const id = parts.pop().split('?')[0];
        const type = parts.pop();
        return `https://open.spotify.com/embed/${type}/${id}`;
      }
      return null;
    }

    let _youtubeApiLoaded = false;
    let _soundcloudApiLoaded = false;
    function loadYoutubeApi(){ if(_youtubeApiLoaded) return; _youtubeApiLoaded = true; const s = document.createElement('script'); s.src = "https://www.youtube.com/iframe_api"; document.head.appendChild(s); }
    function loadSoundcloudApi(){ if(_soundcloudApiLoaded) return; _soundcloudApiLoaded = true; const s = document.createElement('script'); s.src = "https://w.soundcloud.com/player/api.js"; document.head.appendChild(s); }

    function setupEmbedFinishDetection(track){
      try {
        if(!track) return;
        if(detectKind(track.source) === 'youtube'){
          loadYoutubeApi();
          const iframe = document.getElementById('yt-player');
          if(!iframe) return;
          function makePlayer(){
            if(typeof YT === 'undefined' || !YT.Player) { setTimeout(makePlayer, 200); return; }
            if(iframe._ytPlayer) return;
            const p = new YT.Player(iframe, {
              events: { onStateChange: function(e){ if(e.data === 0) nextTrack(); } }
            });
            iframe._ytPlayer = p;
          }
          makePlayer();
        }
        if(detectKind(track.source) === 'soundcloud'){
          loadSoundcloudApi();
          const iframe = document.getElementById('sc-player');
          if(!iframe) return;
          function makeSC(){
            if(typeof SC === 'undefined' || !SC.Widget) { setTimeout(makeSC,200); return; }
            if(iframe._scWidget) return;
            const widget = SC.Widget(iframe);
            widget.bind(SC.Widget.Events.FINISH, function(){ nextTrack(); });
            iframe._scWidget = widget;
          }
          makeSC();
        }
      } catch (e) { console.warn('embed finish detection failed', e); }
    }

    function formatTime(t){ if(!t || isNaN(t)) return '0:00'; const s = Math.floor(t%60).toString().padStart(2,'0'); const m = Math.floor(t/60); return `${m}:${s}`; }
    function seekTo(v){ if(state.audioEl){ state.audioEl.currentTime = v; state.progress = v; render(); } }

    // DOM rendering (vanilla) - now includes playlist controls and shuffle
    function render(){
      const root = document.getElementById('app');
      root.innerHTML = '';

      // If no authenticated user/session, show only a minimal auth prompt UI
      if(!currentUser || !currentUser.username){
        const authPanel = document.createElement('div');
        authPanel.style.maxWidth = '420px';
        authPanel.style.margin = '40px auto';
        authPanel.style.background = 'var(--panel)';
        authPanel.style.padding = '18px';
        authPanel.style.borderRadius = '12px';
        authPanel.style.boxShadow = '0 8px 30px rgba(0,0,0,0.6)';
        authPanel.innerHTML = `
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
            <div style="width:56px;height:56px;border-radius:10px;overflow:hidden;background:#071018;display:flex;align-items:center;justify-content:center">
              <img src="/openfy.png" style="width:100%;height:100%;object-fit:cover">
            </div>
            <div>
              <div style="font-weight:700;color:#e6eef1">DottedFly</div>
              <div style="font-size:13px;color:var(--muted)">Sign in or create an account to see your playlists</div>
            </div>
          </div>
          <div style="display:flex;gap:8px;margin-bottom:12px">
            <button id="quickSignIn" class="btn small" style="flex:1">Sign in</button>
            <button id="quickSignUp" class="btn ghost small" style="flex:1">Sign up</button>
          </div>
          <div style="display:flex;gap:8px;justify-content:center">
            <button id="quickGuest" class="btn ghost small">Continue as Guest</button>
          </div>
        `;
        root.appendChild(authPanel);

        // hook up quick buttons to reuse the modal logic
        document.getElementById('quickSignIn').onclick = async () => {
          try {
            const user = await showAuthModal();
            currentUser = user;
          } catch (e) {
            currentUser = { username: 'guest' };
          }
          syncPlaylists();
          syncTracks();
          render();
        };
        document.getElementById('quickSignUp').onclick = async () => {
          try {
            const user = await showAuthModal();
            currentUser = user;
          } catch (e) {
            currentUser = { username: 'guest' };
          }
          syncPlaylists();
          syncTracks();
          render();
        };
        document.getElementById('quickGuest').onclick = () => {
          setSession('guest');
          currentUser = { username: 'guest' };
          syncPlaylists();
          syncTracks();
          render();
        };

        return;
      }

      const container = document.createElement('div');
      container.className = 'player';
      container.setAttribute('role','application');

      // LEFT
      const left = document.createElement('div'); left.className='left';
      left.innerHTML = `
        <div class="header">
          <div class="brand">
            <div class="logo"><img src="/openfy.png" alt="DottedFly"></div>
            <div>
              <div class="title">DottedFly</div>
              <div class="subtitle">Playlists — saved automatically</div>
            </div>
          </div>
        </div>
        <div class="playlist-controls">
          <select id="playlistSelect"></select>
          <button id="newPlaylist" class="btn ghost small">New</button>
          <button id="delPlaylist" class="btn ghost small">Delete</button>
          <button id="shareBtn" class="btn ghost small" title="Generate share code for this playlist">Share</button>
        </div>
        <div style="display:flex;gap:8px;margin-top:8px">
          <input id="importCode" type="text" placeholder="Paste share code to join" style="flex:1;padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,0.03);background:transparent;color:inherit" />
          <button id="joinBtn" class="btn small">Join</button>
        </div>
        <div class="add-row">
          <input id="urlInput" type="text" placeholder="Paste YouTube / SoundCloud / Spotify / direct mp3 URL" />
          <button id="addUrlBtn" class="btn small">Add</button>
        </div>
        <div class="file-input">
          <label for="file" class="btn ghost small">Upload MP3</label>
          <input id="file" type="file" accept="audio/*" style="display:none" />
          <button id="refreshBtn" class="btn ghost small">Refresh</button>
          <button id="shuffleBtn" class="btn ghost small">Randomize</button>
        </div>
        <div class="track-list" id="trackList"></div>
        <div class="footer">
          <div class="small-muted">Signed in as ${currentUser ? currentUser.username : 'guest'}</div>
          <div style="display:flex;gap:8px">
            <button id="stopBtn" class="btn small">Stop</button>
            <button id="clearMine" class="btn small">Clear mine</button>
            <button id="signOutBtn" class="btn ghost small">Sign out</button>
          </div>
        </div>
      `;
      container.appendChild(left);

      // RIGHT
      const right = document.createElement('div'); right.className='right';
      const nowTrack = state.tracks.find(t=>t.id===state.playingId) || null;
      right.innerHTML = `
        <div class="player-area">
          <div class="now-playing">
            <div class="now-art">${ nowTrack ? (() => {
              const thumb = nowTrack.thumbnail_url || nowTrack.cover_url || '/openfy.png';
              return `<img src="${thumb}" style="width:100%;height:100%;object-fit:cover">`;
            })() : `<div style="color:var(--muted)">No track</div>` }</div>
            <div class="now-meta">
              <div style="font-weight:700">${ nowTrack ? escapeHtml(nowTrack.title) : 'Nothing selected' }</div>
              <div class="small-muted">${ nowTrack ? escapeHtml(nowTrack.source) : 'Add a track to start listening' }</div>
              <div style="display:flex;gap:8px;margin-top:8px">
                <button id="prevBtn" class="btn small">Prev</button>
                <button id="playToggle" class="btn small">${state.isPlaying ? '⏸' : '▶'}</button>
                <button id="nextBtn" class="btn small">Next</button>
              </div>
            </div>
          </div>

          <div class="seek" style="align-items:center">
            <div class="small-muted">${formatTime(state.progress)}</div>
            <input id="seekRange" class="range" type="range" min=0 max=${state.duration||0} value=${state.progress||0} />
            <div class="small-muted">${formatTime(state.duration)}</div>
          </div>

          <div style="flex:1;display:flex;flex-direction:column;gap:8px">
            <div style="flex:1;overflow:hidden;border-radius:8px;border:1px solid rgba(255,255,255,0.02);background:transparent;padding:6px" id="embedArea"></div>
          </div>
        </div>
        <div style="display:flex;justify-content:flex-end;align-items:center;gap:8px">
          <div class="small-muted">DottedFly — saved to your workspace</div>
        </div>
      `;
      container.appendChild(right);

      root.appendChild(container);

      // populate playlist select
      const playlistSelect = document.getElementById('playlistSelect');
      playlistSelect.innerHTML = '';
      if(state.playlists.length === 0){
        playlistSelect.innerHTML = '<option value="">(no playlists)</option>';
      } else {
        state.playlists.forEach(p => {
          const opt = document.createElement('option');
          opt.value = p.id;
          opt.textContent = p.name || 'Playlist';
          if(p.id === state.currentPlaylistId) opt.selected = true;
          playlistSelect.appendChild(opt);
        });
      }

      // populate track list
      const trackList = document.getElementById('trackList');
      if(state.tracks.length===0){
        trackList.innerHTML = `<div class="empty">No tracks in this playlist — add a link or upload a file</div>`;
      } else {
        trackList.innerHTML = '';
        state.tracks.forEach((t, index)=>{
          const div = document.createElement('div');
          div.className='track';
          div.title = t.title || '';
          div.setAttribute('draggable', 'true');
          div.dataset.id = t.id;
          div.innerHTML = `
            <div style="width:44px;height:44px;border-radius:6px;background:linear-gradient(135deg,#0b2b2b,#071018);display:flex;align-items:center;justify-content:center;font-weight:700;color:var(--muted)">${ (t.title||'T')[0].toUpperCase() }</div>
            <div class="meta">
              <div class="title">${escapeHtml(t.title||'Untitled')}</div>
              <div class="source">${escapeHtml(t.kind)} • ${escapeHtml((t.source||'').split('/')[2]||t.source||'')}</div>
            </div>
            <div class="track-actions">
              <button class="btn ghost small playBtn">${ state.playingId===t.id && state.isPlaying ? 'Playing' : 'Play' }</button>
              <button class="btn ghost small delBtn">Delete</button>
            </div>
          `;
          const playBtn = div.querySelector('.playBtn');
          const delBtn = div.querySelector('.delBtn');
          playBtn.onclick = ()=> playTrack(t);
          delBtn.onclick = ()=> { if(confirm('Delete this track?')) removeTrack(t); };

          // drag handlers
          div.addEventListener('dragstart', (ev)=>{
            ev.dataTransfer.setData('text/plain', t.id);
            div.classList.add('dragging');
          });
          div.addEventListener('dragend', ()=>{
            div.classList.remove('dragging');
            const newOrderIds = Array.from(trackList.children).map(ch => ch.dataset.id);
            persistReorder(newOrderIds);
          });
          div.addEventListener('dragover', (ev)=>{
            ev.preventDefault();
            const dragging = trackList.querySelector('.dragging');
            if(!dragging || dragging === div) return;
            const rect = div.getBoundingClientRect();
            const middle = rect.top + rect.height/2;
            const parent = div.parentNode;
            if(ev.clientY < middle) parent.insertBefore(dragging, div);
            else parent.insertBefore(dragging, div.nextSibling);
          });
          div.addEventListener('drop', (ev)=>{
            ev.preventDefault();
            const draggedId = ev.dataTransfer.getData('text/plain');
            if(!draggedId) return;
            const newOrderIds = Array.from(trackList.children).map(ch => ch.dataset.id);
            persistReorder(newOrderIds);
          });

          trackList.appendChild(div);
        });

        async function persistReorder(newOrderIds){
          try {
            const stored = tracksCol.getList ? tracksCol.getList() : state.tracks.slice();
            const map = {};
            stored.forEach(r=> map[r.id]=r);
            const ordered = newOrderIds.map(id=> map[id]).filter(Boolean);
            state.tracks = ordered.concat(stored.filter(r => !newOrderIds.includes(r.id) && r.playlist_id===state.currentPlaylistId));
            render();
            if(tracksCol.update){
              for(let i=0;i<state.tracks.length;i++){
                const rec = state.tracks[i];
                try { await tracksCol.update(rec.id, { order: i }); } catch(e){ }
              }
            } else if(tracksCol.delete && tracksCol.create){
              const allStored = tracksCol.getList ? tracksCol.getList() : [];
              const playlistStored = allStored.filter(r=> r.playlist_id===state.currentPlaylistId);
              playlistStored.forEach(r=> tracksCol.delete && tracksCol.delete(r.id));
              for(const r of state.tracks){
                await tracksCol.create({...r, playlist_id: state.currentPlaylistId});
              }
            }
            syncTracks();
          } catch (e) { console.warn('persistReorder failed', e); render(); }
        }
      }

      // embed area
      const embedArea = document.getElementById('embedArea');
      if(nowTrack){
        if(nowTrack.kind==='audio'){
          embedArea.innerHTML = `<audio src="${nowTrack.url}" controls style="width:100%"></audio>`;
        } else if(detectKind(nowTrack.source)==='youtube'){
          const src = youtubeEmbed(nowTrack.source);
          embedArea.innerHTML = src ? `<iframe id="yt-player" src="${src}" title="YouTube" style="width:100%;height:220px;border:0" allow="autoplay; encrypted-media" allowfullscreen></iframe>` : linkHtml(nowTrack.source);
        } else if(detectKind(nowTrack.source)==='soundcloud'){
          const src = soundcloudEmbed(nowTrack.source);
          embedArea.innerHTML = `<iframe id="sc-player" width="100%" height="200" scrolling="no" frameborder="no" src="${src}"></iframe>`;
        } else if(detectKind(nowTrack.source)==='spotify'){
          const src = spotifyEmbed(nowTrack.source);
          embedArea.innerHTML = src ? `<iframe id="sp-player" src="${src}" width="100%" height="232" frameborder="0" allowtransparency="true" allow="encrypted-media"></iframe>` : linkHtml(nowTrack.source);
        } else {
          embedArea.innerHTML = linkHtml(nowTrack.source);
        }
        setTimeout(()=> setupEmbedFinishDetection(nowTrack), 300);
      } else {
        embedArea.innerHTML = `<div style="padding:18px;color:var(--muted)">Select a track to embed or play uploaded MP3s directly.</div>`;
      }

      // attach handlers
      document.getElementById('addUrlBtn').onclick = async ()=>{ const v = document.getElementById('urlInput').value.trim(); if(v){ await addByUrl(v); document.getElementById('urlInput').value=''; } };
      document.getElementById('file').onchange = async (e)=>{ const f = e.target.files[0]; if(f){ await uploadFile(f); e.target.value=''; } };
      document.getElementById('refreshBtn').onclick = ()=> { syncPlaylists(); syncTracks(); };
      document.getElementById('stopBtn').onclick = ()=> stopPlayback();
      document.getElementById('clearMine').onclick = ()=> {
        if(confirm('Clear all tracks you created?')){
          const all = tracksCol.getList ? tracksCol.getList() : [];
          all.filter(t=> t.created_by===currentUser?.username && t.playlist_id===state.currentPlaylistId ).forEach(t=> tracksCol.delete && tracksCol.delete(t.id));
          syncTracks();
        }
      };
      // Sign out handler: clear session and reopen auth modal to allow login/signup
      const signOutBtn = document.getElementById('signOutBtn');
      if (signOutBtn) {
        signOutBtn.onclick = async () => {
          if (!confirm('Sign out?')) return;
          // clear session and immediately switch UI to signed-out state
          setSession(null);
          currentUser = null;
          // stop any playing audio and render the auth prompt immediately
          try { stopPlayback(); } catch(e){}
          render();
          // show auth modal and wait for new session
          try {
            const user = await showAuthModal();
            currentUser = user;
          } catch (e) {
            currentUser = { username: 'guest' };
          }
          // refresh visible data for the newly signed-in user
          syncPlaylists();
          syncTracks();
          render();
        };
      }
      document.getElementById('prevBtn').onclick = ()=> prevTrack();
      document.getElementById('nextBtn').onclick = ()=> nextTrack();
      document.getElementById('playToggle').onclick = ()=> {
        if(!state.playingId) return;
        if(state.isPlaying) state.audioEl && state.audioEl.pause(); else state.audioEl && state.audioEl.play();
      };
      const seekRange = document.getElementById('seekRange');
      seekRange.oninput = (e)=> seekTo(Number(e.target.value));

      // playlist controls
      document.getElementById('newPlaylist').onclick = ()=> { const name = prompt('Playlist name') || 'New playlist'; createPlaylist(name); };
      document.getElementById('delPlaylist').onclick = ()=> {
        const pl = state.playlists.find(p=> p.id===state.currentPlaylistId);
        if(pl) deletePlaylist(pl);
      };
      playlistSelect.onchange = (e)=> { selectPlaylist(e.target.value); };
      document.getElementById('shuffleBtn').onclick = ()=> { randomizePlaylist(); };

      // share / join handlers
      const shareBtn = document.getElementById('shareBtn');
      if(shareBtn){
        shareBtn.onclick = async ()=> {
          const pl = state.playlists.find(p=> p.id===state.currentPlaylistId);
          if(!pl){ alert('No playlist selected'); return; }
          const code = pl.share_code || await generateShareCode(pl.id);
          try {
            await navigator.clipboard.writeText(code);
            alert('Share code copied: ' + code);
          } catch(e){
            prompt('Share code (copy manually):', code);
          }
        };
      }
      const joinBtn = document.getElementById('joinBtn');
      if(joinBtn){
        joinBtn.onclick = async ()=> {
          const code = (document.getElementById('importCode').value||'').trim();
          if(!code){ alert('Paste a share code first'); return; }
          const ok = await joinSharedPlaylist(code);
          if(!ok) alert('Invalid share code');
        };
      }
    }

    function linkHtml(url){ return `<div style="padding:12px;color:var(--muted)"><a href="${escapeAttr(url)}" target="_blank" rel="noopener" style="color:inherit">${escapeHtml(url)}</a></div>`; }

    function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
    function escapeAttr(s){ return escapeHtml(s).replace(/"/g,'&quot;'); }

    // initial render
    render();

  } catch (err) {
    console.error('DottedFly init error:', err);
    const root = document.getElementById('app');
    if (root) {
      root.innerHTML = `<div style="padding:20px;color:#fff;background:#111;border-radius:8px;max-width:800px;margin:20px auto;font-family:sans-serif"><h3 style="margin:0 0 8px">DottedFly failed to start</h3><div style="color:#bbb">An error occurred while initializing the app. Open the console for details.</div></div>`;
    }
  }
})();
