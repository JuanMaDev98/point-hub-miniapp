// Configuración
const SUPABASE_URL = 'https://fxtgotsnnsuqbynkbvik.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_rAWHFK8uUjUCWOdOibHEIw_nT0pEPWw';

// Variables globales (Telegram solo existe dentro de la Mini App)
const tg = window.Telegram?.WebApp;
let userId = null;
let userData = null;

// Elementos del DOM
const loadingEl = document.getElementById('loading');
const mainEl = document.querySelector('main');
const usernameEl = document.getElementById('username');
const clickCountEl = document.getElementById('click-count');
const clickBtn = document.getElementById('click-btn');
const leaderboardBtn = document.getElementById('leaderboard-btn');
const modal = document.getElementById('leaderboard-modal');
const closeModal = document.getElementById('close-modal');
const leaderboardList = document.getElementById('leaderboard-list');

// Inicializar
async function init() {
    console.log('🚀 [INIT] Starting...');
    console.log('🌐 [INIT] SUPABASE_URL:', SUPABASE_URL);

    loadingEl.classList.add('active');

    if (!tg) {
        loadingEl.innerHTML =
            '<p style="color:red">⚠️ Abre esta app desde Telegram (Menú del bot → Mini App).</p>';
        return;
    }

    tg.ready();
    tg.expand();

    const initData = tg.initData;
    console.log('📦 [INIT] initData present:', !!initData);

    if (!initData) {
        loadingEl.innerHTML =
            '<p style="color:red">⚠️ No hay sesión de Telegram. Abre el enlace desde el bot.</p>';
        return;
    }
    
    try {
        console.log('🔐 [INIT] Calling validate-telegram...');
        
        const response = await fetch(`${SUPABASE_URL}/functions/v1/validate-telegram`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
            },
            body: JSON.stringify({ initData })
        });
        
        console.log('📡 [INIT] Status:', response.status);
        console.log('📡 [INIT] Headers:', [...response.headers.entries()]);
        
        const text = await response.text();
        console.log('📡 [INIT] Body:', text);

        if (!response.ok) {
            let msg = text;
            try {
                const err = JSON.parse(text);
                if (err && typeof err.error === 'string') msg = err.error;
            } catch (_) {
                /* cuerpo no JSON */
            }
            throw new Error(msg || `HTTP ${response.status}`);
        }
        
        const data = JSON.parse(text);
        console.log('✅ [INIT] User:', data.user);
        
        userData = data.user;
        userId = data.user.id;
        usernameEl.textContent = `@${userData.username || userData.first_name}`;
        
        await loadClicks();
        
        loadingEl.classList.remove('active');
        mainEl.classList.add('active');
        console.log('🎉 [INIT] Done!');
        
    } catch (error) {
        console.error('💥 [INIT] Error:', error);
        loadingEl.innerHTML = `
            <p style="color:red">❌ ${error.message}</p>
            <p style="font-size:11px">Consola: F12</p>
        `;
    }
}

// Cargar clicks del usuario
async function loadClicks() {
    try {
        const response = await fetch(`${SUPABASE_URL}/functions/v1/get-clicks`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
            },
            body: JSON.stringify({ userId })
        });
        
        const data = await response.json();
        clickCountEl.textContent = data.clicks || 0;
        
    } catch (error) {
        console.error('Error cargando clicks:', error);
    }
}

// Actualizar clicks
async function updateClicks() {
    try {
        const response = await fetch(`${SUPABASE_URL}/functions/v1/update-clicks`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
            },
            body: JSON.stringify({ userId })
        });
        
        const data = await response.json();
        clickCountEl.textContent = data.clicks;
        
        // Feedback visual
        clickBtn.style.transform = 'scale(0.95)';
        setTimeout(() => {
            clickBtn.style.transform = 'scale(1)';
        }, 100);
        
    } catch (error) {
        console.error('Error actualizando clicks:', error);
    }
}

// Cargar leaderboard
async function loadLeaderboard() {
    leaderboardList.innerHTML = '<div class="loading"><div class="spinner"></div><p>Cargando...</p></div>';
    
    try {
        const response = await fetch(`${SUPABASE_URL}/functions/v1/get-leaderboard`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
            }
        });
        
        const data = await response.json();
        
        if (data.users && data.users.length > 0) {
            leaderboardList.innerHTML = data.users.map((user, index) => {
                const rankClass = index === 0 ? 'gold' : index === 1 ? 'silver' : index === 2 ? 'bronze' : '';
                const isCurrentUser = user.id === userId ? 'current-user' : '';
                
                return `
                    <div class="leaderboard-item ${isCurrentUser}">
                        <span class="leaderboard-rank ${rankClass}">#${index + 1}</span>
                        <span class="leaderboard-user">${user.username || user.first_name}</span>
                        <span class="leaderboard-clicks">${user.clicks} 👆</span>
                    </div>
                `;
            }).join('');
        } else {
            leaderboardList.innerHTML = '<p style="text-align: center; padding: 20px;">Sin datos aún</p>';
        }
        
    } catch (error) {
        console.error('Error cargando leaderboard:', error);
        leaderboardList.innerHTML = '<p style="text-align: center; padding: 20px; color: red;">Error al cargar</p>';
    }
}

// Event Listeners
clickBtn.addEventListener('click', updateClicks);

leaderboardBtn.addEventListener('click', () => {
    modal.classList.add('active');
    loadLeaderboard();
});

closeModal.addEventListener('click', () => {
    modal.classList.remove('active');
});

modal.addEventListener('click', (e) => {
    if (e.target === modal) {
        modal.classList.remove('active');
    }
});

// Iniciar app
init();