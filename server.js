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

// --- Clean Routes (URL එකෙන් .html ඉවත් කිරීම සඳහා) ---

// 1. Home Page (ස්වයංක්‍රීයව index.html පෙන්වයි)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 2. Category Page (උදා: /category/cricket)
app.get('/category/:name', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'category.html'));
});

// 3. Match Player Page (උදා: /match?id=xxx&title=xxx හෝ /watch/xxx)
app.get('/match', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'match.html'));
});

// --- HLS Proxy Route to bypass CORS and restrictions ---
app.get('/hls-proxy', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) {
        return res.status(400).send('Missing url parameter');
    }

    try {
        const response = await fetch(targetUrl, {
            headers: {
                'User-Agent': 'VLC/3.0.18 LibVLC/3.0.18',
                'Accept': '*/*',
                'Referer': 'https://www.fancode.com/'
            }
        });

        if (!response.ok) {
            return res.status(response.status).send('Failed to fetch upstream stream');
        }

        const contentType = response.headers.get('content-type') || '';
        
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', '*');

        if (targetUrl.includes('.m3u8') || contentType.includes('mpegurl') || contentType.includes('application/vnd.apple.mpegurl')) {
            res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
            let bodyText = await response.text();

            const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);
            const lines = bodyText.split('\n');
            
            const rewrittenLines = lines.map(line => {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('#')) {
                    if (trimmed.includes('URI="')) {
                        return trimmed.replace(/URI="([^"]+)"/, (match, uri) => {
                            let absoluteUri = uri.startsWith('http') ? uri : new URL(uri, baseUrl).toString();
                            return `URI="/hls-proxy?url=${encodeURIComponent(absoluteUri)}"`;
                        });
                    }
                    return line;
                } else {
                    let absoluteUrl = trimmed.startsWith('http') ? trimmed : new URL(trimmed, baseUrl).toString();
                    return `/hls-proxy?url=${encodeURIComponent(absoluteUrl)}`;
                }
            });

            return res.send(rewrittenLines.join('\n'));
        } else {
            res.setHeader('Content-Type', contentType);
            const buffer = await response.arrayBuffer();
            return res.send(Buffer.from(buffer));
        }
    } catch (error) {
        console.error('Proxy error:', error);
        res.status(500).send('Proxy error: ' + error.message);
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
                if (serverType === 'server2') {
                    directLink = found.link2 || found.link1;
                } else {
                    directLink = found.link1;
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
