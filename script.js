import { supabaseClient } from './supabase-config.js';

const API_BASE = "";

// Supabase Session Check
let currentUser = null;

const checkSession = async () => {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) {
        window.location.href = '/login';
    } else {
        currentUser = session.user;
        const mainContainer = document.getElementById('main-app-container');
        if (mainContainer) mainContainer.style.display = 'block';
        
        if (typeof loadPreferences === 'function') loadPreferences();
        if (typeof loadHistory === 'function') loadHistory();
        if (typeof sendHeartbeat === 'function') {
            sendHeartbeat();
            setInterval(sendHeartbeat, 60000);
        }
    }
};

checkSession();

// DOM Elements
const toggleBtn = document.getElementById('toggle-settings');
const settingsContent = document.getElementById('settings-content');
const investmentInput = document.getElementById('investment');
const resultsContainer = document.getElementById('results-container');
const soundToggle = document.getElementById('sound-toggle');
const cardTemplate = document.getElementById('card-template');
const toastContainer = document.getElementById('toast-container');
const apiStatus = document.getElementById('api-status');
const slippageInput = document.getElementById('slippage');
const logoutBtn = document.getElementById('logout-btn');

// Logout Logic
if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
        await supabaseClient.auth.signOut();
        window.location.href = '/login';
    });
}

// Accordion Logic
toggleBtn.addEventListener('click', () => {
    toggleBtn.classList.toggle('active');
    settingsContent.classList.toggle('open');
});

// Sound Logic
let soundEnabled = false;
let audioCtx = null;

const playBeep = () => {
    if (!soundEnabled) return;
    try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();

        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();

        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(880, audioCtx.currentTime); 
        
        gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
        gainNode.gain.linearRampToValueAtTime(0.5, audioCtx.currentTime + 0.05);
        gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5);

        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        oscillator.start(audioCtx.currentTime);
        oscillator.stop(audioCtx.currentTime + 0.5);
    } catch (e) {
        // Ignora erro se o navegador bloquear o áudio
    }
};

soundToggle.addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    if (soundEnabled) {
        soundToggle.classList.remove('off');
        soundToggle.classList.add('on');
        soundToggle.innerHTML = '<i class="fa-solid fa-bell"></i> Alertas: ON';
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } else {
        soundToggle.classList.remove('on');
        soundToggle.classList.add('off');
        soundToggle.innerHTML = '<i class="fa-solid fa-bell-slash"></i> Alertas: OFF';
    }
    if (typeof triggerSavePreferences === 'function') triggerSavePreferences();
});

// Notifications (Toast & API Status)
const showToast = (title, message, isProfit = true) => {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.style.borderColor = isProfit ? 'var(--primary)' : 'var(--danger)';
    toast.style.borderLeftColor = isProfit ? 'var(--primary)' : 'var(--danger)';
    
    const icon = isProfit ? '<i class="fa-solid fa-money-bill-trend-up"></i>' : '<i class="fa-solid fa-triangle-exclamation" style="color: var(--danger)"></i>';
    
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

const updateApiStatus = (isOnline) => {
    const dot = apiStatus.querySelector('.status-dot');
    const text = apiStatus.querySelector('.status-text');
    if (isOnline) {
        dot.classList.add('online');
        text.textContent = 'APIs Online';
        text.style.color = 'var(--primary)';
    } else {
        dot.classList.remove('online');
        text.textContent = 'Instabilidade';
        text.style.color = 'var(--danger)';
    }
};

// Contracts & Proxy
const CONTRACTS = {
    usdt: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
    brz: "0x4eD141110F6EeeAbA9A1df36d8c26f684d2475Dc",
    brla: "0xe6a537a407488807f0bbeb0038b79004f19dddfb"
};

const PROXIES = []; // Proxies públicos removidos por segurança
let currentProxy = 0;

const getProxyUrl = (url) => {
    return url;
};

const EXCHANGES = [
    {
        id: "binance", name: "Binance",
        url: `${API_BASE}/api/exchanges/binance`,
        tradeUrl: "https://www.binance.com/pt-BR/trade/USDT_BRL",
        useProxy: true,
        getAsks: (d) => d?.asks || [],
        getBids: (d) => d?.bids || []
    },
    {
        id: "kucoin", name: "Kucoin",
        url: `${API_BASE}/api/kucoin/ticker`,
        tradeUrl: "https://www.kucoin.com/trade/USDT-BRL",
        useProxy: true,
        getAsks: (d) => d?.data?.asks || [],
        getBids: (d) => d?.data?.bids || []
    },
    {
        id: "bybit", name: "Bybit",
        url: `${API_BASE}/api/exchanges/bybit`,
        tradeUrl: "https://www.bybit.com/pt-BR/trade/spot/USDT/BRL",
        useProxy: true,
        getAsks: (d) => d?.result?.a || [],
        getBids: (d) => d?.result?.b || []
    },
    {
        id: "bitget", name: "Bitget",
        url: `${API_BASE}/api/exchanges/bitget`,
        tradeUrl: "https://www.bitget.com/pt/spot/USDTBRL",
        useProxy: true,
        getAsks: (d) => d?.data?.asks || [],
        getBids: (d) => d?.data?.bids || []
    }
];

const getExLogo = (id) => {
    if (id === 'binance') return 'https://cryptologos.cc/logos/bnb-bnb-logo.svg';
    if (id === 'kucoin') return 'https://cryptologos.cc/logos/kucoin-token-kcs-logo.svg';
    if (id === 'bybit') return 'https://assets.coingecko.com/markets/images/698/small/bybit_spot.png';
    if (id === 'bitget') return 'https://assets.coingecko.com/markets/images/540/small/Bitget_new_logo_2.png';
    return '';
};

// Helpers
const formatBRL = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
const formatCrypto = (v) => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);

