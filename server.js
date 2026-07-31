const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const matchViewers = {};

// GitHub Private Repo එකෙන් matches.json එක fetch කරගැනීම
async function getSecureLinksFromGitHub() {
    try {
        // ඔයාගේ repo එකට අදාළ GitHub API URL එක
        const response = await fetch('https://api.github.com/repos/yasirurandula84-coder/Datay/contents/matches.json', {
            headers: {
                'Authorization': `token ${process.env.GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3.raw' // කෙලින්ම JSON content එක ලබා ගැනීමට
            }
        });
        
        if (!response.ok) throw new Error('Failed to fetch from GitHub');
        const linksData = await response.json();
        return linksData;
    } catch (error) {
        console.error('Error fetching secure links:', error);
        return {};
    }
}

io.on('connection', (socket) => {
    console.log('A user connected: ' + socket.id);

    // Frontend එකෙන් ලින්ක් එක ඉල්ලුවම GitHub එකෙන් රහසිගතව fetch කර දීම
    socket.on('requestStreamLink', async (matchId) => {
        const secureMatchLinks = await getSecureLinksFromGitHub();
        const link = secureMatchLinks[matchId] || '';
        socket.emit('secureStreamLink', link);
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

        socket.on('chatMessage', (msg) => {
            io.to(matchId).emit('chatMessage', {
                username: socket.username,
                message: msg,
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            });
        });
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
