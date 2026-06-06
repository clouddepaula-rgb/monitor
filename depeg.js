import { supabaseClient } from './supabase-config.js';

const API_BASE = "";
let currentUser = null;

const checkSession = async () => {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) {
        window.location.href = '/login';
        return;
    }
    currentUser = session.user;

    // Check if user is admin
    const { data } = await supabaseClient.from('profiles').select('is_admin').eq('id', currentUser.id).single();
    if (data && data.is_admin) {
        document.getElementById('admin-link').style.display = 'inline-flex';
        const addPanel = document.getElementById('admin-add-token-panel');
        if (addPanel) addPanel.style.display = 'block';
    }

    const mainContainer = document.getElementById('main-depeg-container');
    if (mainContainer) mainContainer.style.display = 'block';

    initDepegMonitor();
};

document.getElementById('logout-btn').addEventListener('click', async () => {
    await supabaseClient.auth.signOut();
    window.location.href = '/login';
});

checkSession();

// --- TELEGRAM CONFIG ---
const TG_TOKEN = "8594414718:AAEpaCZxxm-wHefIqfE9R4sdiZq63Y4Ipy8";
const TG_CHAT_ID = "1836350347";

// --- STATE ---
let depegConfigs = [
    { symbol: 'USDT', coingecko_id: 'tether', target_peg: 1.00, peg_currency: 'USD', threshold_pct: 10, is_active: true, network: 'Global' },
    { symbol: 'USDC', coingecko_id: 'usd-coin', target_peg: 1.00, peg_currency: 'USD', threshold_pct: 10, is_active: true, network: 'Global' },
    { symbol: 'DAI', coingecko_id: 'dai', target_peg: 1.00, peg_currency: 'USD', threshold_pct: 10, is_active: true, network: 'Global' },
    { symbol: 'FDUSD', coingecko_id: 'first-digital-usd', target_peg: 1.00, peg_currency: 'USD', threshold_pct: 10, is_active: true, network: 'Global' },
    { symbol: 'USDE', coingecko_id: 'ethena-usde', target_peg: 1.00, peg_currency: 'USD', threshold_pct: 10, is_active: true, network: 'Global' },
    { symbol: 'PYUSD', coingecko_id: 'paypal-usd', target_peg: 1.00, peg_currency: 'USD', threshold_pct: 10, is_active: true, network: 'Global' },
    { symbol: 'BRZ', coingecko_id: 'brz', target_peg: 0.18, peg_currency: 'USD', threshold_pct: 10, is_active: true, network: 'Polygon' },
    { symbol: 'BRLA', coingecko_id: null, target_peg: 0.18, peg_currency: 'USD', threshold_pct: 10, is_active: true, network: 'Polygon' } // Fetched via DEX logic
];

let depegHistory = [];
let soundEnabled = false;
let audioCtx = null;
let activeAlarmInterval = null;
let prices = {};
let previousStates = {}; // track if a coin was depegged to trigger 'RECOVERED' events

const CONTRACTS = {
    usdt: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
    brz: "0x4eD141110F6EeeAbA9A1df36d8c26f684d2475Dc",
    brla: "0xe6a537a407488807f0bbeb0038b79004f19dddfb"
};

// --- DOM ELEMENTS ---
const container = document.getElementById('depeg-cards-container');
const template = document.getElementById('depeg-card-template');
const toastContainer = document.getElementById('toast-container');
const soundToggle = document.getElementById('sound-toggle');
const historyList = document.getElementById('depeg-history-list');
const apiStatus = document.getElementById('api-status');

