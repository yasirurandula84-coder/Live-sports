const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fetch = require('node-fetch');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const matchViewers = {};
const matchChatHistories = {};

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

// ඔබ දුන් සාර්ථක VLC User-Agent සහ Proxy Logic එක මෙහි ඇතුළත් කර ඇත
app.get('/proxy', async (req, res) => {
    let targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('Missing url');

    try {
        const response = await fetch(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': '*/*',
                'Accept-Encoding': 'identity',
                'Connection': 'keep-alive',
                'Referer': 'https://www.itcnbd.live/'
            },
            redirect: 'follow'
        });
        
        response.headers.forEach((v, n) => res.setHeader(n, v));
        res.status(response.status);

        const contentType = response.headers.get('content-type') || '';
        
        if (targetUrl.endsWith('.m3u8') || contentType.includes('mpegurl') || contentType.includes('text')) {
            const text = await response.text();
            const rewritten = text.split('\n').map(line => {
                line = line.trim();
                if (line && !line.startsWith('#')) {
                    let absoluteUrl = line;
                    if (!line.startsWith('http')) {
                        const urlObj = new URL(targetUrl);
                        absoluteUrl = `${urlObj.origin}${line.startsWith('/') ? '' : '/'}${line}`;
                    }
                    return `/proxy?url=${encodeURIComponent(absoluteUrl)}`;
                }
                return line;
            }).join('\n');
            return res.send(rewritten);
        }
        
        response.body.pipe(res);
    } catch (err) {
        console.error('Proxy Error:', err.message);
        res.status(500).send('Proxy error');
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
                time: match.time,
                thumbnail: match.thumbnail
            }));
        }
        socket.emit('allMatchesData', publicData);
    });

    socket.on('triggerRefresh', async () => {
        io.emit('refreshMatchesData');
    });

    // ප්‍රොක්සි රූට් එක `/proxy?url=` ලෙස යොදා ඇත
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

        if (directLink && directLink.startsWith('http')) {
            directLink = `/proxy?url=${encodeURIComponent(directLink)}`;
        }

        socket.emit('secureStreamLink', directLink);
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
