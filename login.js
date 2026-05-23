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

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        
        // Disable button during "loading" state
        const originalBtnHtml = loginBtn.innerHTML;
        loginBtn.disabled = true;
        loginBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>Autenticando...</span>';
        
        try {
            const { data, error } = await supabaseClient.auth.signInWithPassword({
                email: email,
                password: password,
            });
            
            if (error) {
                throw error;
            }
            
            if (data.session) {
                showToast('Login Efetuado', 'Redirecionando para o Dashboard...');
                
                // Redireciona para o monitor principal após pequeno delay
                setTimeout(() => {
                    window.location.href = '/';
                }, 1000);
            }
        } catch (error) {
            let errorMsg = error.message;
            if (errorMsg === 'Invalid login credentials') {
                errorMsg = 'E-mail ou senha inválidos.';
            }
            showToast('Erro de Autenticação', errorMsg, false);
            loginBtn.disabled = false;
            loginBtn.innerHTML = originalBtnHtml;
        }
    });
});