const getLiquidityPrice = (orderbookLevels, targetBrlVolume) => {
    if (!orderbookLevels || orderbookLevels.length === 0) return undefined;
    let accumulatedBrl = 0;

    for (const level of orderbookLevels) {
        const price = parseFloat(level[0]);
        const qtyUsdt = parseFloat(level[1]);
        const qtyBrl = price * qtyUsdt;
        
        accumulatedBrl += qtyBrl;

        if (accumulatedBrl >= targetBrlVolume) {
            return price; // Retorna o nível de preço marginal exato
        }
    }

    if (orderbookLevels.length > 0) {
        return parseFloat(orderbookLevels[orderbookLevels.length - 1][0]);
    }

    return undefined;
};

const getInputs = () => {
    // Investment usa formato pt-BR: pontos sao separadores de MILHAR ("7.000" = 7000, "10.000" = 10000)
    // Por isso sempre removemos os pontos antes de parsear
    const rawInv = investmentInput.value.toString()
        .replace(/\./g, '')    // remove pontos de milhar
        .replace(',', '.');    // converte virgula decimal para ponto
    const investment = Math.abs(parseFloat(rawInv)) || 0;
    
    // Slippage (opcional — input removido do CEX/CEX, retorna 0 se ausente)
    const rawSlip = slippageInput ? slippageInput.value.toString().replace(',', '.') : '0';
    const slippage = Math.abs(parseFloat(rawSlip)) || 0;

    const fees = {};
    EXCHANGES.forEach(ex => {
        let rawTrade = document.getElementById(`${ex.id}-trading-fee`).value.toString().replace(',', '.');
        let rawWith  = document.getElementById(`${ex.id}-withdrawal-fee`).value.toString().replace(',', '.');
        
        // Força as taxas da Bybit para 0.2% Taker e 0.10 USDT Saque
        if (ex.id === 'bybit') {
            rawTrade = '0.2';
            rawWith = '0.10';
            document.getElementById(`bybit-trading-fee`).value = 0.2;
            document.getElementById(`bybit-withdrawal-fee`).value = 0.10;
        }

        fees[ex.id] = {
            trading:    Math.abs(parseFloat(rawTrade)) || 0,
            withdrawal: Math.abs(parseFloat(rawWith))  || 0
        };
    });
    return { investment, slippage, fees };
};

// --- DATABASE SYNC LOGIC ---
let saveTimeout = null;

async function loadPreferences() {
    if (!currentUser) return;
    try {
        const { data, error } = await supabaseClient
            .from('user_preferences')
            .select('*')
            .eq('user_id', currentUser.id)
            .single();

        if (data) {
            if (data.investment) investmentInput.value = data.investment.toLocaleString('pt-BR');
            if (data.slippage) slippageInput.value = data.slippage;
            if (data.sound_enabled) {
                soundEnabled = true;
                soundToggle.classList.remove('off');
                soundToggle.classList.add('on');
                soundToggle.innerHTML = '<i class="fa-solid fa-bell"></i> Alertas: ON';
                if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            } else {
                soundEnabled = false;
                soundToggle.classList.remove('on');
                soundToggle.classList.add('off');
                soundToggle.innerHTML = '<i class="fa-solid fa-bell-slash"></i> Alertas: OFF';
            }
            if (data.fees) {
                EXCHANGES.forEach(ex => {
                    if (data.fees[ex.id]) {
                        document.getElementById(`${ex.id}-trading-fee`).value = data.fees[ex.id].trading;
                        document.getElementById(`${ex.id}-withdrawal-fee`).value = data.fees[ex.id].withdrawal;
                    }
                });
            }
        }
    } catch (e) {
        console.error("Erro ao carregar preferências:", e);
    }
}

function triggerSavePreferences() {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(savePreferences, 1000);
}

async function savePreferences() {
    if (!currentUser) return;
    
    const { investment, slippage, fees } = getInputs();

    try {
        const { error } = await supabaseClient
            .from('user_preferences')
            .upsert({
                user_id: currentUser.id,
                investment: investment,
                slippage: slippage,
                sound_enabled: soundEnabled,
                fees: fees,
                updated_at: new Date().toISOString()
            }, { onConflict: 'user_id' });
            
        if (error) console.error("Erro ao salvar preferências:", error);
    } catch (e) {
        console.error("Exceção ao salvar:", e);
    }
}

async function loadHistory() {
    if (!currentUser) return;
    try {
        const { data, error } = await supabaseClient
            .from('ultimas_oportunidades')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(10);

        if (data && data.length > 0) {
            opportunityHistory = data.map(item => ({
                tipo: item.tipo,
                buyEx: item.buy_ex,
                sellEx: item.sell_ex,
                moeda: item.moeda_destino,
                profitBrl: parseFloat(item.profit_brl),
                pct: parseFloat(item.profit_pct),
                time: new Date(item.created_at).toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit', second:'2-digit'})
            }));
            updateHistoryUI();
        }
    } catch (e) {
        console.error("Erro ao carregar histórico:", e);
    }
}

async function saveHistoryToDB(tipo, buyEx, sellEx, moeda, profitBrl, pct) {
    if (!currentUser) return;
    try {
        await supabaseClient
            .from('ultimas_oportunidades')
            .insert({
                user_id: currentUser.id,
                tipo: tipo,
                buy_ex: buyEx,
                sell_ex: sellEx,
                moeda_destino: moeda,
                profit_brl: profitBrl,
                profit_pct: pct
            });
    } catch (e) {
        console.error("Erro ao salvar histórico:", e);
    }
}

async function sendHeartbeat() {
    if (!currentUser) return;
    try {
        const { data } = await supabaseClient.from('profiles').select('access_expires_at').eq('id', currentUser.id).single();
        if (data && data.access_expires_at) {
            const expDate = new Date(data.access_expires_at);
            if (new Date() > expDate) {
                alert('Seu tempo de acesso ao monitor expirou. Contate o administrador.');
                await supabaseClient.auth.signOut();
                window.location.href = '/login';
                return;
            }
        }
        await supabaseClient.rpc('increment_time_spent');
    } catch (e) {
        // console.error("Heartbeat fail", e);
    }
}
// -----------------------------