// --- SOUND LOGIC ---
const playAlarm = () => {
    if (!soundEnabled) return;
    try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();

        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();

        // High Alert Depeg Siren (Distinct from arbitrage beep)
        oscillator.type = 'sawtooth';

        oscillator.frequency.setValueAtTime(800, audioCtx.currentTime);
        oscillator.frequency.linearRampToValueAtTime(1200, audioCtx.currentTime + 0.4);
        oscillator.frequency.setValueAtTime(1200, audioCtx.currentTime + 0.4);
        oscillator.frequency.linearRampToValueAtTime(800, audioCtx.currentTime + 0.8);

        gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
        gainNode.gain.linearRampToValueAtTime(0.5, audioCtx.currentTime + 0.1);
        gainNode.gain.setValueAtTime(0.5, audioCtx.currentTime + 0.7);
        gainNode.gain.linearRampToValueAtTime(0.01, audioCtx.currentTime + 0.8);

        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        oscillator.start(audioCtx.currentTime);
        oscillator.stop(audioCtx.currentTime + 0.8);
    } catch (e) { }
};

const triggerRepeatingAlarm = () => {
    if (!activeAlarmInterval && soundEnabled) {
        playAlarm(); // Play immediately
        activeAlarmInterval = setInterval(playAlarm, 1000);
    }
};

const stopRepeatingAlarm = () => {
    if (activeAlarmInterval) {
        clearInterval(activeAlarmInterval);
        activeAlarmInterval = null;
    }
};

soundToggle.addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    if (soundEnabled) {
        soundToggle.classList.remove('off');
        soundToggle.classList.add('on');
        soundToggle.innerHTML = '<i class="fa-solid fa-bell"></i> Alarmes: ON';
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } else {
        soundToggle.classList.remove('on');
        soundToggle.classList.add('off');
        soundToggle.innerHTML = '<i class="fa-solid fa-bell-slash"></i> Alarmes: OFF';
        stopRepeatingAlarm();
    }
});

// --- TOAST NOTIFICATIONS ---
const showToast = (title, message, type = 'info') => {
    const toast = document.createElement('div');
    toast.className = 'toast';

    let iconStr = '<i class="fa-solid fa-info-circle"></i>';
    let color = 'var(--text-main)';

    if (type === 'danger') {
        color = 'var(--danger)';
        iconStr = `<i class="fa-solid fa-triangle-exclamation" style="color: ${color}"></i>`;
    } else if (type === 'warning') {
        color = '#ffaa00';
        iconStr = `<i class="fa-solid fa-circle-exclamation" style="color: ${color}"></i>`;
    } else if (type === 'success') {
        color = 'var(--profit)';
        iconStr = `<i class="fa-solid fa-check-circle" style="color: ${color}"></i>`;
    }

    toast.style.borderColor = color;
    toast.style.borderLeftColor = color;

    toast.innerHTML = `
        ${iconStr}
        <div class="toast-content">
            <h4 style="color: ${color}; margin-bottom: 2px;">${title}</h4>
            <p>${message}</p>
        </div>
    `;

    toastContainer.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 100);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 400);
    }, 6000);
};

// --- TELEGRAM NOTIFICATIONS ---
const sendTelegramAlert = async (symbol, network, price, target_peg, devPct, isDepeg, isReminder = false) => {
    if (!TG_TOKEN || !TG_CHAT_ID) return;
    
    const statusEmoji = isDepeg ? "🔴" : "🟢";
    let statusText = isDepeg ? "ALERTA DE DEPEG" : "PEG RECUPERADO";
    if (isReminder) {
        statusText = "LEMBRETE: DEPEG ATIVO";
    }
    
    const direction = devPct > 0 ? "Ágio (Acima do Peg)" : "Deságio (Abaixo do Peg)";
    const devFormatted = `${devPct > 0 ? '+' : ''}${devPct.toFixed(2)}%`;
    
    const message = `
🚨 *${statusText}* 🚨

*Moeda:* ${symbol} (${network})
*Preço Atual:* $${price.toFixed(4)}
*Alvo:* $${target_peg.toFixed(4)}
*Desvio:* ${devFormatted} ${statusEmoji}
*Direção:* ${direction}
${isReminder ? '\n⚠️ _Este ativo continua fora dos limites configurados._' : ''}

_ArbDash Monitor de Depegs_
    `.trim();

    try {
        await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: TG_CHAT_ID,
                text: message,
                parse_mode: 'Markdown'
            })
        });
    } catch(e) {
        console.error("Failed to send telegram message:", e);
    }
};

