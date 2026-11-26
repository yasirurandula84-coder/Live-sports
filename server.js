const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

// matchId -> Set of active socket.id values
const matchActiveSockets = {};
const matchTotalViews = {};
const matchChatHistories = {};

function getMatchLiveCount(matchId) {
    return matchActiveSockets[matchId] ? matchActiveSockets[matchId].size : 0;
}

const ADMIN_STATS_KEY = process.env.ADMIN_PANEL_KEY || 'streamx-admin-2026';

function isAuthorizedAdmin(req) {
    const keyFromHeader = req.get('x-admin-key') || '';
    const keyFromQuery = typeof req.query.key === 'string' ? req.query.key : '';
    const provided = (keyFromHeader || keyFromQuery).trim();
    return Boolean(provided && provided === ADMIN_STATS_KEY);
}

const TAPMAD_PLAYLIST_URL = 'http://2nd.sm-monirul.top/@sm_iptv_bd/exp.php?tapmad=getPlaylist&sm=.m3u';
let tapmadCache = { data: null, expiresAt: 0 };
const approvedStreamUrls = new Set();

const CRICBUZZ_API_URL = (process.env.CRICBUZZ_API_URL || 'https://cricbuzz-scraper-kkkw.onrender.com').replace(/\/+$/, '');
let cricbuzzLiveCache = { data: null, expiresAt: 0 };
const cricbuzzRankingsCache = new Map();

const FOOTBALL_API_BASE = (process.env.FOOTBALL_API_BASE || 'https://football-live-api-wm4o.onrender.com').replace(/\/+$/, '');
let footballLiveCache = { data: null, expiresAt: 0 };

const UPSTREAM_STREAM_HEADERS = {
    'User-Agent': 'VLC/3.0.20 LibVLC/3.0.20',
    'Accept': '*/*',
    'Accept-Encoding': 'identity',
    'Connection': 'keep-alive'
};

const ALLOWED_STREAM_HOSTS = ['localhost', '127.0.0.1', 'streamx.website', 'www.streamx.website'];

function hasAllowedReferer(req) {
    const referer = req.get('referer') || '';
    if (!referer) return false;
    try {
        const parsed = new URL(referer);
        const host = (parsed.hostname || '').toLowerCase();
        return ALLOWED_STREAM_HOSTS.includes(host);
    } catch (e) {
        return false;
    }
}

const STREAM_TOKEN_SECRET = process.env.STREAM_TOKEN_SECRET || crypto.randomBytes(32).toString('hex');
const STREAM_TOKEN_TTL_MS = 90 * 1000;
const streamTokenRegistry = new Map();

function registerApprovedStreamUrl(url) {
    const clean = String(url || '').trim();
    if (/^https?:\/\//i.test(clean)) {
        approvedStreamUrls.add(clean);
    }
}

function isApprovedStreamUrl(url) {
    const clean = String(url || '').trim();
    if (!/^https?:\/\//i.test(clean)) return false;
    if (approvedStreamUrls.has(clean)) return true;
    try {
        const targetOrigin = new URL(clean).origin;
        for (const allowed of approvedStreamUrls) {
            if (allowed === clean || allowed.startsWith(targetOrigin)) {
                return true;
            }
        }
    } catch (e) {}
    return false;
}

function createStreamToken(targetUrl, extraHeaders = {}) {
    const cleanUrl = String(targetUrl || '').trim();
    if (!cleanUrl) return null;

    registerApprovedStreamUrl(cleanUrl);

    const now = Date.now();
    for (const [key, entry] of streamTokenRegistry.entries()) {
        if (entry.expiresAt <= now) {
            streamTokenRegistry.delete(key);
        }
    }

    const randomPart = crypto.randomBytes(16).toString('hex');
    const sigPart = crypto
        .createHmac('sha256', STREAM_TOKEN_SECRET)
        .update(`${randomPart}:${cleanUrl}`)
        .digest('hex')
        .slice(0, 16);

    const token = `${randomPart}.${sigPart}`;
    const expiresAt = now + STREAM_TOKEN_TTL_MS;
    const cleanKid = String(extraHeaders.kid || '').trim().replace(/-/g, '').toLowerCase();
    const cleanKey = String(extraHeaders.key || '').trim().replace(/-/g, '').toLowerCase();

    streamTokenRegistry.set(token, {
        url: cleanUrl,
        expiresAt,
        userAgent: String(extraHeaders.userAgent || '').trim(),
        referer: String(extraHeaders.referer || '').trim(),
        kid: cleanKid,
        key: cleanKey
    });
    return token;
}

function resolveStreamToken(token) {
    if (!token || typeof token !== 'string') return null;
    const entry = streamTokenRegistry.get(token);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
        streamTokenRegistry.delete(token);
        return null;
    }
    return entry.url;
}

