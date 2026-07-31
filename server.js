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

    // 1. Category.html එකෙන් මුළු මැච් ලැයිස්තුවම ඉල්ලුවම යැවීම (Link එක හැංගිලා යයි, අනෙක් විස්තර පේනවා)
    socket.on('requestAllMatches', async () => {
        const allData = await getMatchesDataFromGitHub();
        // පරිශීලකයින්ට සල්ලි ගෙවපු .m3u8 link එක පේන්නේ නැති වෙන්න, links ටික අයින් කරලා යවනවා
        const publicData = {};
        for (let cat in allData) {
            publicData[cat] = allData[cat].map(match => ({
                id: match.id,
                title: match.title,
                team1: match.team1,
                team2: match.team2,
                status: match.status
            }));
        }
        socket.emit('allMatchesData', publicData);
    });

    // 2. Match.html එකෙන් නිශ්චිත මැච් එකක link එක ඉල්ලුවම රහසිගතව දීම
    socket.on('requestStreamLink', async (matchId) => {
        const allData = await getMatchesDataFromGitHub();
        let directLink = '';
        
        // අදාළ match id එක හොයාගෙන link එක ගැනීම
        for (let cat in allData) {
            const found = allData[cat].find(m => m.id === matchId);
            if (found) {
                directLink = found.link;
                break;
            }
        }
        socket.emit('secureStreamLink', directLink);
    });

    // (අනෙකුත් chat සහ viewer count කෝඩ් ටික මෙතනටම පහළින් දිගටම තියාගන්න)
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
