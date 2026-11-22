const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

const matchViewers = {};
const matchChatHistories = {}; // මැච් අනුව චැට් හිස්ට්‍රි ගබඩා කරගැනීමට

const TAPMAD_PLAYLIST_URL = 'http://2nd.sm-monirul.top/@sm_iptv_bd/exp.php?tapmad=getPlaylist&sm=.m3u';
let tapmadCache = { data: null, expiresAt: 0 };

const CRICBUZZ_API_URL = (process.env.CRICBUZZ_API_URL || 'https://cricbuzz-scraper-kkkw.onrender.com').replace(/\/+$/, '');
let cricbuzzLiveCache = { data: null, expiresAt: 0 };
const cricbuzzRankingsCache = new Map();

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
    const lowerRef = referer.toLowerCase();
    return ALLOWED_STREAM_HOSTS.some(host => lowerRef.includes(host));
}

// Short-Lived Stream Token Store (TTL: 90s)
const STREAM_TOKEN_SECRET = process.env.STREAM_TOKEN_SECRET || crypto.randomBytes(32).toString('hex');
const STREAM_TOKEN_TTL_MS = 90 * 1000;
const streamTokenRegistry = new Map(); // token -> { url, expiresAt }

function createStreamToken(targetUrl) {
    const cleanUrl = String(targetUrl || '').trim();
    if (!cleanUrl) return null;

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
    streamTokenRegistry.set(token, { url: cleanUrl, expiresAt });
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

// GitHub Private Repo එකෙන් මුළු matches.json එකම fetch කරගැනීම
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
            const titleName = pendingName || `Channel ${channels.length + 1}`;
            const streamToken = createStreamToken(rawStreamUrl);

            channels.push({
                id: `tv-${channels.length + 1}`,
                name: titleName,
                title: titleName,
                logo: pendingLogo,
                group: pendingGroup,
                stream_url: `/hls-proxy?token=${encodeURIComponent(streamToken)}`,
                kid: pendingKid,
                key: pendingKey,
                referer: pendingReferer,
                userAgent: pendingUserAgent
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

// --- Clean Routes (URL එකෙන් .html ඉවත් කිරීම සඳහා) ---

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/category/:name', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'category.html'));
});

app.get('/match', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'match.html'));
});

app.get('/ranking', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'ranking.html'));
});