const updateApiStatus = (isOnline) => {
    const dot = apiStatus.querySelector('.status-dot');
    const text = apiStatus.querySelector('.status-text');
    if (isOnline) {
        dot.classList.add('online');
        text.textContent = 'Monitoramento Ativo';
        text.style.color = 'var(--primary)';
    } else {
        dot.classList.remove('online');
        text.textContent = 'Aguardando Dados...';
        text.style.color = 'var(--text-muted)';
    }
};

// --- FORMATTERS ---
const formatCurrency = (val, currency) => {
    const minDecimals = currency === 'BTC' ? 6 : 4;
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency, minimumFractionDigits: minDecimals, maximumFractionDigits: minDecimals }).format(val);
};

const getLogo = (symbol) => {
    const map = {
        'USDT': 'https://cryptologos.cc/logos/tether-usdt-logo.svg',
        'USDC': 'https://cryptologos.cc/logos/usd-coin-usdc-logo.svg',
        'DAI': 'https://cryptologos.cc/logos/multi-collateral-dai-dai-logo.svg',
        'FDUSD': 'https://assets.coingecko.com/coins/images/31089/small/fdusd.png',
        'PYUSD': 'https://assets.coingecko.com/coins/images/31168/small/pyUSD_256.png',
        'USDE': 'https://assets.coingecko.com/coins/images/35345/small/USDE_Logo_White.png',
        'BRZ': 'https://assets.coingecko.com/coins/images/8470/small/brz.png',
        'BRLA': 'https://assets.coingecko.com/coins/images/32578/small/brla.png',
        'WBTC': 'https://cryptologos.cc/logos/wrapped-bitcoin-wbtc-logo.svg'
    };
    return map[symbol] || '';
};

// --- SUPABASE INTEGRATION ---
const loadConfigsFromDB = async () => {
    if (!currentUser) return;
    try {
        const { data, error } = await supabaseClient
            .from('depeg_configs')
            .select('*')
            .eq('user_id', currentUser.id);

        if (data && data.length > 0) {
            // Merge with default list or replace
            depegConfigs = data;
        } else {
            // Se não tem, salva as iniciais
            saveConfigsToDB();
        }
        renderCards();
    } catch (e) {
        console.error("Erro ao carregar configs:", e);
        renderCards(); // fallback para defaults
    }
};

const saveConfigsToDB = async () => {
    if (!currentUser) return;
    try {
        const upserts = depegConfigs.map(c => ({
            user_id: currentUser.id,
            symbol: c.symbol,
            coingecko_id: c.coingecko_id,
            target_peg: c.target_peg,
            peg_currency: c.peg_currency,
            threshold_pct: c.threshold_pct,
            is_active: c.is_active,
            network: c.network || 'Global',
            updated_at: new Date().toISOString()
        }));

        const { error } = await supabaseClient.from('depeg_configs').upsert(upserts, { onConflict: 'user_id, symbol' });
        if (error) {
            console.error("Erro ao salvar configs:", error);
            // Fallback caso a coluna 'network' não exista no banco ainda
            if (error.message && error.message.includes('network')) {
                console.warn("A coluna 'network' parece não existir no Supabase. Salvando sem ela.");
                const upsertsSemRede = upserts.map(({ network, ...rest }) => rest);
                await supabaseClient.from('depeg_configs').upsert(upsertsSemRede, { onConflict: 'user_id, symbol' });
            }
        }
    } catch (e) {
        console.error("Exceção salvando config:", e);
    }
};

const deleteConfigFromDB = async (symbol) => {
    if (!currentUser) return;
    try {
        await supabaseClient.from('depeg_configs').delete().match({ user_id: currentUser.id, symbol });
    } catch (e) { }
};

const loadHistoryFromDB = async () => {
    if (!currentUser) return;
    try {
        const { data, error } = await supabaseClient
            .from('depeg_alerts_history')
            .select('*')
            .eq('user_id', currentUser.id)
            .order('created_at', { ascending: false })
            .limit(20);

        if (data) {
            depegHistory = data;
            renderHistory();
        }
    } catch (e) { }
};

