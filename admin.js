import { supabaseClient } from './supabase-config.js';

let currentUser = null;
let usageChart = null;
const API_URL = '/api/admin/users';

const checkAdminSession = async () => {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) {
        window.location.href = '/login';
        return;
    }
    currentUser = session.user;
    
    // Check if user is admin
    const { data } = await supabaseClient.from('profiles').select('is_admin').eq('id', currentUser.id).single();
    if (!data || !data.is_admin) {
        alert('Acesso negado. Esta página é restrita a administradores.\nSe você for o dono, altere a coluna "is_admin" do seu perfil para TRUE no banco de dados.');
        window.location.href = '/';
        return;
    }
    
    const mainAdminContainer = document.getElementById('main-admin-container');
    if (mainAdminContainer) mainAdminContainer.style.display = 'block';
    
    loadDashboard();
};

document.getElementById('logout-btn').addEventListener('click', () => {
    window.location.href = '/';
});

const isOnline = (lastPing) => {
    if (!lastPing) return false;
    const diff = new Date() - new Date(lastPing);
    return diff < 120000; // 2 minutes window for ping
};

const loadDashboard = async () => {
    const { data: profiles, error } = await supabaseClient.from('profiles').select('*').order('created_at', { ascending: false });
    if (error) {
        console.error("Erro ao buscar perfis:", error);
        return;
    }

    let onlineCount = 0;
    let totalMinutes = 0;
    
    const tbody = document.getElementById('users-tbody');
    tbody.innerHTML = '';

    profiles.forEach(p => {
        const online = isOnline(p.last_ping_at);
        if (online) onlineCount++;
        totalMinutes += (p.total_time_spent_minutes || 0);

        const expDateObj = p.access_expires_at ? new Date(p.access_expires_at) : null;
        const isExpired = expDateObj ? new Date() > expDateObj : false;
        const expiredBadge = isExpired ? '<span style="background: rgba(255, 51, 102, 0.15); border: 1px solid rgba(255, 51, 102, 0.3); color: var(--danger); padding: 3px 8px; border-radius: 4px; font-size: 0.7rem; margin-left: 8px; font-weight: 700; white-space: nowrap;"><i class="fa-solid fa-circle-exclamation"></i> Acesso Vencido</span>' : '';

        const tr = document.createElement('tr');
        if (isExpired) {
            tr.style.background = 'rgba(255, 51, 102, 0.03)';
            tr.style.borderLeft = '3px solid var(--danger)';
        }
        
        tr.innerHTML = `
            <td style="font-weight: 500;">
                ${p.email} 
                ${p.is_admin ? '<i class="fa-solid fa-crown" style="color: gold; margin-left: 5px;" title="Admin"></i>' : ''}
                ${expiredBadge}
            </td>
            <td>
                <select class="plan-select" data-id="${p.id}">
                    <option value="Básico" ${p.plan === 'Básico' ? 'selected' : ''}>Básico</option>
                    <option value="Premium" ${p.plan === 'Premium' ? 'selected' : ''}>Premium</option>
                    <option value="Vitalício" ${p.plan === 'Vitalício' ? 'selected' : ''}>Vitalício</option>
                </select>
            </td>
            <td>
                <input type="date" class="exp-input" data-id="${p.id}" value="${p.access_expires_at ? p.access_expires_at.split('T')[0] : ''}">
            </td>
            <td>${p.total_time_spent_minutes || 0} min</td>
            <td><span class="status-badge ${online ? 'status-online' : 'status-offline'}">${online ? 'Online' : 'Offline'}</span></td>
            <td>
                <button class="action-btn save-btn" data-id="${p.id}" title="Salvar Alterações"><i class="fa-solid fa-save"></i></button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    document.getElementById('stat-total-users').textContent = profiles.length;
    document.getElementById('stat-online-users').textContent = onlineCount;
    document.getElementById('stat-total-time').textContent = (totalMinutes / 60).toFixed(1);

    bindRowActions();
    renderChart(profiles);
};

const renderChart = (profiles) => {
    const ctx = document.getElementById('usageChart').getContext('2d');
    
    // Sort profiles by time spent
    const sorted = [...profiles].sort((a,b) => (b.total_time_spent_minutes || 0) - (a.total_time_spent_minutes || 0));
    const labels = sorted.slice(0, 10).map(p => p.email.split('@')[0]);
    const data = sorted.slice(0, 10).map(p => p.total_time_spent_minutes || 0);

    if (usageChart) usageChart.destroy();

    usageChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Tempo de Uso (Minutos) - Top 10',
                data: data,
                backgroundColor: 'rgba(0, 255, 204, 0.6)',
                borderColor: 'rgba(0, 255, 204, 1)',
                borderWidth: 1,
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: 'rgba(255,255,255,0.5)' } },
                x: { grid: { display: false }, ticks: { color: 'rgba(255,255,255,0.7)' } }
            },
            plugins: {
                legend: { labels: { color: '#fff' } }
            }
        }
    });
};

const bindRowActions = () => {
    document.querySelectorAll('.save-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const button = e.currentTarget;
            const id = button.dataset.id;
            const tr = button.closest('tr');
            const plan = tr.querySelector('.plan-select').value;
            const expDate = tr.querySelector('.exp-input').value;
            
            const btnOriginal = button.innerHTML;
            button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
            
            try {
                const { error } = await supabaseClient.from('profiles').update({
                    plan: plan,
                    access_expires_at: expDate ? new Date(expDate).toISOString() : null
                }).eq('id', id);
                
                if(error) throw error;
                
                // Show success feedback
                button.innerHTML = '<i class="fa-solid fa-check"></i>';
                setTimeout(() => {
                    button.innerHTML = btnOriginal;
                    // Recarrega o dashboard para atualizar os badges visuais (Expirado/Ativo)
                    loadDashboard();
                }, 1000);
            } catch(error) {
                alert('Erro ao atualizar: ' + (error.message || error));
                button.innerHTML = btnOriginal;
            }
        });
    });

};

checkAdminSession();
setInterval(loadDashboard, 30000); // Auto update every 30s