async function getMatchesDataFromGitHub() {
    try {
        const response = await fetch('https://api.github.com/repos/yasirurandula84-coder/Datay/contents/matches.json', {
            headers: {
                'Authorization': `token ${process.env.GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3.raw'
            }
        });

        if (!response.ok) throw new Error('Failed to fetch from GitHub');
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Error fetching matches from GitHub:', error);
        return {};
    }
}

function parseM3uPlaylist(rawText) {
    const lines = String(rawText || '')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);

    const channels = [];
    let pendingName = '';
    let pendingLogo = '';
    let pendingGroup = 'Live TV';
    let pendingKid = '';
    let pendingKey = '';
    let pendingReferer = '';
    let pendingUserAgent = '';

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (line.startsWith('#EXTINF:')) {
            const logoMatch = line.match(/tvg-logo="([^"]*)"/i);
            const groupMatch = line.match(/group-title="([^"]*)"/i);
            pendingLogo = logoMatch ? logoMatch[1].trim() : '';
            pendingGroup = groupMatch && groupMatch[1].trim() ? groupMatch[1].trim() : 'Live TV';

            const commaIdx = line.lastIndexOf(',');
            pendingName = commaIdx !== -1
                ? line.slice(commaIdx + 1).trim()
                : `Channel ${channels.length + 1}`;
        } else if (line.startsWith('#KODIPROP:')) {
            const keyMatch = line.match(/([0-9a-fA-F]{32}):([0-9a-fA-F]{32})/);
            if (keyMatch) {
                pendingKid = keyMatch[1].toLowerCase();
                pendingKey = keyMatch[2].toLowerCase();
            }
        } else if (line.startsWith('#EXTVLCOPT:')) {
            const optContent = line.replace(/^#EXTVLCOPT:/i, '').trim();
            const lowerOpt = optContent.toLowerCase();
            if (lowerOpt.startsWith('http-referrer=')) {
                pendingReferer = optContent.slice('http-referrer='.length).trim();
            } else if (lowerOpt.startsWith('http-user-agent=')) {
                pendingUserAgent = optContent.slice('http-user-agent='.length).trim();
            }
        } else if (!line.startsWith('#')) {
            const rawStreamUrl = line.trim();
            registerApprovedStreamUrl(rawStreamUrl);

            const titleName = pendingName || `Channel ${channels.length + 1}`;
            const streamToken = createStreamToken(rawStreamUrl, {
                userAgent: pendingUserAgent,
                referer: pendingReferer,
                kid: pendingKid,
                key: pendingKey
            });
            const isMpd = rawStreamUrl.toLowerCase().includes('.mpd') || Boolean(pendingKid && pendingKey);
            const streamUrl = isMpd
                ? `/mpd-proxy?token=${encodeURIComponent(streamToken)}`
                : `/hls-proxy?token=${encodeURIComponent(streamToken)}`;

            channels.push({
                id: `tv-${channels.length + 1}`,
                name: titleName,
                title: titleName,
                logo: pendingLogo,
                group: pendingGroup,
                stream_url: streamUrl
            });

            pendingName = '';
            pendingLogo = '';
            pendingGroup = 'Live TV';
            pendingKid = '';
            pendingKey = '';
            pendingReferer = '';
            pendingUserAgent = '';
        }
    }

    return channels;
}

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/category/:name', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'category.html'));
});

app.get('/match', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'match.html'));
});

app.get('/profile', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'profile.html'));
});

app.get('/ranking', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'ranking.html'));
});

app.get('/admin-views', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin-views.html'));
});

app.get('/api/admin/views-stats', (req, res) => {
    if (!isAuthorizedAdmin(req)) {
        return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }

    const allMatchIds = new Set([
        ...Object.keys(matchActiveSockets),
        ...Object.keys(matchTotalViews)
    ]);

    const rows = Array.from(allMatchIds).map((matchId) => {
        const liveNow = getMatchLiveCount(matchId);
        const totalViews = matchTotalViews[matchId] || 0;
        const chatCount = Array.isArray(matchChatHistories[matchId])
            ? matchChatHistories[matchId].length
            : 0;

        return {
            matchId,
            liveNow,
            totalViews,
            chatCount
        };
    });

    rows.sort((a, b) => (b.liveNow - a.liveNow) || (b.totalViews - a.totalViews));

    const summary = rows.reduce(
        (acc, r) => {
            acc.totalLiveNow += r.liveNow;
            acc.totalAllViews += r.totalViews;
            acc.totalChats += r.chatCount;
            return acc;
        },
        { totalLiveNow: 0, totalAllViews: 0, totalChats: 0 }
    );

    return res.json({
        ok: true,
        updatedAt: new Date().toISOString(),
        summary,
        matches: rows
    });
});

app.get('/api/football/live', async (req, res) => {
    const tz = String(req.query.timezone || 'Asia/Colombo');
    const now = Date.now();

    if (footballLiveCache.data && footballLiveCache.tz === tz && now < footballLiveCache.expiresAt) {
        return res.json(footballLiveCache.data);
    }

    try {
        const apiUrl = `${FOOTBALL_API_BASE}/api/matches/live?timezone=${encodeURIComponent(tz)}`;
        const response = await fetch(apiUrl, {
            headers: { 'Accept': 'application/json' },
            signal: AbortSignal.timeout(12000)
        });

        if (!response.ok) {
            return res.status(502).json({
                ok: false,
                success: false,
                error: `Upstream football API returned ${response.status}`
            });
        }

        const payload = await response.json();
        const leagues = Array.isArray(payload?.data?.leagues) ? payload.data.leagues : [];

        const matches = [];
        for (const league of leagues) {
            for (const m of league.matches || []) {
                matches.push({
                    id: m.id,
                    league: league.name || '',
                    leagueLogo: league.logo || '',
                    homeName: m.home?.name || m.home?.shortName || 'Home',
                    homeScore: m.home?.score ?? 0,
                    homeLogo: m.home?.logo || '',
                    awayName: m.away?.name || m.away?.shortName || 'Away',
                    awayScore: m.away?.score ?? 0,
                    awayLogo: m.away?.logo || '',
                    scoreStr: m.status?.scoreStr || `${m.home?.score ?? 0} - ${m.away?.score ?? 0}`,
                    statusText: m.statusText || m.status?.liveTime?.short || 'LIVE',
                    isLive: Boolean(m.isLive ?? m.status?.ongoing)
                });
            }
        }

        const result = {
            ok: true,
            success: true,
            updatedAt: payload.updatedAt || new Date().toISOString(),
            total: matches.length,
            matches
        };

        footballLiveCache = {
            tz,
            data: result,
            expiresAt: now + 25 * 1000
        };

        return res.json(result);
    } catch (error) {
        console.error('[FOOTBALL-LIVE] Error:', error.message);
        if (footballLiveCache.data) {
            return res.json({ ...footballLiveCache.data, stale: true });
        }
        return res.status(502).json({
            ok: false,
            success: false,
            error: 'Failed to reach football live API'
        });
    }
});

app.get('/api/cricbuzz-live', async (req, res) => {
    const now = Date.now();
    if (cricbuzzLiveCache.data && now < cricbuzzLiveCache.expiresAt) {
        return res.json({ ok: true, data: cricbuzzLiveCache.data });
    }

    try {
        const response = await fetch(`${CRICBUZZ_API_URL}/matches/live`, {
            headers: { 'Accept': 'application/json' },
            signal: AbortSignal.timeout(20000)
        });

        if (!response.ok) {
            return res.status(502).json({
                ok: false,
                error: `Upstream Cricbuzz API returned ${response.status}`
            });
        }

        const data = await response.json();
        cricbuzzLiveCache = {
            data,
            expiresAt: now + 15 * 1000
        };

        return res.json({ ok: true, data });
    } catch (error) {
        console.error('Cricbuzz live proxy error:', error.message);
        return res.status(502).json({
            ok: false,
            error: 'Failed to reach Cricbuzz scraper'
        });
    }
});

app.get('/api/cricbuzz-rankings', async (req, res) => {
    const category = String(req.query.category || 'batting').trim().toLowerCase() || 'batting';
    const gender = String(req.query.gender || 'men').trim().toLowerCase() || 'men';
    const cacheKey = `${category}:${gender}`;
    const now = Date.now();

    const cached = cricbuzzRankingsCache.get(cacheKey);
    if (cached && now < cached.expiresAt) {
        return res.json({ ok: true, data: cached.data });
    }

    try {
        const upstreamUrl = `${CRICBUZZ_API_URL}/rankings?category=${encodeURIComponent(category)}&gender=${encodeURIComponent(gender)}`;
        const response = await fetch(upstreamUrl, {
            headers: { 'Accept': 'application/json' },
            signal: AbortSignal.timeout(25000)
        });

        if (!response.ok) {
            return res.status(502).json({
                ok: false,
                error: `Upstream Cricbuzz rankings returned ${response.status}`
            });
        }

        const data = await response.json();
        cricbuzzRankingsCache.set(cacheKey, {
            data,
            expiresAt: now + 30 * 1000
        });

        return res.json({ ok: true, data });
    } catch (error) {
        console.error('Cricbuzz rankings proxy error:', error.message);
        return res.status(502).json({
            ok: false,
            error: 'Failed to reach Cricbuzz rankings endpoint'
        });
    }
});

app.get('/api/tapmad-playlist', async (req, res) => {
    const now = Date.now();
    if (tapmadCache.data && now < tapmadCache.expiresAt) {
        return res.json(tapmadCache.data);
    }

    try {
        const response = await fetch(TAPMAD_PLAYLIST_URL, {
            headers: UPSTREAM_STREAM_HEADERS,
            signal: AbortSignal.timeout(15000)
        });

        if (!response.ok) {
            return res.status(502).json({
                ok: false,
                error: `Upstream playlist returned ${response.status}`,
                channels: []
            });
        }

        const rawM3u = await response.text();
        const channels = parseM3uPlaylist(rawM3u);

        const payload = {
            ok: true,
            count: channels.length,
            channels
        };

        tapmadCache = {
            data: payload,
            expiresAt: now + 30 * 1000
        };

        return res.json(payload);
    } catch (error) {
        console.error('Tapmad playlist error:', error);
        return res.status(500).json({
            ok: false,
            error: 'Failed to fetch playlist',
            channels: []
        });
    }
});

app.get('/img-proxy', async (req, res) => {
    const rawUrl = req.query.url;
    if (!rawUrl) {
        return res.status(400).send('Missing url parameter');
    }

    const targetUrl = rawUrl.trim().replace(/^http:\/\//i, 'https://');

    try {
        const response = await fetch(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
                'Referer': 'https://www.sofascore.com/'
            }
        });

        if (!response.ok) {
            return res.status(response.status).send('Failed to fetch image');
        }

        const contentType = response.headers.get('content-type') || 'image/png';
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.setHeader('Access-Control-Allow-Origin', '*');

        const buffer = await response.arrayBuffer();
        return res.send(Buffer.from(buffer));
    } catch (error) {
        console.error('Image proxy error:', error);
        return res.status(502).send('Image proxy failed');
    }
});

// --- Fast DASH (.mpd) Manifest Proxy Route (Referer Guard + Token Required + DRM Key Header) ---
app.get('/mpd-proxy', async (req, res) => {
    if (!hasAllowedReferer(req)) {
        return res.status(403).send('Forbidden');
    }

    const token = req.query.token;
    const targetUrl = resolveStreamToken(token);

    if (!targetUrl) {
        return res.status(403).send('Stream token expired or invalid');
    }

    try {
        const tokenEntry = streamTokenRegistry.get(token);
        const response = await fetch(targetUrl, {
            headers: {
                'User-Agent': (tokenEntry && tokenEntry.userAgent) || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept': 'application/dash+xml,application/xml,text/xml,*/*',
                'Referer': (tokenEntry && tokenEntry.referer) || (new URL(targetUrl).origin + '/')
            },
            redirect: 'follow',
            signal: AbortSignal.timeout(15000)
        });

        if (!response.ok) {
            return res.status(response.status).send(`MPD upstream error ${response.status}`);
        }

        let xmlText = await response.text();
        const effectiveBase = response.url || targetUrl;
        const baseDir = effectiveBase.substring(0, effectiveBase.lastIndexOf('/') + 1);

        xmlText = xmlText.replace(/<BaseURL([^>]*)>([^<]+)<\/BaseURL>/gi, (match, attrs, relUrl) => {
            const trimmed = relUrl.trim();
            if (/^https?:\/\//i.test(trimmed)) return match;
            const absUrl = new URL(trimmed, baseDir).toString();
            return `<BaseURL${attrs}>${absUrl}</BaseURL>`;
        });

        if (!/<BaseURL[\s>]/i.test(xmlText)) {
            xmlText = xmlText.replace(
                /<Period([^>]*)>/i,
                `<Period$1>\n    <BaseURL>${baseDir}</BaseURL>`
            );
        }

        if (tokenEntry && tokenEntry.kid && tokenEntry.key) {
            res.setHeader('X-Stream-Drm', `${tokenEntry.kid}:${tokenEntry.key}`);
            res.setHeader('Access-Control-Expose-Headers', 'X-Stream-Drm');
        }

        res.setHeader('Content-Type', 'application/dash+xml; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Access-Control-Allow-Origin', '*');
        return res.send(xmlText);
    } catch (error) {
        console.error('[MPD-PROXY] Error:', error.message);
        return res.status(502).send('Failed to proxy MPD');
    }
});

// --- HLS / TS Stream Proxy Route (Referer Guard + Short-Lived Token + Low-Lag Chunk Streaming) ---
app.get('/hls-proxy', async (req, res) => {
    if (!hasAllowedReferer(req)) {
        return res.status(403).send('Forbidden');
    }

    const token = req.query.token;
    const targetUrl = resolveStreamToken(token);

    if (!targetUrl) {
        return res.status(403).send('Stream token expired or invalid');
    }

    try {
        const tokenEntry = streamTokenRegistry.get(token);
        const upstreamHeaders = {
            ...UPSTREAM_STREAM_HEADERS,
            ...(tokenEntry && tokenEntry.userAgent ? { 'User-Agent': tokenEntry.userAgent } : {}),
            ...(tokenEntry && tokenEntry.referer ? { 'Referer': tokenEntry.referer } : {})
        };

        const response = await fetch(targetUrl, {
            headers: upstreamHeaders,
            redirect: 'follow',
            signal: AbortSignal.timeout(20000)
        });

        const contentType = response.headers.get('content-type') || '';

        if (!response.ok) {
            const errSnippet = (await response.text().catch(() => '')).slice(0, 200);
            return res.status(response.status).send(`Upstream error ${response.status}: ${errSnippet}`);
        }

        const rawBuffer = Buffer.from(await response.arrayBuffer());
        const headText = rawBuffer.slice(0, 64).toString('utf8').trimStart();
        const isActualM3u8Text = headText.startsWith('#EXTM3U') || headText.startsWith('#EXT-X-');

        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', '*');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

        if (isActualM3u8Text) {
            res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
            const bodyText = rawBuffer.toString('utf8');
            const effectiveBase = response.url || targetUrl;
            const baseUrl = effectiveBase.substring(0, effectiveBase.lastIndexOf('/') + 1);
            const lines = bodyText.split(/\r?\n/);

            const rewrittenLines = lines.map(line => {
                const trimmed = line.trim();
                if (!trimmed) return '';
                if (trimmed.startsWith('#')) {
                    if (trimmed.includes('URI="')) {
                        return trimmed.replace(/URI="([^"]+)"/g, (match, uri) => {
                            const absoluteUri = uri.startsWith('http')
                                ? uri
                                : new URL(uri, baseUrl).toString();
                            const childToken = createStreamToken(absoluteUri, tokenEntry || {});
                            return `URI="/hls-proxy?token=${encodeURIComponent(childToken)}"`;
                        });
                    }
                    return line;
                } else {
                    const absoluteUrl = trimmed.startsWith('http')
                        ? trimmed
                        : new URL(trimmed, baseUrl).toString();
                    const segToken = createStreamToken(absoluteUrl, tokenEntry || {});
                    return `/hls-proxy?token=${encodeURIComponent(segToken)}`;
                }
            });

            return res.send(rewrittenLines.join('\n'));
        } else {
            const safeCt = (contentType && !contentType.toLowerCase().includes('mpegurl'))
                ? contentType
                : 'video/mp2t';
            res.setHeader('Content-Type', safeCt);

            const chunkSize = 65536;
            for (let offset = 0; offset < rawBuffer.length; offset += chunkSize) {
                const slice = rawBuffer.subarray(offset, offset + chunkSize);
                const canContinue = res.write(slice);
                if (!canContinue) {
                    await new Promise(resolve => res.once('drain', resolve));
                }
            }
            return res.end();
        }
    } catch (error) {
        console.error('[HLS-PROXY] Catch error:', error);
        if (!res.headersSent) {
            res.status(502).send('Proxy error: ' + error.message);
        } else {
            res.end();
        }
    }
});

io.on('connection', (socket) => {
    console.log('A user connected: ' + socket.id);

    socket.on('requestAllMatches', async () => {
        const allData = await getMatchesDataFromGitHub();
        const publicData = {};
        for (let cat in allData) {
            publicData[cat] = allData[cat].map(match => ({
                id: match.id,
                title: match.title,
                team1: match.team1,
                team2: match.team2,
                status: match.status,
                date: match.date,
                time: match.time,
                thumbnail: match.thumbnail
            }));
        }
        socket.emit('allMatchesData', publicData);
    });

    socket.on('triggerRefresh', async () => {
        io.emit('refreshMatchesData');
    });

    socket.on('requestHlsToken', ({ url, userAgent, referer }) => {
        const cleanUrl = String(url || '').trim();
        if (!cleanUrl || !isApprovedStreamUrl(cleanUrl)) {
            socket.emit('hlsProxyToken', { error: 'Unauthorized or invalid stream URL' });
            return;
        }
        const token = createStreamToken(cleanUrl, { userAgent, referer });
        socket.emit('hlsProxyToken', {
            originalUrl: cleanUrl,
            proxyUrl: `/hls-proxy?token=${encodeURIComponent(token)}`
        });
    });

    socket.on('requestStreamLink', async ({ matchId, serverType }) => {
        const allData = await getMatchesDataFromGitHub();
        let directLink = '';

        for (let cat in allData) {
            const found = allData[cat].find(m => m.id === matchId);
            if (found) {
                if (serverType === 'server5') {
                    directLink = found.streamUrl5 || found.streamUrl1;
                } else if (serverType === 'server4') {
                    directLink = found.streamUrl4 || found.streamUrl1;
                } else if (serverType === 'server3') {
                    directLink = found.streamUrl3 || found.streamUrl1;
                } else if (serverType === 'server2') {
                    directLink = found.streamUrl2 || found.streamUrl1;
                } else {
                    directLink = found.streamUrl1;
                }
                break;
            }
        }

        let finalLink = directLink;
        if (directLink) {
            registerApprovedStreamUrl(directLink);
            const streamToken = createStreamToken(directLink);
            if (directLink.toLowerCase().includes('.mpd')) {
                finalLink = `/mpd-proxy?token=${encodeURIComponent(streamToken)}`;
            } else if (directLink.includes('.m3u8')) {
                finalLink = `/hls-proxy?token=${encodeURIComponent(streamToken)}`;
            }
        }

        socket.emit('secureStreamLink', finalLink);
    });

    socket.on('joinMatch', ({ matchId, username, nameColor, avatar, verified }) => {
        if (!matchId) return;
        const safeMatchId = String(matchId).trim();
        if (!safeMatchId) return;

        // Leave previous match room if switching matches on same socket
        if (socket.currentMatch && socket.currentMatch !== safeMatchId) {
            const prevId = socket.currentMatch;
            socket.leave(prevId);
            if (matchActiveSockets[prevId]) {
                matchActiveSockets[prevId].delete(socket.id);
                if (matchActiveSockets[prevId].size === 0) {
                    delete matchActiveSockets[prevId];
                }
                io.to(prevId).emit('viewerCount', getMatchLiveCount(prevId));
            }
        }

        socket.join(safeMatchId);
        socket.username = (username && String(username).trim()) || 'Guest';
        socket.nameColor = nameColor || '';
        socket.avatar = avatar || '';
        socket.verified = Boolean(verified);
        socket.currentMatch = safeMatchId;

        if (!matchActiveSockets[safeMatchId]) {
            matchActiveSockets[safeMatchId] = new Set();
        }

        const isNewSocketInMatch = !matchActiveSockets[safeMatchId].has(socket.id);
        matchActiveSockets[safeMatchId].add(socket.id);

        if (isNewSocketInMatch) {
            if (!matchTotalViews[safeMatchId]) {
                matchTotalViews[safeMatchId] = 0;
            }
            matchTotalViews[safeMatchId]++;
        }

        io.to(safeMatchId).emit('viewerCount', getMatchLiveCount(safeMatchId));

        if (matchChatHistories[safeMatchId] && matchChatHistories[safeMatchId].length > 0) {
            socket.emit('chatHistory', matchChatHistories[safeMatchId]);
        }
    });

    socket.on('chatMessage', (data) => {
        const matchId = socket.currentMatch;
        if (!matchId || !data || !data.message) return;

        const sriLankaTime = new Date().toLocaleTimeString('en-US', {
            timeZone: 'Asia/Colombo',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        });

        const senderUsername =
            (data.username && String(data.username).trim()) ||
            (socket.username && String(socket.username).trim()) ||
            'Guest';

        if (data.username && String(data.username).trim()) {
            socket.username = String(data.username).trim();
        }
        if (typeof data.verified === 'boolean') {
            socket.verified = data.verified;
        }
        if (typeof data.nameColor === 'string') {
            socket.nameColor = data.nameColor;
        }
        if (typeof data.avatar === 'string') {
            socket.avatar = data.avatar;
        }

        const messageData = {
            id: 'msg_' + Date.now() + Math.random().toString(36).substring(2, 7),
            username: senderUsername,
            nameColor: data.nameColor || socket.nameColor || '',
            avatar: data.avatar || socket.avatar || '',
            verified: typeof data.verified === 'boolean' ? data.verified : Boolean(socket.verified),
            message: String(data.message),
            replyTo: data.replyTo || null,
            time: sriLankaTime
        };

        if (!matchChatHistories[matchId]) {
            matchChatHistories[matchId] = [];
        }
        matchChatHistories[matchId].push(messageData);

        if (matchChatHistories[matchId].length > 150) {
            matchChatHistories[matchId].shift();
        }

        io.to(matchId).emit('chatMessage', messageData);
    });

    socket.on('sendReaction', (payload) => {
        const matchId = socket.currentMatch;
        if (!matchId) return;

        const emoji = String((payload && payload.emoji) || '').trim().slice(0, 12);
        const label = String((payload && payload.label) || '').trim().slice(0, 24);
        if (!emoji) return;

        io.to(matchId).emit('stadiumReaction', {
            id: 'rx_' + Date.now() + Math.random().toString(36).substring(2, 6),
            emoji,
            label,
            username: socket.username || 'Fan'
        });
    });

    socket.on('disconnect', () => {
        const matchId = socket.currentMatch;
        if (matchId && matchActiveSockets[matchId]) {
            matchActiveSockets[matchId].delete(socket.id);
            if (matchActiveSockets[matchId].size === 0) {
                delete matchActiveSockets[matchId];
            }
            io.to(matchId).emit('viewerCount', getMatchLiveCount(matchId));
        }
        console.log('User disconnected: ' + socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
