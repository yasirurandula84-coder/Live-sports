const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

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

// --- HLS Proxy Route to bypass CORS and Google DAI restrictions ---
app.get('/hls-proxy', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) {
        return res.status(400).send('Missing url parameter');
    }

    try {
        const response = await fetch(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        if (!response.ok) {
            return res.status(response.status).send('Failed to fetch upstream stream');
        }

        const contentType = response.headers.get('content-type') || '';
        
        // CORS Headers සක්‍රීය කිරීම
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', '*');

        // .m3u8 මැනිෆේස්ට් එකක් නම් ඇතුළත ඇති සگ්මන්ට් ලින්ක්ස් (segments) ද ප්‍රොক্সি හරහා යන ලෙස වෙනස් කිරීම
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
            // .ts වීඩියෝ සگ්මන්ට්ස් සඳහා බයිනරි ඩේටා ලෙස යැවීම
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

    // 2. Match.html එකෙන් නිශ්චිත මැච් එකක සර්වර් ලින්ක් එක ඉල්ලීම සහ Proxy එක හරහා යැවීම
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

        // m3u8 ලින්ක් එකක් නම් ප්‍රොක්සි ලින්ක් එකක් බවට හැරවීම (YouTube නම් එලෙසම යැවේ)
        let finalLink = directLink;
        if (directLink && directLink.includes('.m3u8')) {
            finalLink = `/hls-proxy?url=${encodeURIComponent(directLink)}`;
        }

        socket.emit('secureStreamLink', finalLink);
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
            id: 'msg_' + Date.now() + Math.random().toString(36).substring(2, 7), // මැසේජ් එකට අනන්‍ය ID එකක්
            username: socket.username,
            message: data.message,
            replyTo: data.replyTo || null, // වෙනත් මැසේජ් එකකට රෙප්ලයි කර ඇත්නම් එම විස්තරය
            time: sriLankaTime
        };

        // අදාළ මැච් එකේ හිස්ට්‍රි එකට මැසේජ් එක සේව් කරගැනීම (උපරිම මැසේජ් 150ක් රඳවා තබා ගනී)
        if (!matchChatHistories[matchId]) {
            matchChatHistories[matchId] = [];
        }
        matchChatHistories[matchId].push(messageData);
        
        if (matchChatHistories[matchId].length > 150) {
            matchChatHistories[matchId].shift();
        }

        // එම මැච් රූම් එකේ ඉන්න හැමෝටම මැසේජ් එක යැවීම
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
