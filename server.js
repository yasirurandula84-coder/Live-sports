const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const matchViewers = {};

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

    // 1. Category.html හෝ Match.html එකෙන් මුළු මැච් ලැයිස්තුවම ඉල්ලුවම යැවීම (Secure Links හැංගිලා යයි, අනෙක් විස්තර පේනවා)
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
            time: match.time,       // <--- මෙන්න මේක අනිවාර්යයෙන් දාන්න ඕනේ (Countdown එකට අවශ්‍යයි)
            thumbnail: match.thumbnail
        }));
    }
    socket.emit('allMatchesData', publicData);
});
    // මැච් එකක ස්ටේටස් එක වෙනස් වූ විට හෝ අලුත් විස්තර යැවීමට අවශ්‍ය තැනදී මෙය ක්‍රියාත්මක කරන්න:
const allData = await getMatchesDataFromGitHub();
// අවශ්‍ය ප්‍රොසෙස් එකෙන් පසු සියලුම කනෙක්ට් වී සිටින අයට අලුත් ඩේටා යැවීම:
io.emit('refreshMatchesData');
    


    // 2. Match.html එකෙන් නිශ්චිත මැච් එකක link එක ඉල්ලුවම රහසිගතව දීම
        // Match.html එකෙන් නිශ්චිත මැච් එකක සර්වර් ලින්ක් එක ඉල්ලීම
    socket.on('requestStreamLink', async ({ matchId, serverType }) => {
        const allData = await getMatchesDataFromGitHub();
        let directLink = '';
        
        for (let cat in allData) {
            const found = allData[cat].find(m => m.id === matchId);
            if (found) {
                // serverType එක අනුව link1 හෝ link2 ලබා දීම
                if (serverType === 'server2') {
                    directLink = found.link2 || found.link1; // link2 නැත්නම් link1 දෙන්න
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

        if (!matchViewers[matchId]) {
            matchViewers[matchId] = 0;
        }
        matchViewers[matchId]++;
        
        io.to(matchId).emit('viewerCount', matchViewers[matchId]);

        socket.on('chatMessage', (msg) => {
            io.to(matchId).emit('chatMessage', {
                username: socket.username,
                message: msg
        });
            });
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