// CEX/CEX Monitor Logic
let selectedBuyEx = "binance";
let selectedSellEx = "kucoin";
let latestCexPrices = {};
let opportunityHistory = [];

const updateExButtons = () => {
    document.querySelectorAll('#buy-buttons .ex-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.ex === selectedBuyEx) btn.classList.add('active');
        btn.disabled = (btn.dataset.ex === selectedSellEx);
    });
    document.querySelectorAll('#sell-buttons .ex-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.ex === selectedSellEx) btn.classList.add('active');
        btn.disabled = (btn.dataset.ex === selectedBuyEx);
    });
    calculateCexCex();
};

document.querySelectorAll('#buy-buttons .ex-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        if (!btn.disabled) {
            selectedBuyEx = selectedBuyEx === btn.dataset.ex ? null : btn.dataset.ex;
            updateExButtons();
        }
    });
});

document.querySelectorAll('#sell-buttons .ex-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        if (!btn.disabled) {
            selectedSellEx = selectedSellEx === btn.dataset.ex ? null : btn.dataset.ex;
            updateExButtons();
        }
    });
});

const updateHistoryUI = () => {
    const list = document.getElementById('history-list');
    if (opportunityHistory.length === 0) return;
    
    list.innerHTML = opportunityHistory.map(item => `
        <div class="history-item ${item.pct > 0 ? 'profit' : 'loss'}">
            <div class="route" style="flex-direction: column; align-items: flex-start; gap: 2px;">
                <div style="font-size: 0.75rem; color: var(--primary); font-weight: bold;">${item.tipo}</div>
                <div>
                    ${item.tipo === 'CEX/CEX' ? `<img src="${getExLogo(item.buyEx)}" width="16" style="border-radius:50%"> ➔ <img src="${getExLogo(item.sellEx)}" width="16" style="border-radius:50%">` : `<img src="${getExLogo(item.buyEx)}" width="16" style="border-radius:50%"> ➔ ${item.sellEx} (${item.moeda})`}
                </div>
            </div>
            <div>
                <span class="profit-val">${item.pct > 0 ? '+' : ''}${item.pct.toFixed(2)}%</span>
                <span class="time">${item.time}</span>
            </div>
        </div>
    `).join('');
};

const addHistory = (tipo, buyEx, sellEx, moeda, profitBrl, pct) => {
    const time = new Date().toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit', second:'2-digit'});
    opportunityHistory.unshift({ tipo, buyEx, sellEx, moeda, profitBrl, pct, time });
    if (opportunityHistory.length > 10) opportunityHistory.pop();
    updateHistoryUI();
    if (typeof saveHistoryToDB === 'function') saveHistoryToDB(tipo, buyEx, sellEx, moeda, profitBrl, pct);
};

const calculateCexCex = () => {
    if (!selectedBuyEx || !selectedSellEx ||
        !latestCexPrices[selectedBuyEx]?.ask ||
        !latestCexPrices[selectedSellEx]?.bid) {
        return;
    }

    const { investment, fees } = getInputs();
    
    // Calcula o Preço de Liquidez (o nível de preço exato onde a liquidez atinge o investimento)
    let asksForLiquidity = latestCexPrices[selectedBuyEx].asks;
    let buyPrice;
    if (asksForLiquidity && (selectedBuyEx === 'bybit' || selectedBuyEx === 'bitget') && asksForLiquidity.length > 0) {
        // Pega estritamente o Ask[0] (primeiro preço visualmente acima do preço verde)
        buyPrice = parseFloat(asksForLiquidity[0][0]);
    } else {
        const rawBuyPrice = asksForLiquidity ? getLiquidityPrice(asksForLiquidity, investment) : undefined;
        buyPrice = rawBuyPrice || latestCexPrices[selectedBuyEx].ask;
    }
    
    const rawSellPrice = latestCexPrices[selectedSellEx].bids ? getLiquidityPrice(latestCexPrices[selectedSellEx].bids, investment) : undefined;
    const sellPrice = rawSellPrice || latestCexPrices[selectedSellEx].bid;  // BID da exchange vendedora  (BRL/USDT)

    const buyFee  = fees[selectedBuyEx]  || { trading: 0.10, withdrawal: 0 };
    const sellFee = fees[selectedSellEx] || { trading: 0.10, withdrawal: 0 };

    // Spread bruto entre os preços (sem slippage — exibição limpa)
    const spread = ((sellPrice / buyPrice) - 1) * 100;

    // --- FLUXO COMPLETO CEX/CEX ---
    // 1. USDT bruto comprado com BRL ao preço ASK
    const usdtBruto = investment / buyPrice;

    // 2. Desconta taxa de trading da compra (% sobre USDT recebido)
    const usdtAposTrade = usdtBruto * (1 - buyFee.trading / 100);

    // 3. Desconta taxa de saque em USDT (Bybit = 0, demais conforme tabela)
    const usdtLiquido = Math.max(0, usdtAposTrade - buyFee.withdrawal);

    // 4. Vende USDT por BRL na exchange de venda ao preço BID
    const brlBruto = usdtLiquido * sellPrice;

    // 5. Desconta taxa de trading da venda
    const brlLiquido = brlBruto * (1 - sellFee.trading / 100);

    // 6. Lucro final
    const lucro    = brlLiquido - investment;
    const lucroPct = (lucro / investment) * 100;

    // --- ATUALIZA UI ---
    document.getElementById('cex-buy-price').textContent  = `R$ ${buyPrice.toFixed(4)}`;
    document.getElementById('cex-buy-name').textContent   = EXCHANGES.find(e => e.id === selectedBuyEx).name;

    document.getElementById('cex-net-usdt').textContent   = `${formatCrypto(usdtLiquido)} USDT`;

    document.getElementById('cex-sell-price').textContent = `R$ ${sellPrice.toFixed(4)}`;
    document.getElementById('cex-sell-name').textContent  = EXCHANGES.find(e => e.id === selectedSellEx).name;

    document.getElementById('cex-profit-brl').textContent = formatBRL(lucro);
    document.getElementById('cex-profit-pct').textContent = `${lucroPct > 0 ? '+' : ''}${lucroPct.toFixed(2)}%`;

    const spreadEl = document.getElementById('cex-spread');
    spreadEl.textContent = `${spread > 0 ? '+' : ''}${spread.toFixed(3)}%`;
    spreadEl.style.color = spread > 0 ? 'var(--primary)' : 'var(--danger)';

    const profitBox = document.getElementById('cex-profit-box');
    if (lucro > 0) {
        profitBox.classList.remove('loss');

        if (lucroPct >= 0.22 && soundEnabled && !window.playedSoundThisCycleCex) {
            playBeep();
            showToast('Arbitragem CEX/CEX', `Lucro de ${lucroPct.toFixed(2)}% (${formatBRL(lucro)}) via ${EXCHANGES.find(e=>e.id===selectedBuyEx).name} → ${EXCHANGES.find(e=>e.id===selectedSellEx).name}`);
            window.playedSoundThisCycleCex = true;
            document.getElementById('cex-cex-monitor').classList.add('pulse-badge');
            setTimeout(() => document.getElementById('cex-cex-monitor').classList.remove('pulse-badge'), 3000);
        }

        if (lucroPct > 0.05 && (!opportunityHistory[0] || opportunityHistory[0].buyEx !== selectedBuyEx || opportunityHistory[0].sellEx !== selectedSellEx || Math.abs(opportunityHistory[0].pct - lucroPct) > 0.1)) {
            addHistory('CEX/CEX', selectedBuyEx, selectedSellEx, 'USDT', lucro, lucroPct);
        }
    } else {
        profitBox.classList.add('loss');
        if (window.playedSoundThisCycleCex) window.playedSoundThisCycleCex = false;
    }
};

