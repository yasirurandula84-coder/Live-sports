const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const axios = require('axios'); // HLS ස්ට්‍රීම් ෆෙච් කිරීමට axios අවශ්‍ය වේ

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

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

// ==========================================
// HLS STREAM PROXY (Geo-blocking සහ Headers මඟ හැරීමට)
// ==========================================
app.get('/proxy-stream', async (req, res) => {
    let targetUrl = req.query.url;
    if (!targetUrl) {
        return res.status(400).send('Missing stream URL');
    }

    let customUserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    let customReferer = 'https://www.willow.tv/';

    // ලින්ක් එකේ '|' ලකුණ මඟින් User-Agent හෝ Headers අඩංගු නම් ඒවා වෙන් කර ගැනීම
    if (targetUrl.includes('|')) {
        const parts = targetUrl.split('|');
        targetUrl = parts[0];
        const params = parts[1].split('&');
        params.forEach(param => {
            if (param.startsWith('User-Agent=')) {
                customUserAgent = param.replace('User-Agent=', '');
            } else if (param.startsWith('Referer=')) {
                customReferer = param.replace('Referer=', '');
            }
        });
    }

    try {
        const response = await axios.get(targetUrl, {
            responseType: 'arraybuffer',
            headers: {
                'User-Agent': customUserAgent,
                'Referer': customReferer
            }
        });

        // Content-Type එක නිවැරදිව සෙට් කිරීම (.m3u8 හෝ .ts සඳහා)
        if (targetUrl.endsWith('.m3u8') || response.headers['content-type']?.includes('mpegurl')) {
            res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        } else if (targetUrl.endsWith('.ts') || response.headers['content-type']?.includes('mp2t')) {
            res.setHeader('Content-Type', 'video/mp2t');
        }

        res.send(response.data);
    } catch (error) {
        console.error('Proxy Error:', error.message);
        res.status(500).send('Failed to fetch stream segment.');
    }
});

// ==========================================

io.on('connection', (socket) => {
    console.log('A user connected: ' + socket.id);

    // 1. Category.html හෝ Match.html එකෙන් මුළු මැච් ලැයිස්තුවම ඉල්ලුවම යැවීම
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

    // අලුත් මැච් අප්ඩේට් එකක් සයිට් එකේ හැමෝටම ඔටෝ පෙන්නීමට ට්‍රිගර් කළ හැකි Event එකක්
    socket.on('triggerRefresh', async () => {
        io.emit('refreshMatchesData');
    });

    // 2. Match.html එකෙන් නිශ්චිත මැච් එකක සර්වර් ලින්ක් එක ඉල්ලීම
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

        // ලින්ක් එක US geo-blocked එකක් නම් එය අපේ ප්‍රොක්සි ලින්ක් එක හරහා යැවීම
        // (ඔබට අවශ්‍ය නම් ඕනෑම ලින්ක් එකක් ප්‍රොක්සි හරහා යැවීමට මෙලෙස රූට් කළ හැක)
        if (directLink && directLink.includes('amagi.tv')) {
            directLink = `/proxy-stream?url=${encodeURIComponent(directLink)}`;
        }

        socket.emit('secureStreamLink', directLink);
    });

    // 3. Match Join සහ Chat සඳහා අවශ්‍ය Events
    socket.on('joinMatch', ({ matchId, username }) => {
        socket.join(matchId);
        socket.username = username;
        socket.currentMatch = matchId;

        // Viewer Count එක වැඩි කිරීම
        if (!matchViewers[matchId]) {
            matchViewers[matchId] = 0;
        }
        matchViewers[matchId]++;
        io.to(matchId).emit('viewerCount', matchViewers[matchId]);

        // අලුතින් එන කෙනෙක්ට හෝ රිෆ්‍රෙෂ් කරන කෙනෙක්ට කලින් ගිය චැට් හිස්ට්‍රි එක යැවීම
        if (matchChatHistories[matchId] && matchChatHistories[matchId].length > 0) {
            socket.emit('chatHistory', matchChatHistories[matchId]);
        }
    });

    // චැට් මැසේජ් එකක් ලැබුණු විට (ශ්‍රී ලංකා වේලාවට නිවැරදිව සකස් කර ඇත)
    socket.on('chatMessage', (data) => {
        const matchId = socket.currentMatch;
        if (!matchId) return;

        // ශ්‍රී ලංකා වේලා කලාපයට (Asia/Colombo) අදාළව නිවැරදි වෙලාව ලබා ගැනීම
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

    // 4. User Disconnect වීම
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
