const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const matchViewers = {};
const matchChatHistories = {};

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

// Universal Smart Proxy Route with Redirect Handling
app.get('/proxy/stream', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) {
        return res.status(400).send('Missing target URL');
    }

    try {
        const parsedUrl = new URL(targetUrl);
        const dynamicBaseUrl = `${parsedUrl.protocol}//${parsedUrl.hostname}`;

        const response = await axios({
            method: 'get',
            url: targetUrl,
            responseType: 'arraybuffer',
            maxRedirects: 5,
            headers: {
                'User-Agent': 'VLC/3.0.20 LibVLC/3.0.20',
                'Icy-MetaData': '1',
                'Accept-Encoding': 'identity',
                'Referer': dynamicBaseUrl + '/',
                'Origin': dynamicBaseUrl
            }
        });

        if (response.headers['content-type']) {
            res.setHeader('Content-Type', response.headers['content-type']);
        }

        // m3u8 ෆයිල් එකක් නම්, ඇතුළේ තියෙන relative links සියල්ල ප්‍රොක්සි හරහා යන විදිහට රීරයිට් කිරීම
        let contentType = response.headers['content-type'] || '';
        if (contentType.includes('mpegurl') || contentType.includes('text') || targetUrl.includes('.m3u8')) {
            let m3u8Content = response.data.toString('utf8');
            const lines = m3u8Content.split('\n');
            
            const processedLines = lines.map(line => {
                line = line.trim();
                if (line && !line.startsWith('#')) {
                    let absoluteUrl = line;
                    if (!line.startsWith('http')) {
                        // Relative URL එකක් නම් ඒක Absolute URL එකක් බවට හැරවීම
                        const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);
                        absoluteUrl = new URL(line, baseUrl).href;
                    }
                    // ප්‍රොක්සි ලින්ක් එක හරහා රීඩිරෙක්ට් කිරීම
                    return `/proxy/stream?url=${encodeURIComponent(absoluteUrl)}`;
                }
                return line;
            });

            return res.send(processedLines.join('\n'));
        }

        res.send(response.data);

    } catch (error) {
        console.error('Proxy Error:', error.message);
        res.status(500).send('Internal Server Error');
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

        if (directLink && (directLink.includes('cloudfront.net') || directLink.startsWith('http'))) {
            directLink = `/proxy/stream?url=${encodeURIComponent(directLink)}`;
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