// --- Cricbuzz Live Scores API Route ---
app.get('/api/cricbuzz-live', async (req, res) => {
    const now = Date.now();
    if (cricbuzzLiveCache.data && now < cricbuzzLiveCache.expiresAt) {
        return res.json({ ok: true, data: cricbuzzLiveCache.data });
    }

    try {
        const response = await fetch(`${CRICBUZZ_API_URL}/matches/live`, {
            headers: {
                'Accept': 'application/json'
            },
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

// --- Cricbuzz Rankings API Route ---
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
            headers: {
                'Accept': 'application/json'
            },
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

// --- Tapmad / M3U Playlist API Route ---
app.get('/api/tapmad-playlist', async (req, res) => {
    const now = Date.now();
    if (tapmadCache.data && now < tapmadCache.expiresAt) {
        return res.json(tapmadCache.data);
    }

    try {
        const response = await fetch(TAPMAD_PLAYLIST_URL, {
            headers: UPSTREAM_STREAM_HEADERS
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

// --- Image Proxy Route ---
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
        const response = await fetch(targetUrl, {
            headers: UPSTREAM_STREAM_HEADERS,
            redirect: 'follow',
            signal: AbortSignal.timeout(15000)
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
                            const childToken = createStreamToken(absoluteUri);
                            return `URI="/hls-proxy?token=${encodeURIComponent(childToken)}"`;
                        });
                    }
                    return line;
                } else {
                    const absoluteUrl = trimmed.startsWith('http')
                        ? trimmed
                        : new URL(trimmed, baseUrl).toString();
                    const segToken = createStreamToken(absoluteUrl);
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
            res.status(500).send('Proxy error: ' + error.message);
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
        if (directLink && directLink.includes('.m3u8')) {
            const streamToken = createStreamToken(directLink);
            finalLink = `/hls-proxy?token=${encodeURIComponent(streamToken)}`;
        }

        socket.emit('secureStreamLink', finalLink);
    });

    socket.on('joinMatch', ({ matchId, username }) => {
        socket.join(matchId);
        socket.username = username;
        socket.currentMatch = matchId;

        if (!matchViewers[matchId]) {
            matchViewers[matchId] = 0;
        }
        matchViewers[matchId]++;
        io.to(matchId).emit('viewerCount', matchViewers[matchId]);

        if (matchChatHistories[matchId] && matchChatHistories[matchId].length > 0) {
            socket.emit('chatHistory', matchChatHistories[matchId]);
        }
    });

    socket.on('chatMessage', (data) => {
        const matchId = socket.currentMatch;
        if (!matchId) return;

        const sriLankaTime = new Date().toLocaleTimeString('en-US', {
            timeZone: 'Asia/Colombo',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        });

        const messageData = {
            id: 'msg_' + Date.now() + Math.random().toString(36).substring(2, 7),
            username: socket.username,
            message: data.message,
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

    socket.on('disconnect', () => {
        if (socket.currentMatch && matchViewers[socket.currentMatch]) {
            matchViewers[socket.currentMatch]--;
            if (matchViewers[socket.currentMatch] < 0) matchViewers[socket.currentMatch] = 0;

            io.to(socket.currentMatch).emit('viewerCount', matchViewers[socket.currentMatch]);
        }
        console.log('User disconnected: ' + socket.id);
    });
});

// --- Auto-Post Newly LIVE Matches to StreamX Telegram Group (Country Emoji) ---
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
const PUBLIC_SITE_URL = (process.env.PUBLIC_SITE_URL || 'https://www.streamx.website').replace(/\/+$/, '');
const EXTERNAL_SPORTS_FEED_URL = 'https://raw.githubusercontent.com/sm-monirulislam/Upcoming-and-Live-Sports-Data/refs/heads/main/Sports_data.json';

const announcedLiveMatches = new Set();
let isTelegramCheckRunning = false;

const TEAM_COUNTRY_EMOJIS = {
    'india': '🇮🇳',
    'new zealand': '🇳🇿',
    'sri lanka': '🇱🇰',
    'australia': '🇦🇺',
    'england': '🏴󠁧󠁢󠁥󠁮󠁧󠁿',
    'pakistan': '🇵🇰',
    'south africa': '🇿🇦',
    'bangladesh': '🇧🇩',
    'afghanistan': '🇦🇫',
    'west indies': '🇯🇲',
    'ireland': '🇮🇪',
    'zimbabwe': '🇿🇼',
    'netherlands': '🇳🇱',
    'scotland': '🏴󠁧󠁢󠁳󠁣󠁴󠁿',
    'nepal': '🇳🇵',
    'uae': '🇦🇪',
    'united arab emirates': '🇦🇪',
    'oman': '🇴🇲',
    'usa': '🇺🇸',
    'united states': '🇺🇸',
    'canada': '🇨🇦',
    'namibia': '🇳🇦',
    'kenya': '🇰🇪',
    'argentina': '🇦🇷',
    'brazil': '🇧🇷',
    'france': '🇫🇷',
    'germany': '🇩🇪',
    'spain': '🇪🇸',
    'portugal': '🇵🇹',
    'italy': '🇮🇹',
    'japan': '🇯🇵',
    'south korea': '🇰🇷',
    'china': '🇨🇳'
};

function getTeamCountryEmoji(teamName) {
    const clean = String(teamName || '').trim().toLowerCase();
    if (!clean) return '🏳️';
    if (TEAM_COUNTRY_EMOJIS[clean]) return TEAM_COUNTRY_EMOJIS[clean];

    for (const [key, emoji] of Object.entries(TEAM_COUNTRY_EMOJIS)) {
        if (clean.includes(key)) return emoji;
    }
    return '🏳️';
}

function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function buildMatchSlug(cat, idx, title) {
    return `${(cat || 'other').toLowerCase()}-${idx}-${(title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
}

async function sendTelegramLivePost(matchPayload) {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;

    const { title, teamA, teamB, category, startTime, watchUrl } = matchPayload;
    const emojiA = getTeamCountryEmoji(teamA);
    const emojiB = getTeamCountryEmoji(teamB);
    const teamsLine = (teamA || teamB)
        ? `${emojiA} <b>${escapeHtml(teamA || 'Team A')}</b> vs ${emojiB} <b>${escapeHtml(teamB || 'Team B')}</b>`
        : '';

    const messageText = [
        `🔴 <b>LIVE NOW ON STREAMX</b>`,
        ``,
        `🏏 <b>Match:</b> ${escapeHtml(title)}`,
        teamsLine ? `🆚 <b>Teams:</b> ${teamsLine}` : '',
        category ? `📂 <b>Category:</b> ${escapeHtml(category)}` : '',
        startTime ? `🕒 <b>Start Time:</b> ${escapeHtml(startTime)}` : '',
        `🌐 <b>Site:</b> <a href="${PUBLIC_SITE_URL}">www.streamx.website</a>`,
        `▶️ <b>Watch Live:</b> <a href="${watchUrl}">Click Here to Watch</a>`
    ].filter(Boolean).join('\n');

    const baseTgApi = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
    const msgRes = await fetch(`${baseTgApi}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chat_id: TELEGRAM_CHAT_ID,
            text: messageText,
            parse_mode: 'HTML',
            disable_web_page_preview: false
        }),
        signal: AbortSignal.timeout(12000)
    });

    if (!msgRes.ok) {
        const errText = await msgRes.text().catch(() => '');
        console.error('[TG-AUTO] Failed to send message:', msgRes.status, errText);
    }
}

async function checkAndAnnounceLiveMatches() {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
    if (isTelegramCheckRunning) return;
    isTelegramCheckRunning = true;

    try {
        const res = await fetch(`${EXTERNAL_SPORTS_FEED_URL}?t=${Date.now()}`, {
            cache: 'no-store',
            signal: AbortSignal.timeout(15000)
        });
        if (!res.ok) return;

        const data = await res.json();
        const matches = Array.isArray(data.matches) ? data.matches : [];

        for (let idx = 0; idx < matches.length; idx++) {
            const m = matches[idx];
            const status = String(m.status || '').trim().toUpperCase();
            if (status !== 'LIVE') continue;

            const info = m.eventInfo || {};
            const teamA = info.teamA || '';
            const teamB = info.teamB || '';
            const title = m.event_name || `${teamA || 'Team A'} Vs ${teamB || 'Team B'}`;
            const slugId = buildMatchSlug(m.Category, idx, title);
            const uniqueKey = `${slugId}|${title.toLowerCase()}`;

            if (announcedLiveMatches.has(uniqueKey)) continue;
            announcedLiveMatches.add(uniqueKey);

            const watchUrl = `${PUBLIC_SITE_URL}/match?id=${encodeURIComponent(slugId)}&title=${encodeURIComponent(title)}`;

            await sendTelegramLivePost({
                title,
                teamA,
                teamB,
                category: m.Category || '',
                startTime: info.startTime || '',
                watchUrl
            });
        }
    } catch (error) {
        console.error('[TG-AUTO] Feed check error:', error.message);
    } finally {
        isTelegramCheckRunning = false;
    }
}

if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
    setTimeout(checkAndAnnounceLiveMatches, 5000);
    setInterval(checkAndAnnounceLiveMatches, 60 * 1000);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