const addHistoryEvent = async (symbol, price, target_peg, deviation_pct, status) => {
    const event = {
        user_id: currentUser ? currentUser.id : null,
        symbol,
        price,
        target_peg,
        deviation_pct,
        status,
        created_at: new Date().toISOString()
    };

    depegHistory.unshift(event);
    if (depegHistory.length > 20) depegHistory.pop();
    renderHistory();

    if (currentUser) {
        try {
            await supabaseClient.from('depeg_alerts_history').insert([event]);
        } catch (e) { }
    }
};

const renderHistory = () => {
    if (depegHistory.length === 0) {
        historyList.innerHTML = `<div class="history-item" style="justify-content: center; color: var(--text-muted); border: none; background: transparent;">Nenhum alerta registrado.</div>`;
        return;
    }

    historyList.innerHTML = depegHistory.map(item => {
        const isDepeg = item.status.includes('DEPEG');
        const color = isDepeg ? 'var(--danger)' : 'var(--profit)';
        const time = new Date(item.created_at).toLocaleString('pt-BR');
        const badgeStr = item.status === 'DEPEG_DOWN' ? 'Deságio' : (item.status === 'DEPEG_UP' ? 'Ágio' : 'Recuperado');

        return `
        <div class="history-item" style="border-left: 3px solid ${color};">
            <div style="display:flex; flex-direction: column; gap: 4px;">
                <div style="font-weight: bold; color: ${color}; font-size: 0.8rem;">${badgeStr}</div>
                <div><strong>${item.symbol}</strong> - ${formatCurrency(item.price, item.target_peg === 1.00 && item.symbol.includes('BR') ? 'BRL' : 'USD')}</div>
            </div>
            <div style="text-align: right;">
                <div style="font-family: var(--font-mono); font-weight: bold; color: ${isDepeg ? 'var(--danger)' : 'var(--secondary)'};">${item.deviation_pct > 0 ? '+' : ''}${item.deviation_pct.toFixed(2)}%</div>
                <div style="font-size: 0.75rem; color: var(--text-muted);">${time}</div>
            </div>
        </div>
        `;
    }).join('');
};

// --- UI RENDERING ---
const renderCards = () => {
    container.innerHTML = '';
    depegConfigs.forEach((config, idx) => {
        const card = document.importNode(template.content, true);
        const root = card.querySelector('.depeg-card');
        root.id = `card-${config.symbol}`;

        if (!config.is_active) {
            root.style.opacity = '0.5';
            root.querySelector('.toggle-active-btn').style.color = 'var(--text-main)';
        } else {
            root.querySelector('.toggle-active-btn').style.color = 'var(--profit)';
        }

        const logoUrl = getLogo(config.symbol);
        root.querySelector('.token-name').innerHTML = `${logoUrl ? `<img src="${logoUrl}" width="24" style="border-radius: 50%; vertical-align: middle;"> ` : ''}${config.symbol}`;
        root.querySelector('.token-network').textContent = config.network || 'Global';
        root.querySelector('.target-val').textContent = `${formatCurrency(config.target_peg, config.peg_currency)}`;

        const slider = root.querySelector('.threshold-slider');
        const display = root.querySelector('.threshold-display');
        slider.value = config.threshold_pct;
        display.textContent = `±${config.threshold_pct.toFixed(2)}%`;

        slider.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            display.textContent = `±${val.toFixed(2)}%`;
        });

        slider.addEventListener('change', (e) => {
            config.threshold_pct = parseFloat(e.target.value);
            saveConfigsToDB();
            evaluatePeg(config.symbol); // Re-evaluate immediately
        });

        root.querySelector('.toggle-active-btn').addEventListener('click', () => {
            config.is_active = !config.is_active;
            saveConfigsToDB();
            renderCards();
        });

        root.querySelector('.delete-btn').addEventListener('click', () => {
            if (confirm(`Remover monitoramento de ${config.symbol}?`)) {
                depegConfigs.splice(idx, 1);
                deleteConfigFromDB(config.symbol);
                renderCards();
            }
        });

        container.appendChild(card);

        if (prices[config.symbol]) {
            updateCardUI(config.symbol, prices[config.symbol]);
        }
    });
};

