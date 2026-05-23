import { supabaseClient } from './supabase-config.js';

document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('login-form');
    const loginBtn = document.getElementById('login-btn');
    const toastContainer = document.getElementById('toast-container');

    // Toast Notification System
    const showToast = (title, message, isSuccess = true) => {
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.style.borderColor = isSuccess ? 'var(--primary)' : 'var(--danger)';
        toast.style.borderLeftColor = isSuccess ? 'var(--primary)' : 'var(--danger)';
        
        const icon = isSuccess ? '<i class="fa-solid fa-check-circle"></i>' : '<i class="fa-solid fa-triangle-exclamation" style="color: var(--danger)"></i>';
        
        toast.innerHTML = `
            ${icon}
            <div class="toast-content">
                <h4>${title}</h4>
                <p>${message}</p>
            </div>
        `;
        
        toastContainer.appendChild(toast);
        setTimeout(() => toast.classList.add('show'), 100);
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 400);
        }, 5000);
    };

    // If already logged in, check if admin and redirect
    const checkExistingSession = async () => {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (session) {
            const { data } = await supabaseClient.from('profiles').select('is_admin').eq('id', session.user.id).single();
            if (data && data.is_admin) {
                window.location.href = '/admin';
            }
        }
    };
    checkExistingSession();

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        
        const originalBtnHtml = loginBtn.innerHTML;
        loginBtn.disabled = true;
        loginBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>Verificando credenciais...</span>';
        
        try {
            const { data, error } = await supabaseClient.auth.signInWithPassword({
                email: email,
                password: password,
            });
            
            if (error) {
                throw error;
            }
            
            if (data.session) {
                // Check if user is admin
                const { data: profileData, error: profileError } = await supabaseClient
                    .from('profiles')
                    .select('is_admin')
                    .eq('id', data.session.user.id)
                    .single();

                if (profileError || !profileData || !profileData.is_admin) {
                    // Not an admin
                    await supabaseClient.auth.signOut();
                    throw new Error("Acesso negado. Esta conta não possui privilégios de administrador.");
                }

                showToast('Acesso Liberado', 'Redirecionando para o Painel Administrativo...');
                
                setTimeout(() => {
                    window.location.href = '/admin';
                }, 1000);
            }
        } catch (error) {
            let errorMsg = error.message;
            if (errorMsg === 'Invalid login credentials') {
                errorMsg = 'E-mail ou senha inválidos.';
            }
            showToast('Falha de Segurança', errorMsg, false);
            loginBtn.disabled = false;
            loginBtn.innerHTML = originalBtnHtml;
        }
    });
});
