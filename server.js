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

    // චැට් මැසේජ් එකක් ලැබුණු විට (Reply දත්ත සමග හැසිරවීම)
    socket.on('chatMessage', (data) => {
        const matchId = socket.currentMatch;
        if (!matchId) return;

        const messageData = {
            id: 'msg_' + Date.now() + Math.random().toString(36).substring(2, 7), // මැසේජ් එකට අනන්‍ය ID එකක්
            username: socket.username,
            message: data.message,
            replyTo: data.replyTo || null, // වෙනත් මැසේජ් එකකට රෙප්ලයි කර ඇත්නම් එම විස්තරය
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
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