document.getElementById('add-token-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const symbol = document.getElementById('new-symbol').value.toUpperCase().trim() || document.getElementById('coin-search-input').value.toUpperCase().trim();
    const cgId = document.getElementById('new-coingecko').value.trim() || null;
    const target = parseFloat(document.getElementById('new-peg').value);
    const curr = document.getElementById('new-currency').value;
    const thresh = parseFloat(document.getElementById('new-threshold').value);
    const network = document.getElementById('new-network').value;

    if (!symbol) {
        showToast('Erro', 'Por favor, digite ou selecione um símbolo válido.', 'danger');
        return;
    }

    if (depegConfigs.find(c => c.symbol === symbol)) {
        showToast('Erro', 'Este símbolo já está sendo monitorado.', 'danger');
        return;
    }

    depegConfigs.push({
        symbol: symbol,
        coingecko_id: cgId,
        target_peg: target,
        peg_currency: curr,
        threshold_pct: thresh,
        network: network,
        is_active: true
    });

    saveConfigsToDB();
    renderCards();
    document.getElementById('add-token-form').reset();
    if (typeof clearCoinSelection === 'function') clearCoinSelection();
    showToast('Sucesso', `${symbol} adicionado ao monitor.`, 'success');
    fetchPrices(); // Force update
});

// --- FETCHING LOGIC ---

// Helper for DEX prices (BRLA/BRZ)
const fetchDexQuotePolygon = async (srcToken, destToken, amountUsdt) => {
    const amountInMicro = Math.floor(amountUsdt * 1e6).toString();
    try {
        const url = `https://apiv5.paraswap.io/prices?srcToken=${srcToken}&srcDecimals=6&destToken=${destToken}&destDecimals=18&amount=${amountInMicro}&side=SELL&network=137`;
        const res = await fetch(url);
        const data = await res.json();
        return parseFloat(data.priceRoute.destAmount) / 1e18;
    } catch (e) { return null; }
};

const fetchBinanceUsdtBrl = async () => {
    try {
        const res = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=USDTBRL');
        const data = await res.json();
        return parseFloat(data.price);
    } catch (e) { return null; }
};

const fetchCoinGeckoPrices = async (ids) => {
    if (ids.length === 0) return {};
    try {
        const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd,brl,btc`);
        return await res.json();
    } catch (e) {
        return null;
    }
};

const fetchPrices = async () => {
    // Collect active CG ids
    const activeConfigs = depegConfigs.filter(c => c.is_active);
    const cgIds = activeConfigs.map(c => c.coingecko_id).filter(id => id);

    let cgData = await fetchCoinGeckoPrices(cgIds);
    let usdtBrlPrice = null;

    // Se temos BRLA ou BRZ ou outro que dependa de BRL e não achou via CG, podemos usar CEX/DEX fallback
    const needsDexFallback = activeConfigs.some(c => c.symbol === 'BRLA' || c.symbol === 'BRZ');
    if (needsDexFallback) {
        usdtBrlPrice = await fetchBinanceUsdtBrl();
    }

    for (const config of activeConfigs) {
        let currentPrice = null;

        // Tentar CoinGecko Primeiro se tem ID
        if (config.coingecko_id && cgData && cgData[config.coingecko_id]) {
            const currencyKey = config.peg_currency.toLowerCase();
            if (cgData[config.coingecko_id][currencyKey]) {
                currentPrice = cgData[config.coingecko_id][currencyKey];
            }
        }

        // Fallbacks Específicos para DEX/CEX
        if (!currentPrice) {
            if (config.symbol === 'BRLA' || config.symbol === 'BRZ') {
                const destContract = config.symbol === 'BRLA' ? CONTRACTS.brla : CONTRACTS.brz;
                // Quanto de token recebo por 100 USDT?
                const tokensRec = await fetchDexQuotePolygon(CONTRACTS.usdt, destContract, 100);
                if (tokensRec && tokensRec > 0) {
                    // Preço unitário em USDT = 100 / tokens recebidos
                    const priceInUsdt = 100 / tokensRec;

                    if (config.peg_currency === 'BRL' && usdtBrlPrice) {
                        // Preço final em BRL = Preço em USDT * USDT/BRL
                        currentPrice = priceInUsdt * usdtBrlPrice;
                    } else {
                        // Preço final em USD (assumindo USDT ≈ USD)
                        currentPrice = priceInUsdt;
                    }
                }
            } else if (config.peg_currency === 'USD') {
                // Tentar Binance Ticker Fallback (ex: USDCUSDT)
                try {
                    const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${config.symbol}USDT`);
                    if (res.ok) {
                        const data = await res.json();
                        // Assume USDT = ~1.00 for fallback relative
                        currentPrice = parseFloat(data.price);
                    }
                } catch (e) { }
            }
        }

        if (currentPrice !== null && !isNaN(currentPrice)) {
            prices[config.symbol] = currentPrice;
            updateCardUI(config.symbol, currentPrice);
            evaluatePeg(config.symbol);
            updateApiStatus(true);
        }
    }
};

