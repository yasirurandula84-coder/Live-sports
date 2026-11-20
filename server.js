const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

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

const UPSTREAM_STREAM_HEADERS = {
    'User-Agent': 'VLC/3.0.20 LibVLC/3.0.20',
    'Accept': '*/*',
    'Accept-Encoding': 'identity',
    'Connection': 'keep-alive'
};

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

            channels.push({
                id: `tv-${channels.length + 1}`,
                name: titleName,
                title: titleName,
                logo: pendingLogo,
                group: pendingGroup,
                raw_url: rawStreamUrl,
                stream_url: `/hls-proxy?url=${encodeURIComponent(rawStreamUrl)}`,
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

// --- HLS / TS Stream Proxy Route (Low-Lag Chunk Streaming) ---
app.get('/hls-proxy', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) {
        return res.status(400).send('Missing url parameter');
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

        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', '*');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

        const lowerUrl = String(response.url || targetUrl).toLowerCase();
        const lowerCt = contentType.toLowerCase();
        const looksLikeManifest =
            lowerUrl.includes('.m3u8') ||
            lowerCt.includes('mpegurl') ||
            lowerCt.includes('application/vnd.apple.mpegurl');

        if (looksLikeManifest) {
            const bodyText = await response.text();
            const trimmedHead = bodyText.trimStart();

            if (trimmedHead.startsWith('#EXTM3U') || trimmedHead.startsWith('#EXT-X-')) {
                res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
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
                                return `URI="/hls-proxy?url=${encodeURIComponent(absoluteUri)}"`;
                            });
                        }
                        return line;
                    } else {
                        const absoluteUrl = trimmed.startsWith('http')
                            ? trimmed
                            : new URL(trimmed, baseUrl).toString();
                        return `/hls-proxy?url=${encodeURIComponent(absoluteUrl)}`;
                    }
                });

                return res.send(rewrittenLines.join('\n'));
            }
        }

        // Stream binary MPEG-TS chunks directly without waiting for full buffer
        const safeCt = (contentType && !lowerCt.includes('mpegurl'))
            ? contentType
            : 'video/mp2t';
        res.setHeader('Content-Type', safeCt);

        if (response.body && typeof response.body.getReader === 'function') {
            const reader = response.body.getReader();
            req.on('close', () => {
                reader.cancel().catch(() => {});
            });

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                if (value && value.length > 0) {
                    const canContinue = res.write(Buffer.from(value));
                    if (!canContinue) {
                        await new Promise(resolve => res.once('drain', resolve));
                    }
                }
            }
            return res.end();
        } else {
            const rawBuffer = Buffer.from(await response.arrayBuffer());
            return res.end(rawBuffer);
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
            finalLink = `/hls-proxy?url=${encodeURIComponent(directLink)}`;
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
