// --- DATABASE & STATE MANAGEMENT ---
const categoriesData = [
    { id: 'cricket', name: 'Cricket', icon: 'fa-baseball-bat-ball', count: 3, image: 'https://images.unsplash.com/photo-1540747913346-19e32dc3e97e?q=80&w=600&auto=format&fit=crop' },
    { id: 'football', name: 'Football', icon: 'fa-futbol', count: 2, image: 'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?q=80&w=600&auto=format&fit=crop' },
    { id: 'formula1', name: 'Formula 1', icon: 'fa-flag-checkered', count: 1, image: 'https://images.unsplash.com/photo-1568605117036-5fe5e7bab0b7?q=80&w=600&auto=format&fit=crop' }
];

const matchesData = {
    cricket: [
        { 
            id: 'lpl-01', 
            title: 'LPL 2026: Live Stream (Tokenized)', 
            time: 'Live Now', 
            status: 'LIVE', 
            viewers: 14230, 
            // ඔබ ළඟ ඇති Token ලින්ක් එක මෙතැනට දාන්න
            streamUrl: 'http://9937675.j13m.cc/live/fouaadkhadi/E7JWd8N9/1410913.ts?token=ShoJV0NcEgMVDABSXFIDVABXA1cAVAgFBAwAAgADWwZUXlcDBQUHDwEaSUEXREVVBwg6DFUXC1UHBABfCQZOR0RLBERvXVQbDRpcWlcHAQdTR0lHRVxcAREPAVEAAFBRCABVDxwWQFBTGl9BXQMEA1NXR0kTUEkQVkdeB1RqBgBHUQJTEg5eTFtUSUELXmhUAwgEC1UXC0YDFxxEUUYSRwtWFFpcGBJbXkwXAhBVFQpEUlFUARcdRlBaRQhMRxtHCxotfRIYElxPTAANF1lYXkRfRxFCFx1GWkZvFF1GFhdUWQxTQhYKGwcaSUEJUU9vBQoLC1RWRQ1cW0NEAhdTRx0aDFleXURWRWcVCgASDRJUUV1XBxdM', 
            tournament: 'Lanka Premier League' 
        },
        { id: 'ind-sl', title: 'India vs Sri Lanka - 1st ODI', time: 'Tomorrow, 02:30 PM', status: 'UPCOMING', viewers: 0, streamUrl: '', tournament: 'International Tour' }
    ],
    football: [
        { id: 'UCL-final', title: 'Real Madrid vs Manchester City', time: 'Live Now', status: 'LIVE', viewers: 45200, streamUrl: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', tournament: 'UEFA Champions League' }
    ],
    formula1: [
        { id: 'f1-monaco', title: 'Monaco Grand Prix - Main Race', time: 'Live Now', status: 'LIVE', viewers: 29100, streamUrl: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', tournament: 'F1 World Championship' }
    ]
};

// --- ROUTER SYSTEM ---
const router = {
    navigate: function(page, param = null) {
        window.scrollTo(0, 0);
        const app = document.getElementById('app');
        
        if (page === 'home') {
            app.innerHTML = renderHome();
        } else if (page === 'categories') {
            app.innerHTML = renderCategoriesList();
        } else if (page === 'category-detail') {
            app.innerHTML = renderCategoryDetail(param);
        } else if (page === 'watch') {
            app.innerHTML = renderWatchRoom(param);
            initPlayer(param);
        } else if (page === 'about') {
            app.innerHTML = renderAbout();
        }
    }
};

// --- RENDER VIEWS ---

function renderHome() {
    return `
        <div class="space-y-12">
            <div class="relative rounded-3xl overflow-hidden glass-effect p-8 sm:p-12 border border-slate-800 shadow-2xl">
                <div class="absolute inset-0 bg-gradient-to-r from-darkBg via-transparent to-accentPurple/20 z-0"></div>
                <div class="relative z-10 max-w-2xl space-y-6">
                    <span class="bg-accentNeon/10 text-accentNeon px-4 py-1.5 rounded-full text-xs font-bold tracking-widest uppercase border border-accentNeon/20">Ultimate Streaming Hub</span>
                    <h1 class="text-4xl sm:text-6xl font-extrabold tracking-tight leading-none">Stream Live Matches in <span class="bg-gradient-to-r from-accentNeon to-purple-400 bg-clip-text text-transparent">Ultra HD</span></h1>
                    <p class="text-slate-400 text-base sm:text-lg">Tokenized stream player with real-time community interaction.</p>
                    <button onclick="router.navigate('categories')" class="bg-gradient-to-r from-accentNeon to-emerald-400 text-darkBg font-bold px-8 py-4 rounded-xl hover:opacity-90 transition shadow-lg shadow-accentNeon/20 flex items-center space-x-3">
                        <span>Explore Matches</span>
                        <i class="fa-solid fa-arrow-right"></i>
                    </button>
                </div>
            </div>

            <div>
                <div class="flex items-center justify-between mb-6">
                    <h2 class="text-2xl font-bold tracking-tight">Top Categories</h2>
                    <button onclick="router.navigate('categories')" class="text-accentNeon text-sm font-semibold hover:underline">View All</button>
                </div>
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-6">
                    ${categoriesData.map(cat => `
                        <div onclick="router.navigate('category-detail', '${cat.id}')" class="group relative rounded-2xl overflow-hidden h-60 cursor-pointer glass-effect border border-slate-800 hover:border-accentNeon/50 transition duration-300">
                            <img src="${cat.image}" alt="${cat.name}" class="absolute inset-0 w-full h-full object-cover group-hover:scale-110 transition duration-500 opacity-40">
                            <div class="absolute inset-0 bg-gradient-to-t from-darkBg via-darkBg/40 to-transparent"></div>
                            <div class="absolute bottom-0 left-0 right-0 p-6 flex items-center justify-between">
                                <div>
                                    <div class="w-10 h-10 rounded-xl bg-accentNeon/20 backdrop-blur-md flex items-center justify-center text-accentNeon mb-3">
                                        <i class="fa-solid ${cat.icon}"></i>
                                    </div>
                                    <h3 class="text-xl font-bold text-white">${cat.name}</h3>
                                    <p class="text-xs text-slate-400 mt-1">${cat.count} Active Tournaments</p>
                                </div>
                                <div class="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center group-hover:bg-accentNeon group-hover:text-darkBg transition">
                                    <i class="fa-solid fa-chevron-right text-sm"></i>
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>
    `;
}

function renderCategoriesList() {
    return `
        <div class="space-y-8">
            <h1 class="text-3xl font-extrabold">All Categories</h1>
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-6">
                ${categoriesData.map(cat => `
                    <div onclick="router.navigate('category-detail', '${cat.id}')" class="group relative rounded-2xl overflow-hidden h-60 cursor-pointer glass-effect border border-slate-800 hover:border-accentNeon/50 transition">
                        <img src="${cat.image}" alt="${cat.name}" class="absolute inset-0 w-full h-full object-cover opacity-40 group-hover:scale-105 transition">
                        <div class="absolute inset-0 bg-gradient-to-t from-darkBg to-transparent"></div>
                        <div class="absolute bottom-0 left-0 right-0 p-6">
                            <h3 class="text-2xl font-bold text-white">${cat.name}</h3>
                            <p class="text-sm text-accentNeon mt-1">${cat.count} Matches Available</p>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

function renderCategoryDetail(catId) {
    const matches = matchesData[catId] || [];
    const category = categoriesData.find(c => c.id === catId);

    return `
        <div class="space-y-8">
            <div class="flex items-center space-x-4">
                <button onclick="router.navigate('home')" class="w-10 h-10 rounded-xl glass-effect flex items-center justify-center hover:bg-slate-800 transition">
                    <i class="fa-solid fa-arrow-left"></i>
                </button>
                <div>
                    <h1 class="text-3xl font-extrabold">${category ? category.name : 'Matches'}</h1>
                    <p class="text-sm text-slate-400">Select a match card below to watch stream</p>
                </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                ${matches.map(match => `
                    <div onclick="router.navigate('watch', {catId: '${catId}', matchId: '${match.id}'})" class="glass-effect rounded-2xl p-6 border border-slate-800 hover:border-accentNeon/40 cursor-pointer transition group relative flex flex-col justify-between">
                        <div>
                            <div class="flex items-center justify-between mb-4">
                                <span class="text-xs font-semibold px-3 py-1 rounded-full uppercase tracking-wider ${match.status === 'LIVE' ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-slate-800 text-slate-400'}">
                                    ${match.status === 'LIVE' ? '<i class="fa-solid fa-circle text-[8px] animate-pulse mr-1.5 text-red-500"></i> LIVE NOW' : match.status}
                                </span>
                                <span class="text-xs text-slate-400 font-medium">${match.tournament}</span>
                            </div>
                            <h3 class="text-lg font-bold text-slate-100 group-hover:text-accentNeon transition mb-3">${match.title}</h3>
                            <p class="text-sm text-slate-400"><i class="fa-regular fa-clock mr-2"></i>${match.time}</p>
                        </div>
                        <div class="mt-6 pt-4 border-t border-slate-800/80 flex items-center justify-between text-sm">
                            <span class="text-slate-400"><i class="fa-solid fa-users mr-2 text-accentNeon"></i>${match.viewers.toLocaleString()} Watching</span>
                            <span class="font-bold text-accentNeon group-hover:translate-x-1 transition flex items-center space-x-1">
                                <span>Watch</span> <i class="fa-solid fa-arrow-right text-xs"></i>
                            </span>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

function renderWatchRoom(params) {
    const match = matchesData[params.catId].find(m => m.id === params.matchId);

    return `
        <div class="space-y-6">
            <div class="flex items-center justify-between">
                <button onclick="router.navigate('category-detail', '${params.catId}')" class="glass-effect px-4 py-2 rounded-xl text-sm font-medium hover:bg-slate-800 transition flex items-center space-x-2">
                    <i class="fa-solid fa-arrow-left"></i>
                    <span>Back to Matches</span>
                </button>
                <div class="glass-effect px-4 py-2 rounded-xl text-sm font-medium flex items-center space-x-3 border border-red-500/20">
                    <span class="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse"></span>
                    <span class="text-slate-300">Live Viewers: <strong id="live-viewer-count" class="text-white">${match.viewers.toLocaleString()}</strong></span>
                </div>
            </div>

            <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <!-- Player Section -->
                <div class="lg:col-span-2 space-y-4">
                    <div class="relative rounded-3xl overflow-hidden glass-effect border border-slate-800 shadow-2xl aspect-video bg-black flex items-center justify-center">
                        <video id="video-player" class="w-full h-full object-cover" controls autoplay></video>
                    </div>
                    <div>
                        <span class="text-xs uppercase font-bold tracking-widest text-accentNeon">${match.tournament}</span>
                        <h1 class="text-2xl font-bold mt-1">${match.title}</h1>
                    </div>
                </div>

                <!-- Chat Box Section -->
                <div class="glass-effect rounded-3xl border border-slate-800 flex flex-col h-[550px] lg:h-auto overflow-hidden">
                    <div class="p-4 border-b border-slate-800 bg-slate-900/40 flex items-center justify-between">
                        <h3 class="font-bold text-sm tracking-wide flex items-center space-x-2">
                            <i class="fa-solid fa-comments text-accentNeon"></i>
                            <span>Live Match Chat</span>
                        </h3>
                        <span class="text-[10px] bg-accentNeon/10 text-accentNeon px-2 py-0.5 rounded font-bold">REAL-TIME</span>
                    </div>
                    
                    <div id="chat-messages" class="flex-grow p-4 overflow-y-auto space-y-3 text-sm">
                        <div class="bg-slate-900/60 p-2.5 rounded-xl border border-slate-800">
                            <span class="font-bold text-accentNeon text-xs">System Admin</span>
                            <p class="text-slate-300 text-xs mt-0.5">Stream is active. Enjoy the match!</p>
                        </div>
                    </div>

                    <form id="chat-form" onsubmit="handleChatSubmit(event)" class="p-3 border-t border-slate-800 bg-slate-900/60 flex items-center space-x-2">
                        <input type="text" id="chat-input" placeholder="Say something..." autocomplete="off" class="flex-grow bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-accentNeon transition">
                        <button type="submit" class="bg-accentNeon text-darkBg font-bold px-4 py-2.5 rounded-xl text-xs hover:opacity-90 transition">
                            <i class="fa-solid fa-paper-plane"></i>
                        </button>
                    </form>
                </div>
            </div>
        </div>
    `;
}

function renderAbout() {
    return `
        <div class="max-w-3xl mx-auto space-y-8 glass-effect p-8 sm:p-12 rounded-3xl border border-slate-800">
            <h1 class="text-4xl font-extrabold">About VORTEX LIVE</h1>
            <p class="text-slate-300 leading-relaxed">
                VORTEX LIVE supports direct tokenized streaming sources for seamless high-definition sports playback.
            </p>
        </div>
    `;
}

// --- STREAM INITIALIZER (HLS & TS SUPPORT) ---

function initPlayer(params) {
    const match = matchesData[params.catId].find(m => m.id === params.matchId);
    const video = document.getElementById('video-player');
    const videoSrc = match.streamUrl;

    if (Hls.isSupported() && (videoSrc.endsWith('.m3u8') || videoSrc.includes('.ts'))) {
        const hls = new Hls();
        hls.loadSource(videoSrc);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, function() {
            video.play().catch(e => console.log("Auto-play blocked:", e));
        });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        // Safari සහ iOS සඳහා natice support එක
        video.src = videoSrc;
        video.addEventListener('loadedmetadata', function() {
            video.play();
        });
    } else {
        // සාමාන්‍ය Direct MP4 හෝ වෙනත් ලිපිනයන් සඳහා
        video.src = videoSrc;
        video.play().catch(e => console.log("Auto-play blocked:", e));
    }

    // Viewer count fluctuation simulation
    setInterval(() => {
        const countEl = document.getElementById('live-viewer-count');
        if (countEl) {
            const fluctuation = Math.floor(Math.random() * 11) - 5;
            match.viewers += fluctuation;
            countEl.innerText = match.viewers.toLocaleString();
        }
    }, 4000);
}

function handleChatSubmit(event) {
    event.preventDefault();
    const input = document.getElementById('chat-input');
    const msg = input.value.trim();
    if(!msg) return;

    const chatContainer = document.getElementById('chat-messages');
    const randomNames = ['CryptoKing', 'StrikerX', 'MatchLover', 'VortexUser', 'LionHeart'];
    const randomName = randomNames[Math.floor(Math.random() * randomNames.length)];

    const bubble = document.createElement('div');
    bubble.className = 'bg-slate-900/60 p-2.5 rounded-xl border border-slate-800';
    bubble.innerHTML = `
        <span class="font-bold text-accentNeon text-xs">${randomName}</span>
        <p class="text-slate-300 text-xs mt-0.5">${escapeHtml(msg)}</p>
    `;
    
    chatContainer.appendChild(bubble);
    chatContainer.scrollTop = chatContainer.scrollHeight;
    input.value = '';
}

function escapeHtml(text) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

document.addEventListener('DOMContentLoaded', () => {
    router.navigate('home');
});
