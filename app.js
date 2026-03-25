// Configuración
const SUPABASE_URL = 'https://YOUR_PROJECT_ID.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY';

// Variables globales
let tg = window.Telegram.WebApp;
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
    tg.ready();
    tg.expand();
    
    // Obtener datos de Telegram
    const initData = tg.initData;
    
    if (!initData) {
        alert('Esta app solo funciona dentro de Telegram');
        return;
    }
    
    try {
        // Validar usuario con Supabase
        const response = await fetch(`${SUPABASE_URL}/functions/v1/validate-telegram`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
            },
            body: JSON.stringify({ initData })
        });
        
        if (!response.ok) {
            throw new Error('Error validando usuario');
        }
        
        const data = await response.json();
        userData = data.user;
        userId = data.user.id;
        
        // Actualizar UI
        usernameEl.textContent = `@${userData.username || userData.first_name}`;
        
        // Cargar clicks
        await loadClicks();
        
        // Mostrar contenido principal
        loadingEl.classList.remove('active');
        mainEl.classList.add('active');
        
    } catch (error) {
        console.error('Error:', error);
        loadingEl.innerHTML = '<p>Error al cargar. Reinicia la app.</p>';
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