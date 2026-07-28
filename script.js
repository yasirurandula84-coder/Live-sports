
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
            title: 'LPL 2026: Tokenized Live Stream', 
            time: 'Live Now', 
            status: 'LIVE', 
            viewers: 15420, 
            streamUrl: 'http://9937675.j13m.cc/live/fouaadkhadi/E7JWd8N9/1410913.ts?token=ShoJV0NcEgMVDABSXFIDVABXA1cAVAgFBAwAAgADWwZUXlcDBQUHDwEaSUEXREVVBwg6DFUXC1UHBABfCQZOR0RLBERvXVQbDRpcWlcHAQdTR0lHRVxcAREPAVEAAFBRCABVDxwWQFBTGl9BXQMEA1NXR0kTUEkQVkdeB1RqBgBHUQJTEg5eTFtUSUELXmhUAwgEC1UXC0YDFxxEUUYSRwtWFFpcGBJbXkwXAhBVFQpEUlFUARcdRlBaRQhMRxtHCxotfRIYElxPTAANF1lYXkRfRxFCFx1GWkZvFF1GFhdUWQxTQhYKGwcaSUEJUU9vBQoLC1RWRQ1cW0NEAhdTRx0aDFleXURWRWcVCgASDRJUUV1XBxdM', 
            tournament: 'Lanka Premier League' 
        },
        { id: 'ind-sl', title: 'India vs Sri Lanka - 1st ODI', time: 'Tomorrow, 02:30 PM', status: 'UPCOMING', viewers: 0, streamUrl: '', tournament: 'International Tour' },
        { id: 'psl-02', title: 'Lahore Qalandars vs Karachi Kings', time: 'Live Now', status: 'LIVE', viewers: 9120, streamUrl: '', tournament: 'Pakistan Super League' }
    ],
    football: [
        { id: 'UCL-final', title: 'Real Madrid vs Manchester City', time: 'Live Now', status: 'LIVE', viewers: 48500, streamUrl: '', tournament: 'UEFA Champions League' }
    ],
    formula1: [
        { id: 'f1-monaco', title: 'Monaco Grand Prix - Main Race', time: 'Live Now', status: 'LIVE', viewers: 31200, streamUrl: '', tournament: 'F1 World Championship' }
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
        <div style="display: flex; flex-direction: column; gap: 48px;">
            <!-- Hero Banner -->
            <div class="hero-banner glass-effect">
                <div style="position: absolute; inset: 0; background: linear-gradient(90deg, #090d16 0%, transparent 70%); z-index: 1;"></div>
                <div class="hero-content">
                    <span class="hero-tag">Ultimate Streaming Hub</span>
                    <h1>Stream Live Matches in <span class="gradient-text">Ultra HD</span></h1>
                    <p>Experience zero-lag tokenized sports streaming with lightning-fast servers and interactive live chat.</p>
                    <button onclick="router.navigate('categories')" class="btn-primary">
                        <span>Explore Matches</span>
                        <i class="fa-solid fa-arrow-right"></i>
                    </button>
                </div>
            </div>

            <!-- Categories Section -->
            <div>
                <div class="section-title-row">
                    <h2>Top Categories</h2>
                    <button onclick="router.navigate('categories')" class="view-all-btn">View All</button>
                </div>
                <div class="grid-3">
                    ${categoriesData.map(cat => `
                        <div onclick="router.navigate('category-detail', '${cat.id}')" class="category-card glass-effect">
                            <img src="${cat.image}" alt="${cat.name}">
                            <div class="overlay"></div>
                            <div class="content">
                                <div>
                                    <div class="cat-icon-box">
                                        <i class="fa-solid ${cat.icon}"></i>
                                    </div>
                                    <h3 style="font-size: 20px; font-weight: 700; color: #fff;">${cat.name}</h3>
                                    <p style="font-size: 12px; color: #94a3b8; margin-top: 4px;">${cat.count} Tournaments Active</p>
                                </div>
                                <div class="cat-arrow">
                                    <i class="fa-solid fa-chevron-right" style="font-size: 12px;"></i>
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
        <div style="display: flex; flex-direction: column; gap: 32px;">
            <h1 style="font-size: 32px; font-weight: 800;">All Categories</h1>
            <div class="grid-3">
                ${categoriesData.map(cat => `
                    <div onclick="router.navigate('category-detail', '${cat.id}')" class="category-card glass-effect">
                        <img src="${cat.image}" alt="${cat.name}">
                        <div class="overlay"></div>
                        <div class="content">
                            <div>
                                <h3 style="font-size: 24px; font-weight: 700; color: #fff;">${cat.name}</h3>
                                <p style="font-size: 13px; color: #00ffcc; margin-top: 4px; font-weight: 600;">${cat.count} Matches Available</p>
                            </div>
                            <div class="cat-arrow">
                                <i class="fa-solid fa-chevron-right" style="font-size: 12px;"></i>
                            </div>
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
        <div style="display: flex; flex-direction: column; gap: 32px;">
            <div style="display: flex; align-items: center; gap: 16px;">
                <button onclick="router.navigate('home')" class="back-btn glass-effect" style="color: #fff;">
                    <i class="fa-solid fa-arrow-left"></i>
                    <span>Back</span>
                </button>
                <div>
                    <h1 style="font-size: 30px; font-weight: 800;">${category ? category.name : 'Matches'}</h1>
                    <p style="font-size: 14px; color: #94a3b8; margin-top: 2px;">Select a match card below to watch stream & join chat</p>
                </div>
            </div>

            <div class="grid-3">
                ${matches.map(match => `
                    <div onclick="router.navigate('watch', {catId: '${catId}', matchId: '${match.id}'})" class="match-card glass-effect">
                        <div>
                            <div class="flex-between">
                                <span class="match-status ${match.status === 'LIVE' ? 'status-live' : 'status-upcoming'}">
                                    ${match.status === 'LIVE' ? '<i class="fa-solid fa-circle" style="font-size: 6px;"></i> LIVE' : match.status}
                                </span>
                                <span style="font-size: 12px; color: #94a3b8; font-weight: 600;">${match.tournament}</span>
                            </div>
                            <h3 class="match-title">${match.title}</h3>
                            <div class="match-meta">
                                <i class="fa-regular fa-clock"></i>
                                <span>${match.time}</span>
                            </div>
                        </div>
                        <div class="match-footer">
                            <span style="color: #94a3b8;"><i class="fa-solid fa-users" style="color: #00ffcc; margin-right: 6px;"></i>${match.viewers.toLocaleString()} Watching</span>
                            <div class="watch-link">
                                <span>Watch Live</span>
                                <i class="fa-solid fa-arrow-right" style="font-size: 12px;"></i>
                            </div>
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
        <div style="display: flex; flex-direction: column; gap: 24px;">
            <div class="flex-between">
                <button onclick="router.navigate('category-detail', '${params.catId}')" class="back-btn glass-effect" style="color: #fff;">
                    <i class="fa-solid fa-arrow-left"></i>
                    <span>Back to Matches</span>
                </button>
                <div class="glass-effect" style="padding: 8px 16px; border-radius: 12px; font-size: 14px; display: flex; align-items: center; gap: 10px; border-color: rgba(239, 68, 68, 0.3);">
                    <span class="live-dot"></span>
                    <span style="color: #cbd5e1;">Live Viewers: <strong id="live-viewer-count" style="color: #fff;">${match.viewers.toLocaleString()}</strong></span>
                </div>
            </div>

            <div class="watch-grid">
                <!-- Video Stream Section -->
                <div style="display: flex; flex-direction: column; gap: 16px;">
                    <div class="video-container">
                        <video id="live-player" controls autoplay muted></video>
                    </div>
                    <div>
                        <span style="font-size: 11px; font-weight: 700; color: #00ffcc; text-transform: uppercase; letter-spacing: 1px;">${match.tournament}</span>
                        <h1 style="font-size: 24px; font-weight: 800; margin-top: 4px;">${match.title}</h1>
                    </div>
                </div>

                <!-- Live Chat Section -->
                <div class="chat-box-wrapper glass-effect">
                    <div class="chat-header">
                        <div style="display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 14px;">
                            <i class="fa-solid fa-comments" style="color: #00ffcc;"></i>
                            <span>Live Match Chat</span>
                        </div>
                        <span style="font-size: 10px; background: rgba(0,255,204,0.15); color: #00ffcc; padding: 3px 8px; border-radius: 6px; font-weight: 700;">REAL-TIME</span>
                    </div>

                    <div id="chat-messages" class="chat-messages">
                        <div class="chat-bubble">
                            <span class="username">System Admin</span>
                            <p style="color: #cbd5e1; font-size: 13px;">Welcome to the match chat! Keep comments respectful and enjoy the game.</p>
                        </div>
                    </div>

                    <form id="chat-form" onsubmit="handleChatSubmit(event)" class="chat-form">
                        <input type="text" id="chat-input" placeholder="Type your message..." autocomplete="off" class="chat-input">
                        <button type="submit" class="chat-send-btn">
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
        <div class="glass-effect" style="max-width: 750px; margin: 0 auto; padding: 48px; border-radius: 24px; display: flex; flex-direction: column; gap: 24px;">
            <h1 style="font-size: 36px; font-weight: 800;" class="gradient-text">About VORTEX LIVE</h1>
            <p style="color: #cbd5e1; line-height: 1.7; font-size: 16px;">
                VORTEX LIVE is an advanced next-generation sports streaming platform built to stream high-definition events globally without latency issues, utilizing secure token-based streaming protocols.
            </p>
        </div>
    `;
}

// --- PLAYER INIT & INTERACTION ---

function initPlayer(params) {
    const match = matchesData[params.catId].find(m => m.id === params.matchId);
    const video = document.getElementById('live-player');
    const rawVideoSrc = match.streamUrl;

    if (!rawVideoSrc) return;

    // Browser එකේ CORS සහ Headers ප්‍රශ්න මඟහරවා ගැනීමට Proxy එකක් හරහා යැවීම
    // (ඔබට අවශ්‍ය නම් ඔබේම small proxy එකක් හෝ public cors proxy එකක් පාවිච්චි කළ හැක)
    const videoSrc = rawVideoSrc; 

    if (Hls.isSupported()) {
        const hls = new Hls({
            xhrSetup: function (xhr, url) {
                // මෙහිදී බ්‍රව්සරයට දිය හැකි headers සකස් කෙරේ
                xhr.setRequestHeader('Referer', 'https://www.fancode.com/');
                xhr.setRequestHeader('Icy-MetaData', '1');
            }
        });
        
        hls.loadSource(videoSrc);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, function() {
            video.play().catch(e => console.log("Autoplay blocked:", e));
        });
        
        hls.on(Hls.Events.ERROR, function(event, data) {
            console.error("HLS Error:", data);
            if (data.fatal) {
                switch(data.type) {
                    case Hls.ErrorTypes.NetworkError:
                        console.log("Network error try to recover...");
                        hls.startLoad();
                        break;
                    case Hls.ErrorTypes.MediaError:
                        console.log("Media error try to recover...");
                        hls.recoverMediaError();
                        break;
                    default:
                        hls.destroy();
                        break;
                }
            }
        });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = videoSrc;
        video.addEventListener('loadedmetadata', function() {
            video.play();
        });
    }
}


    // Viewers fluctuation
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
    const randomNames = ['CryptoKing', 'StrikerX', 'MatchFan', 'VortexUser', 'LionHeart', 'SuperStriker'];
    const randomName = randomNames[Math.floor(Math.random() * randomNames.length)];

    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    bubble.innerHTML = `
        <span class="username">${randomName}</span>
        <p style="color: #cbd5e1; font-size: 13px;">${escapeHtml(msg)}</p>
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