// Local Orderbooks for Delta logic
const localBooks = {
    bybit: { asks: [], bids: [] },
    bitget: { asks: [], bids: [] }
};

const applyDelta = (exId, side, deltas, isAsk) => {
    const map = new Map();
    localBooks[exId][side].forEach(p => map.set(p[0], p[1]));
    deltas.forEach(p => {
        if (parseFloat(p[1]) === 0) map.delete(p[0]);
        else map.set(p[0], p[1]);
    });
    const updated = Array.from(map.entries()).map(e => [e[0], e[1]]);
    if (isAsk) updated.sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]));
    else updated.sort((a, b) => parseFloat(b[0]) - parseFloat(a[0]));
    localBooks[exId][side] = updated;
};

const initWebSockets = () => {
    if (typeof updateApiStatus === 'function') updateApiStatus(true);

    // Binance
    const connectBinanceWS = () => {
        const wsBinance = new WebSocket('wss://stream.binance.com:9443/ws/usdtbrl@depth20@100ms');
        wsBinance.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                if (msg.asks && msg.bids && msg.asks.length > 0 && msg.bids.length > 0) {
                    updateCexPrice('binance', parseFloat(msg.asks[0][0]), parseFloat(msg.bids[0][0]), msg.asks, msg.bids);
                }
            } catch(e){}
        };
        wsBinance.onclose = () => setTimeout(connectBinanceWS, 5000);
    };
    connectBinanceWS();

    // Bybit
    const connectBybitWS = () => {
        const wsBybit = new WebSocket('wss://stream.bybit.com/v5/public/spot');
        let pingInterval;
        wsBybit.onopen = () => {
            wsBybit.send(JSON.stringify({ "op": "subscribe", "args": ["orderbook.50.USDTBRL"] }));
            pingInterval = setInterval(() => {
                if (wsBybit.readyState === WebSocket.OPEN) {
                    wsBybit.send(JSON.stringify({ "req_id": new Date().getTime().toString(), "op": "ping" }));
                }
            }, 20000);
        };
        wsBybit.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                if (msg.topic === 'orderbook.50.USDTBRL' && msg.data) {
                    if (msg.type === 'snapshot') {
                        if (msg.data.a) { localBooks.bybit.asks = msg.data.a; localBooks.bybit.asks.sort((a, b) => parseFloat(a[0]) - parseFloat(b[0])); }
                        if (msg.data.b) { localBooks.bybit.bids = msg.data.b; localBooks.bybit.bids.sort((a, b) => parseFloat(b[0]) - parseFloat(a[0])); }
                    } else if (msg.type === 'delta') {
                        if (msg.data.a) applyDelta('bybit', 'asks', msg.data.a, true);
                        if (msg.data.b) applyDelta('bybit', 'bids', msg.data.b, false);
                    }
                    if (localBooks.bybit.asks.length > 0 && localBooks.bybit.bids.length > 0) {
                        updateCexPrice('bybit', parseFloat(localBooks.bybit.asks[0][0]), parseFloat(localBooks.bybit.bids[0][0]), localBooks.bybit.asks, localBooks.bybit.bids);
                    }
                }
            } catch(e){}
        };
        wsBybit.onclose = () => { clearInterval(pingInterval); setTimeout(connectBybitWS, 5000); };
    };
    connectBybitWS();

    // Bitget
    const connectBitgetWS = () => {
        const wsBitget = new WebSocket('wss://ws.bitget.com/v2/ws/public');
        let pingInterval;
        wsBitget.onopen = () => {
            wsBitget.send(JSON.stringify({ "op": "subscribe", "args": [{ "instType": "SPOT", "channel": "books", "instId": "USDTBRL" }] }));
            pingInterval = setInterval(() => {
                if (wsBitget.readyState === WebSocket.OPEN) wsBitget.send("ping");
            }, 25000);
        };
        wsBitget.onmessage = (event) => {
            try {
                const msgStr = event.data;
                if (msgStr === 'pong') return;
                const msg = JSON.parse(msgStr);
                if (msg.data && msg.data[0] && msg.data[0].instId === 'USDTBRL') {
                    if (msg.action === 'snapshot') {
                        if (msg.data[0].asks) { localBooks.bitget.asks = msg.data[0].asks; localBooks.bitget.asks.sort((a, b) => parseFloat(a[0]) - parseFloat(b[0])); }
                        if (msg.data[0].bids) { localBooks.bitget.bids = msg.data[0].bids; localBooks.bitget.bids.sort((a, b) => parseFloat(b[0]) - parseFloat(a[0])); }
                    } else if (msg.action === 'update') {
                        if (msg.data[0].asks) applyDelta('bitget', 'asks', msg.data[0].asks, true);
                        if (msg.data[0].bids) applyDelta('bitget', 'bids', msg.data[0].bids, false);
                    }
                    if (localBooks.bitget.asks.length > 0 && localBooks.bitget.bids.length > 0) {
                        updateCexPrice('bitget', parseFloat(localBooks.bitget.asks[0][0]), parseFloat(localBooks.bitget.bids[0][0]), localBooks.bitget.asks, localBooks.bitget.bids);
                    }
                }
            } catch(e){}
        };
        wsBitget.onclose = () => { clearInterval(pingInterval); setTimeout(connectBitgetWS, 5000); };
    };
    connectBitgetWS();

    // Kucoin
    const connectKucoinWS = async () => {
        try {
            const res = await fetch(`${API_BASE}/api/kucoin/bullet-public`, { method: 'POST' });
            if (!res.ok) throw new Error("Failed to get Kucoin token");
            const data = await res.json();
            const token = data.data.token;
            const endpoint = data.data.instanceServers[0].endpoint;
            
            const wsKucoin = new WebSocket(`${endpoint}?token=${token}`);
            let pingInterval;
            
            wsKucoin.onopen = () => {
                wsKucoin.send(JSON.stringify({
                    "id": new Date().getTime(),
                    "type": "subscribe",
                    "topic": "/spotMarket/level2Depth50:USDT-BRL",
                    "privateChannel": false,
                    "response": true
                }));
                pingInterval = setInterval(() => {
                    if (wsKucoin.readyState === WebSocket.OPEN) {
                        wsKucoin.send(JSON.stringify({ "id": new Date().getTime(), "type": "ping" }));
                    }
                }, 15000);
            };
            wsKucoin.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data);
                    if (msg.type === 'message' && msg.topic === '/spotMarket/level2Depth50:USDT-BRL' && msg.data) {
                        if (msg.data.asks && msg.data.bids) {
                            updateCexPrice('kucoin', parseFloat(msg.data.asks[0][0]), parseFloat(msg.data.bids[0][0]), msg.data.asks, msg.data.bids);
                        }
                    }
                } catch(e){}
            };
            wsKucoin.onclose = () => { clearInterval(pingInterval); setTimeout(connectKucoinWS, 5000); };
        } catch (e) {
            setTimeout(connectKucoinWS, 10000);
        }
    };
    connectKucoinWS();
};