const updateCardUI = (symbol, price) => {
    const card = document.getElementById(`card-${symbol}`);
    if (!card) return;

    const config = depegConfigs.find(c => c.symbol === symbol);
    if (!config) return;

    const devPct = ((price / config.target_peg) - 1) * 100;
    const absDevPct = Math.abs(devPct);
    const isNegative = devPct < 0;

    card.querySelector('.current-price').textContent = formatCurrency(price, config.peg_currency);
    const devDisplay = card.querySelector('.deviation-val');
    devDisplay.textContent = `${devPct > 0 ? '+' : ''}${devPct.toFixed(3)}%`;

    // Reset card state
    card.classList.remove('has-profit', 'no-profit');
    card.style.borderColor = 'var(--border-color)';

    // --- Cor do texto do desvio ---
    // Negativo = sempre vermelho; positivo = verde (ou amarelo se perto do gatilho)
    if (isNegative) {
        devDisplay.style.color = 'var(--danger)';
    } else {
        devDisplay.style.color = 'var(--profit)';
    }

    // --- Cor da borda e glow do card (baseado no threshold) ---
    if (absDevPct >= config.threshold_pct) {
        // Threshold atingido: borda e glow vermelho
        card.style.borderColor = 'var(--danger)';
        card.querySelector('.card-glow').style.background = 'var(--danger)';
        card.querySelector('.card-glow').style.boxShadow = '0 0 20px var(--danger-glow)';
        // Força texto vermelho independente do sinal (threshold atingido = perigo total)
        devDisplay.style.color = 'var(--danger)';
    } else if (absDevPct >= config.threshold_pct / 2) {
        // Metade do threshold: aviso amarelo
        card.style.borderColor = '#ffaa00';
        card.querySelector('.card-glow').style.background = '#ffaa00';
        card.querySelector('.card-glow').style.boxShadow = '0 0 20px rgba(255, 170, 0, 0.15)';
        // Se o desvio for negativo, mantém vermelho mesmo no aviso amarelo
        if (!isNegative) devDisplay.style.color = '#ffaa00';
    } else {
        // Normal: glow verde
        card.querySelector('.card-glow').style.background = 'var(--profit)';
        card.querySelector('.card-glow').style.boxShadow = '0 0 20px var(--profit-glow)';
    }
};

