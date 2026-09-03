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

// Universal Smart Proxy Route with Redirect & Short URL Support (Akamai, Short.gy, m3u8 සහ TS සඳහා)
app.get('/proxy/stream', async (req, res) => {
    let targetUrl = req.query.url;
    if (!targetUrl) {
        return res.status(400).send('Missing target URL');
    }

    try {
        let currentUrl = targetUrl;
        let response;
        
        for (let i = 0; i < 5; i++) {
            const parsedUrl = new URL(currentUrl);
            const dynamicBaseUrl = `${parsedUrl.protocol}//${parsedUrl.hostname}`;

            response = await axios({
                method: 'get',
                url: currentUrl,
                responseType: 'arraybuffer',
                maxRedirects: 0,
                validateStatus: function (status) {
                    return status >= 200 && status < 400;
                },
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                    'Referer': dynamicBaseUrl + '/',
                    'Origin': dynamicBaseUrl,
                    'Accept': '*/*',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Cache-Control': 'no-cache'
                }
            });

            if (response.status >= 300 && response.status < 400 && response.headers['location']) {
                let redirectLocation = response.headers['location'];
                if (!redirectLocation.startsWith('http')) {
                    redirectLocation = new URL(redirectLocation, currentUrl).href;
                }
                currentUrl = redirectLocation;
                continue;
            }
            break;
        }

        if (response.headers['content-type']) {
            res.setHeader('Content-Type', response.headers['content-type']);
        }

        let contentType = response.headers['content-type'] || '';
        if (contentType.includes('mpegurl') || contentType.includes('text') || currentUrl.includes('.m3u8')) {
            let m3u8Content = response.data.toString('utf8');
            const lines = m3u8Content.split('\n');
            
            const processedLines = lines.map(line => {
                line = line.trim();
                if (line && !line.startsWith('#')) {
                    let absoluteUrl = line;
                    if (!line.startsWith('http')) {
                        const baseUrl = currentUrl.substring(0, currentUrl.lastIndexOf('/') + 1);
                        absoluteUrl = new URL(line, baseUrl).href;
                    }
                    return `/proxy/stream?url=${encodeURIComponent(absoluteUrl)}`;
                }
                return line;
            });

            return res.send(processedLines.join('\n'));
        }

        res.send(response.data);

    } catch (error) {
        console.error('Redirect/Proxy Error:', error.message);
        res.status(500).send('Internal Server Error');
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

    // 2. Match.html එකෙන් නිශ්චිත මැච් එකක සර්වර් ලින්ක් එක ඉල්ලීම (සියලුම ලින්ක්ස් ප්‍රොක්සි හරහා රූට් කිරීම)
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
            directLink = `/proxy/stream?url=${encodeURIComponent(directLink)}`;
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