const updateCexPrice = (exId, ask, bid, asks, bids) => {
    if (!latestCexPrices[exId]) latestCexPrices[exId] = {};
    if (ask !== undefined && ask !== null && !isNaN(ask)) latestCexPrices[exId].ask = ask;
    if (bid !== undefined && bid !== null && !isNaN(bid)) latestCexPrices[exId].bid = bid;
    if (asks) latestCexPrices[exId].asks = asks;
    if (bids) latestCexPrices[exId].bids = bids;

    // Força Ask[0] para Bybit/Bitget na exibição global (o primeiro preço acima do preço verde)
    if ((exId === 'bybit' || exId === 'bitget') && latestCexPrices[exId].asks && latestCexPrices[exId].asks.length > 0) {
        latestCexPrices[exId].ask = parseFloat(latestCexPrices[exId].asks[0][0]);
    }

    latestCexPrices[exId].lastUpdate = Date.now();

    const displayPrice = latestCexPrices[exId].ask || latestCexPrices[exId].bid;
    if (!displayPrice) return;

    const cardEl = document.getElementById(`card-${exId}`);
    if (cardEl) {
        cardEl.querySelector('.ex-price').textContent = `R$ ${displayPrice.toFixed(4)}`;
        cardEl.querySelector('.ex-price').style.color = "#fff";
        cardEl.querySelector('.ex-price').style.textShadow = "0 0 10px rgba(0, 255, 204, 0.8)";
        setTimeout(() => {
            if (cardEl && cardEl.querySelector('.ex-price')) {
                cardEl.querySelector('.ex-price').style.textShadow = "none";
            }
        }, 300);
    }
    calculateCexCex();
};

// Inicializar Cards
const initCards = () => {
    resultsContainer.innerHTML = '';
    EXCHANGES.forEach(ex => {
        const card = document.importNode(cardTemplate.content, true);
        const rootDiv = card.querySelector('.exchange-card');
        rootDiv.id = `card-${ex.id}`;
        card.querySelector('.ex-name').innerHTML = `<img src="${getExLogo(ex.id)}" width="20" style="border-radius: 50%;" onerror="this.style.display='none'"> ${ex.name}`;
        
        const linkBtn = card.querySelector('.trade-link-btn');
        if (linkBtn) {
            linkBtn.href = "#";
            linkBtn.onclick = (e) => {
                e.preventDefault();
                window.open(ex.tradeUrl, '_blank');
                window.open("https://swap.defillama.com/?chain=polygon&from=0xc2132d05d31c914a87c6611c10748aeb04b58e8f&tab=swap&to=0x4ed141110f6eeeaba9a1df36d8c26f684d2475dc", '_blank');
            };
        }

        resultsContainer.appendChild(card);
    });
    updateExButtons();
};