const evaluatePeg = (symbol) => {
    const config = depegConfigs.find(c => c.symbol === symbol);
    if (!config || !config.is_active || !prices[symbol]) return;

    const price = prices[symbol];
    const devPct = ((price / config.target_peg) - 1) * 100;
    const absDevPct = Math.abs(devPct);
    const prevState = previousStates[symbol] || { isDepegged: false, lastAlertTime: 0 };
    
    // HISTERESE: se já estava desindexado, precisa cair para menos de 85% do gatilho para declarar recuperação
    // Ex: Gatilho em 10.00% -> Só recupera quando o desvio for menor que 8.50%
    const recoveryThreshold = config.threshold_pct * 0.85;
    const isCurrentlyDepegged = prevState.isDepegged 
        ? absDevPct >= recoveryThreshold 
        : absDevPct >= config.threshold_pct;

    const currentTime = Date.now();
    const alertCooldown = 15 * 60 * 1000; // 15 minutos

    if (isCurrentlyDepegged && !prevState.isDepegged) {
        // NOVO EVENTO DE DEPEG
        const status = devPct > 0 ? 'DEPEG_UP' : 'DEPEG_DOWN';
        addHistoryEvent(symbol, price, config.target_peg, devPct, status);
        
        showToast('ALERTA DEPEG', `${symbol} desviou ${devPct.toFixed(2)}% do alvo.`, 'danger');
        triggerRepeatingAlarm();
        sendTelegramAlert(symbol, config.network || 'Global', price, config.target_peg, devPct, true, false);

        const card = document.getElementById(`card-${symbol}`);
        if (card) card.classList.add('pulse-badge');

        previousStates[symbol] = { 
            isDepegged: true, 
            lastAlertTime: currentTime 
        };

    } else if (isCurrentlyDepegged && prevState.isDepegged) {
        // CONTINUA DEPEGGADA -> Envia lembrete periódico de 15 em 15 minutos
        if (currentTime - prevState.lastAlertTime >= alertCooldown) {
            sendTelegramAlert(symbol, config.network || 'Global', price, config.target_peg, devPct, true, true);
            previousStates[symbol].lastAlertTime = currentTime; // atualiza timestamp do último lembrete
        }
    } else if (!isCurrentlyDepegged && prevState.isDepegged) {
        // RECUPERAÇÃO DO PEG
        addHistoryEvent(symbol, price, config.target_peg, devPct, 'RECOVERED');
        showToast('Peg Recuperado', `${symbol} retornou aos parâmetros normais.`, 'success');
        sendTelegramAlert(symbol, config.network || 'Global', price, config.target_peg, devPct, false, false);
        
        const card = document.getElementById(`card-${symbol}`);
        if (card) card.classList.remove('pulse-badge');

        previousStates[symbol] = { 
            isDepegged: false, 
            lastAlertTime: 0 
        };
    } else {
        // Estado normal
        previousStates[symbol] = { 
            isDepegged: false, 
            lastAlertTime: 0 
        };
    }

    // Update global alarm state: if NO coins are depegged, stop alarm
    const anyDepegged = depegConfigs.some(c => {
        if (!c.is_active || !prices[c.symbol]) return false;
        const state = previousStates[c.symbol] || { isDepegged: false };
        return state.isDepegged; // Respeita o estado com histerese
    });

    if (!anyDepegged) {
        stopRepeatingAlarm();
    } else {
        triggerRepeatingAlarm();
    }
};


const initDepegMonitor = async () => {
    await loadConfigsFromDB();
    await loadHistoryFromDB();

    fetchPrices();
    // Update every 10 seconds to respect CoinGecko limits but stay real-time enough for stablecoins
    setInterval(fetchPrices, 10000);
};

// Listeners for visibility
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        fetchPrices();
    }
});

window.addEventListener('focus', () => {
    if (document.visibilityState === 'visible') {
        fetchPrices();
    }
});

// =============================================================
// COINGECKO SEARCH AUTOCOMPLETE
// =============================================================
const searchInput = document.getElementById('coin-search-input');
const searchResults = document.getElementById('coin-search-results');
const searchSpinner = document.getElementById('search-spinner');
const selectedDisplay = document.getElementById('selected-coin-display');
const clearCoinBtn = document.getElementById('clear-coin-btn');
const hiddenSymbol = document.getElementById('new-symbol');
const hiddenCgId = document.getElementById('new-coingecko');

let searchDebounce = null;

const clearCoinSelection = () => {
    hiddenSymbol.value = '';
    hiddenCgId.value = '';
    searchInput.value = '';
    searchInput.style.display = 'block';
    selectedDisplay.style.display = 'none';
    searchResults.style.display = 'none';
    searchInput.focus();
};