// DEX API
const fetchDexQuotes = async (usdtAmount) => {
    if (usdtAmount <= 0) return null;
    const amountInMicro = Math.floor(usdtAmount * 1e6).toString();
    const fetchParaswap = async () => {
        try {
            const url = `https://apiv5.paraswap.io/prices?srcToken=${CONTRACTS.usdt}&srcDecimals=6&destToken=${CONTRACTS.brz}&destDecimals=18&amount=${amountInMicro}&side=SELL&network=137`;
            const res = await fetch(url);
            const data = await res.json();
            return parseFloat(data.priceRoute.destAmount) / 1e18;
        } catch(e) { return 0; }
    };
    const fetchKyber = async () => {
        try {
            const url = `https://aggregator-api.kyberswap.com/polygon/api/v1/routes?tokenIn=${CONTRACTS.usdt}&tokenOut=${CONTRACTS.brz}&amountIn=${amountInMicro}`;
            const res = await fetch(url);
            const data = await res.json();
            return parseFloat(data.data.routeSummary.amountOut) / 1e18;
        } catch(e) { return 0; }
    };
    const [paraswapBrz, kyberBrz] = await Promise.all([fetchParaswap(), fetchKyber()]);
    return { paraswap: paraswapBrz, kyber: kyberBrz };
};

const fetchBrlaDexQuotes = async (usdtAmount) => {
    if (usdtAmount <= 0) return null;
    const amountInMicro = Math.floor(usdtAmount * 1e6).toString();
    const fetchParaswap = async () => {
        try {
            const url = `https://apiv5.paraswap.io/prices?srcToken=${CONTRACTS.usdt}&srcDecimals=6&destToken=${CONTRACTS.brla}&destDecimals=18&amount=${amountInMicro}&side=SELL&network=137`;
            const res = await fetch(url);
            const data = await res.json();
            return parseFloat(data.priceRoute.destAmount) / 1e18;
        } catch(e) { return 0; }
    };
    const fetchKyber = async () => {
        try {
            const url = `https://aggregator-api.kyberswap.com/polygon/api/v1/routes?tokenIn=${CONTRACTS.usdt}&tokenOut=${CONTRACTS.brla}&amountIn=${amountInMicro}`;
            const res = await fetch(url);
            const data = await res.json();
            return parseFloat(data.data.routeSummary.amountOut) / 1e18;
        } catch(e) { return 0; }
    };
    const [paraswapBrla, kyberBrla] = await Promise.all([fetchParaswap(), fetchKyber()]);
    return { paraswap: paraswapBrla, kyber: kyberBrla };
};

let playedSoundThisCycle = false;
let cardsInitialized = false;
let isFetchingData = false;

// Main Loop
const fetchArbitrageData = async () => {
    if (isFetchingData) return;
    isFetchingData = true;

    try {
        const { investment, fees } = getInputs();
        if (investment <= 0) return;

        if (!cardsInitialized) {
            initCards();
            cardsInitialized = true;
        }

        playedSoundThisCycle = false;
        window.playedSoundThisCycleCex = false;
        let onlineCount = 0;

        await Promise.all(EXCHANGES.map(async (ex) => {
            const cardEl = document.getElementById(`card-${ex.id}`);
            if (!cardEl) return;

            try {
                let cached = latestCexPrices[ex.id];
                const now = Date.now();
                // Considera stale se tem mais de 20 segundos sem atualizar
                const isStale = !cached || (now - cached.lastUpdate > 20000);

                // Fallback REST: só busca se não há preço nenhum em cache
                // ou se o WS estiver inativo/com dados stale
                if (isStale) {
                    if (ex.url) {
                        try {
                            const targetUrl = ex.url;
                            let headers = {};
                            if (ex.useProxy) {
                                const { data: { session } } = await supabaseClient.auth.getSession();
                                if (session && session.access_token) {
                                    headers['Authorization'] = `Bearer ${session.access_token}`;
                                }
                            }
                            const res = await fetch(targetUrl, { headers });
                            if (res.ok) {
                                const data = await res.json();
                                const asks = ex.getAsks(data);
                                const bids = ex.getBids(data);
                                const topAsk = asks.length > 0 ? parseFloat(asks[0][0]) : undefined;
                                const topBid = bids.length > 0 ? parseFloat(bids[0][0]) : undefined;
                                if (topAsk && topBid) {
                                    updateCexPrice(ex.id, topAsk, topBid, asks, bids);
                                    cached = latestCexPrices[ex.id];
                                }
                            }
                        } catch (_restErr) {
                            // Falha no fallback REST – aguardando WebSocket
                        }
                    }
                }

                if (!cached || !cached.ask) throw new Error("Price not yet available");
                
                // Preço de liquidez marginal baseado nas ofertas de venda com o capital pretendido para CEX -> DEX
                let targetAsks = cached.asks;
                let price;
                if ((ex.id === 'bybit' || ex.id === 'bitget') && targetAsks && targetAsks.length > 0) {
                    // Pega estritamente o Ask[0] ignorando volume para Bybit e Bitget
                    price = parseFloat(targetAsks[0][0]);
                } else {
                    price = (targetAsks ? getLiquidityPrice(targetAsks, investment) : undefined) || cached.ask;
                }

                
                onlineCount++;

                // --- FLUXO CEX/DEX ---
                // 1. USDT bruto comprado na CEX com o investimento em BRL
                const exFees        = fees[ex.id];
                const usdtBruto     = investment / price;
                // 2. Taker fee (% sobre o USDT recebido)
                const usdtAposTrade = usdtBruto * (1 - (exFees.trading / 100));
                // 3. Taxa de saque fixa para a rede Polygon (configuravel pelo usuario)
                //    Esta taxa JA inclui o custo de gas da rede - nao ha deducao adicional
                const usdtLiquido   = Math.max(0, usdtAposTrade - exFees.withdrawal);
                
                // 4. DEX converte USDT para BRZ ou BRLA (ambos ≈ R$1,00 cada token)
                const dexQuotes  = await fetchDexQuotes(usdtLiquido)  || { paraswap: 0, kyber: 0 };
                const brlaQuotes = await fetchBrlaDexQuotes(usdtLiquido) || { paraswap: 0, kyber: 0 };
                
                // 5. Lucro = tokens_recebidos - investimento_brl  (BRZ/BRLA ≈ R$1)
                const calcDex = (tokens) => {
                    const profit = tokens - investment;
                    return { received: tokens, profit, pct: (profit / investment) * 100 };
                };

                const paraswap     = calcDex(dexQuotes.paraswap);
                const kyber        = calcDex(dexQuotes.kyber);
                const paraswapBrla = calcDex(brlaQuotes.paraswap);
                const kyberBrla    = calcDex(brlaQuotes.kyber);

                const finalUsdt = usdtLiquido; // exibido no card como "USDT Liquido"

                // Check best DEX profit for alerts
                const bestProfitObj = [
                    { name: 'Paraswap (BRZ)', pct: paraswap.pct, val: paraswap.profit },
                    { name: 'Kyber (BRZ)', pct: kyber.pct, val: kyber.profit },
                    { name: 'Paraswap (BRLA)', pct: paraswapBrla.pct, val: paraswapBrla.profit },
                    { name: 'Kyber (BRLA)', pct: kyberBrla.pct, val: kyberBrla.profit }
                ].reduce((max, curr) => curr.pct > max.pct ? curr : max, { pct: -100 });

                if (bestProfitObj.pct > 0 && !playedSoundThisCycle && soundEnabled) {
                    playBeep();
                    playedSoundThisCycle = true;
                }

                // Double Alert (Pulse + Toast) if >= 0.22%
                if (bestProfitObj.pct >= 0.22) {
                    if (soundEnabled && !playedSoundThisCycle) {
                        playBeep();
                        playedSoundThisCycle = true;
                    }
                    showToast('Oportunidade DEX!', `Lucro de ${bestProfitObj.pct.toFixed(2)}% (${formatBRL(bestProfitObj.val)}) via ${ex.name} ➔ ${bestProfitObj.name}`);
                    cardEl.classList.add('pulse-badge');
                    setTimeout(() => cardEl.classList.remove('pulse-badge'), 3000);
                }

                // History Throttle for DEX
                if (bestProfitObj.pct > 0.05) {
                    const isNewOrBetter = !opportunityHistory[0] || 
                        opportunityHistory[0].buyEx !== ex.id || 
                        opportunityHistory[0].sellEx !== bestProfitObj.name || 
                        Math.abs(opportunityHistory[0].pct - bestProfitObj.pct) > 0.1;
                    
                    if (isNewOrBetter) {
                        const moeda = bestProfitObj.name.includes('BRLA') ? 'BRLA' : 'BRZ';
                        const dexName = bestProfitObj.name.split(' ')[0];
                        addHistory('CEX/DEX', ex.id, dexName, moeda, bestProfitObj.val, bestProfitObj.pct);
                    }
                }

                // UI Reset
                cardEl.classList.remove('has-profit', 'no-profit', 'error-state');
                cardEl.classList.add(bestProfitObj.val > 0 ? 'has-profit' : 'no-profit');
                
                cardEl.querySelector('.ex-price').textContent = `R$ ${price.toFixed(4)}`;
                cardEl.querySelector('.ex-price').style.color = "#fff";
                cardEl.querySelector('.ex-usdt').textContent = `${formatCrypto(finalUsdt)} USDT`;

                const populateDex = (selector, dexData) => {
                    const el = cardEl.querySelector(selector);
                    el.classList.remove('profitable', 'loss');
                    
                    if (dexData.received > 0) {
                        el.querySelector(selector.includes('brla') ? '.value' : '.dex-received').textContent = `${formatCrypto(dexData.received)} ${selector.includes('brla') ? 'BRLA' : 'BRZ'}`;
                        el.querySelector(selector.includes('brla') ? '.profit-amount' : '.profit-brl').textContent = formatBRL(dexData.profit);
                        const pctStr = (dexData.pct > 0 ? '+' : '') + dexData.pct.toFixed(2) + '%';
                        el.querySelector(selector.includes('brla') ? '.profit-percentage' : '.profit-pct').textContent = pctStr;
                        el.classList.add(dexData.profit > 0 ? 'profitable' : 'loss');
                    } else {
                        el.querySelector(selector.includes('brla') ? '.value' : '.dex-received').textContent = `Falha/Sem Rota`;
                        el.querySelector(selector.includes('brla') ? '.profit-amount' : '.profit-brl').textContent = '-';
                        el.querySelector(selector.includes('brla') ? '.profit-percentage' : '.profit-pct').textContent = '0.00%';
                        el.classList.add('loss');
                    }
                };

                populateDex('.paraswap-route', paraswap);
                populateDex('.kyber-route', kyber);
                populateDex('.brla-paraswap-box', paraswapBrla);
                populateDex('.brla-kyber-box', kyberBrla);

            } catch (err) {
                if (err.message === "Price not yet available") {
                    cardEl.querySelector('.ex-price').textContent = `Conectando WS...`;
                    cardEl.querySelector('.ex-price').style.color = "var(--text-muted)";
                } else {
                    cardEl.classList.remove('has-profit', 'no-profit');
                    cardEl.classList.add('error-state', 'no-profit');
                    cardEl.querySelector('.ex-price').textContent = `Erro Conexão`;
                    cardEl.querySelector('.ex-price').style.color = "var(--danger)";
                }
            }
        }));

        updateApiStatus(onlineCount > 0);
        calculateCexCex();

    } catch (error) {
        // console.error("Critical loop error:", error);
    } finally {
        isFetchingData = false;
    }
};