clearCoinBtn.addEventListener('click', clearCoinSelection);

const selectCoin = (coin) => {
    hiddenSymbol.value = coin.symbol.toUpperCase();
    hiddenCgId.value = coin.id;

    document.getElementById('selected-coin-thumb').src = coin.thumb || '';
    document.getElementById('selected-coin-name').textContent = coin.name;
    document.getElementById('selected-coin-ticker').textContent = coin.symbol.toUpperCase();

    searchInput.style.display = 'none';
    selectedDisplay.style.display = 'flex';
    searchResults.style.display = 'none';
};

const renderResults = (coins) => {
    if (!coins || coins.length === 0) {
        searchResults.innerHTML = `
            <div style="padding: 1.5rem; text-align: center; color: var(--text-muted); font-size: 0.9rem;">
                <i class="fa-solid fa-circle-xmark" style="font-size: 1.5rem; margin-bottom: 8px; display: block; opacity: 0.5;"></i>
                Nenhuma moeda encontrada. Tente outro termo.
            </div>`;
        searchResults.style.display = 'block';
        return;
    }

    searchResults.innerHTML = coins.map((coin, i) => `
        <div class="cg-result-item" data-index="${i}"
            style="display: flex; align-items: center; gap: 12px; padding: 0.75rem 1rem; cursor: pointer; border-bottom: 1px solid rgba(255,255,255,0.04); transition: background 0.15s;"
            onmouseover="this.style.background='rgba(255,255,255,0.06)'"
            onmouseout="this.style.background='transparent'">
            <img src="${coin.thumb}" width="28" height="28" style="border-radius: 50%; flex-shrink: 0;" 
                onerror="this.style.display='none'" alt="${coin.symbol}">
            <div style="flex: 1; min-width: 0;">
                <div style="font-weight: 700; color: #fff; font-size: 0.95rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${coin.name}</div>
                <div style="font-size: 0.78rem; color: var(--text-muted); font-family: var(--font-mono);">${coin.symbol.toUpperCase()} · <span style="color: rgba(255,255,255,0.3);">id: ${coin.id}</span></div>
            </div>
            ${coin.market_cap_rank ? `<span style="font-size: 0.7rem; color: var(--text-muted); background: rgba(255,255,255,0.06); padding: 2px 7px; border-radius: 4px; flex-shrink: 0;">#${coin.market_cap_rank}</span>` : ''}
        </div>
    `).join('');

    // Attach click events
    searchResults.querySelectorAll('.cg-result-item').forEach((el, i) => {
        el.addEventListener('click', () => selectCoin(coins[i]));
    });

    searchResults.style.display = 'block';
};

const doSearch = async (query) => {
    if (!query || query.length < 2) {
        searchResults.style.display = 'none';
        return;
    }

    searchSpinner.style.display = 'block';
    try {
        const res = await fetch(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(query)}`);
        const data = await res.json();
        renderResults((data.coins || []).slice(0, 10));
    } catch (e) {
        searchResults.innerHTML = `
            <div style="padding: 1rem; text-align: center; color: var(--danger); font-size: 0.85rem;">
                <i class="fa-solid fa-triangle-exclamation"></i> Erro ao conectar com a CoinGecko. Tente novamente.
            </div>`;
        searchResults.style.display = 'block';
    } finally {
        searchSpinner.style.display = 'none';
    }
};

searchInput.addEventListener('input', (e) => {
    clearTimeout(searchDebounce);
    const q = e.target.value.trim();
    if (q.length < 2) {
        searchResults.style.display = 'none';
        return;
    }
    // Debounce 400ms to avoid hammering the API on every keystroke
    searchDebounce = setTimeout(() => doSearch(q), 400);
});

// Reopen dropdown on focus if there's already a query typed
searchInput.addEventListener('focus', (e) => {
    if (e.target.value.trim().length >= 2 && searchResults.innerHTML) {
        searchResults.style.display = 'block';
    }
});