// Listeners
investmentInput.addEventListener('input', (e) => {
    let raw = e.target.value.replace(/\D/g, '');
    if (raw) {
        e.target.value = parseInt(raw, 10).toLocaleString('pt-BR');
    } else {
        e.target.value = '';
    }
    clearTimeout(window.calcTimeout);
    window.calcTimeout = setTimeout(fetchArbitrageData, 800);
    if (typeof triggerSavePreferences === 'function') triggerSavePreferences();
});

if (slippageInput) {
    slippageInput.addEventListener('input', () => {
        calculateCexCex();
        if (typeof triggerSavePreferences === 'function') triggerSavePreferences();
    });
}

document.querySelectorAll('input[type="number"]').forEach(input => {
    if (input.id !== 'investment' && input.id !== 'slippage') {
        input.addEventListener('change', () => {
            fetchArbitrageData();
            if (typeof triggerSavePreferences === 'function') triggerSavePreferences();
        });
    }
});

// ============================================
// TAB SYSTEM
// ============================================
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const targetId = btn.dataset.tab;
        // Update button states
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        // Update panel visibility
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('tab-panel--hidden'));
        const target = document.getElementById(targetId);
        target.classList.remove('tab-panel--hidden');
        // On switch to CEX/CEX, recalculate immediately
        if (targetId === 'tab-cex') {
            calculateCexCex();
        }
    });
});

// Start loop
initWebSockets();
fetchArbitrageData();
setInterval(fetchArbitrageData, 2500);

// Auto Refresh System Logic
// Atualiza o sistema inteiro automaticamente quando o usuário voltar para a aba
const refreshSystem = () => {
    // Limpa os preços cacheados para forçar uma nova busca via REST API 
    // Isso garante dados atualizados mesmo se os WebSockets tiverem entrado em repouso
    latestCexPrices = {};
    
    // Atualiza o histórico de oportunidades
    if (typeof loadHistory === 'function') loadHistory();
    
    // Busca os dados mais recentes de arbitragem
    fetchArbitrageData();
};

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        refreshSystem();
    }
});

window.addEventListener('focus', () => {
    if (document.visibilityState === 'visible') {
        refreshSystem();
    }
});

// News Modal Logic
const newsModal = document.getElementById('news-modal');
const newsOverlay = document.getElementById('news-modal-overlay');
const newsList = document.getElementById('news-list');
const newsLoading = document.getElementById('news-loading');
const newsTitle = document.getElementById('news-modal-title');

const openNewsModal = (source) => {
    newsModal.classList.remove('hidden');
    newsOverlay.classList.remove('hidden');
    newsList.classList.add('hidden');
    newsLoading.classList.remove('hidden');
    newsList.innerHTML = '';

    if (source === 'decrypt') {
        newsTitle.innerHTML = '<i class="fa-solid fa-bolt"></i> Decrypt News';
        fetchDecrypt();
    } else {
        newsTitle.innerHTML = '<i class="fa-brands fa-bitcoin"></i> Portal do Bitcoin';
        fetchPortalBitcoin();
    }
};

window.openNewsModal = openNewsModal; // Make it global for inline onclick

const closeNewsModal = () => {
    newsModal.classList.add('hidden');
    newsOverlay.classList.add('hidden');
};

window.closeNewsModal = closeNewsModal;

const renderNews = (items) => {
    newsLoading.classList.add('hidden');
    newsList.classList.remove('hidden');
    
    if (items.length === 0) {
        newsList.innerHTML = '<div class="news-item"><p>Nenhuma notícia encontrada no momento ou bloqueio de proxy temporário. Tente novamente em breve.</p></div>';
        return;
    }

    newsList.innerHTML = items.map(item => `
        <a href="${item.url}" target="_blank" class="news-item">
            ${item.imageUrl ? `<img src="${item.imageUrl}" alt="News image" loading="lazy">` : `<div class="news-placeholder"><i class="fa-solid fa-newspaper"></i></div>`}
            <div class="news-content">
                <h4>${item.title}</h4>
                <div class="news-meta">
                    <span>Leia mais <i class="fa-solid fa-arrow-right"></i></span>
                    <span>${item.date || 'Recente'}</span>
                </div>
            </div>
        </a>
    `).join('');
};

const fetchPortalBitcoin = async () => {
    try {
        const res = await fetch('https://api.rss2json.com/v1/api.json?rss_url=https://portaldobitcoin.uol.com.br/feed/');
        const data = await res.json();
        const items = data.items.slice(0, 10).map(item => {
            let imgUrl = item.thumbnail || (item.enclosure && item.enclosure.link) || '';
            if (imgUrl) imgUrl = `https://wsrv.nl/?url=${encodeURIComponent(imgUrl)}&w=80&h=80&fit=cover`;
            return {
                title: item.title,
                url: item.link,
                date: new Date(item.pubDate).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }),
                imageUrl: imgUrl
            };
        });
        renderNews(items);
    } catch (e) {
        renderNews([]);
        console.error("Portal do Bitcoin error", e);
    }
};

const fetchDecrypt = async () => {
    try {
        const res = await fetch('https://api.rss2json.com/v1/api.json?rss_url=https://decrypt.co/feed');
        const data = await res.json();
        const items = data.items.slice(0, 10).map(item => {
            let imgUrl = item.thumbnail || (item.enclosure && item.enclosure.link) || '';
            if (imgUrl) imgUrl = `https://wsrv.nl/?url=${encodeURIComponent(imgUrl)}&w=80&h=80&fit=cover`;
            return {
                title: item.title,
                url: item.link,
                date: new Date(item.pubDate).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }),
                imageUrl: imgUrl
            };
        });
        renderNews(items);
    } catch (e) {
        renderNews([]);
        console.error("Decrypt error", e);
    }
};

// Fechar com ESC
window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeNewsModal();
});
