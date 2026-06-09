// ============================================
// DEPEG DASH — TELEGRAM ALERT BOT (24/7 CRON)
// Vercel Serverless Function
// ============================================

const TG_TOKEN   = process.env.TG_TOKEN;
const TG_CHAT_ID = process.env.TG_CHAT_ID;

const SUPABASE_URL  = 'https://vaahwukpupiiimnuagfa.supabase.co';
const SUPABASE_KEY  = 'sb_publishable_5NbtFzk47B5qmGqNJbIL5A_PlTmSwjC';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || SUPABASE_KEY;

const supabaseHeaders = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal'
};

const CONTRACTS = {
    usdt: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
    brz:  '0x4eD141110F6EeeAbA9A1df36d8c26f684d2475Dc',
    brla: '0xe6a537a407488807f0bbeb0038b79004f19dddfb'
};

// HELPERS
const fetchJson = async (url, timeoutMs = 8000) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    } finally {
        clearTimeout(timer);
    }
};

const fetchCoinGeckoPrices = async (ids) => {
    if (ids.length === 0) return {};
    try {
        const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd,brl,btc`);
        if (!res.ok) return null;
        return await res.json();
    } catch (e) {
        return null;
    }
};

const fetchBinanceUsdtBrl = async () => {
    try {
        const res = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=USDTBRL');
        if (!res.ok) return null;
        const data = await res.json();
        return parseFloat(data.price);
    } catch (e) { return null; }
};

const fetchDexQuotePolygon = async (srcToken, destToken, amountUsdt) => {
    const amountInMicro = Math.floor(amountUsdt * 1e6).toString();
    try {
        const url = `https://apiv5.paraswap.io/prices?srcToken=${srcToken}&srcDecimals=6&destToken=${destToken}&destDecimals=18&amount=${amountInMicro}&side=SELL&network=137`;
        const res = await fetch(url);
        if (!res.ok) return null;
        const data = await res.json();
        return parseFloat(data.priceRoute.destAmount) / 1e18;
    } catch (e) { return null; }
};

const getConfigs = async () => {
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/depeg_configs?is_active=eq.true`, {
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
            }
        });
        if (!res.ok) return [];
        return await res.json();
    } catch (e) {
        return [];
    }
};

const getLastHistory = async (userId, symbol) => {
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/depeg_alerts_history?user_id=eq.${userId}&symbol=eq.${symbol}&order=created_at.desc&limit=1`, {
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
            }
        });
        if (!res.ok) return null;
        const data = await res.json();
        return data.length > 0 ? data[0] : null;
    } catch (e) {
        return null;
    }
};

const saveHistory = async (event) => {
    try {
        await fetch(`${SUPABASE_URL}/rest/v1/depeg_alerts_history`, {
            method: 'POST',
            headers: supabaseHeaders,
            body: JSON.stringify([event])
        });
    } catch (e) {}
};

const sendTelegramAlert = async (symbol, network, price, target_peg, devPct, isDepeg, isReminder = false) => {
    if (!TG_TOKEN || !TG_CHAT_ID) {
        console.error('Telegram configuration missing');
        return;
    }

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

_Depeg Monitor 24/7_
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
    } catch (e) {
        console.error('Telegram send failed:', e.message);
    }
};

module.exports = async (req, res) => {
    // Segurança igual ao arb-alert
    const cronSecret = process.env.CRON_SECRET;
    let isAuthorized = false;

    if (cronSecret) {
        const authHeader = req.headers['authorization'];
        const querySecret = req.query?.secret;
        if (authHeader === `Bearer ${cronSecret}` || querySecret === cronSecret) {
            isAuthorized = true;
        }
    } else {
        isAuthorized = true; // Permite rodar livre se nao tiver secret
    }

    if (!isAuthorized) {
        const { verifyAuth } = require('./util.js');
        const user = await verifyAuth(req);
        if (user) isAuthorized = true;
    }

    if (!isAuthorized) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const activeConfigs = await getConfigs();
        if (activeConfigs.length === 0) {
            return res.status(200).json({ status: 'ok', msg: 'No active configs found' });
        }

        const cgIds = [...new Set(activeConfigs.map(c => c.coingecko_id).filter(id => id))];
        const cgData = await fetchCoinGeckoPrices(cgIds);
        
        let usdtBrlPrice = null;
        const needsDexFallback = activeConfigs.some(c => c.symbol === 'BRLA' || c.symbol === 'BRZ');
        if (needsDexFallback) {
            usdtBrlPrice = await fetchBinanceUsdtBrl();
        }

        const results = [];
        const currentTime = Date.now();
        const alertCooldown = 15 * 60 * 1000;

        for (const config of activeConfigs) {
            let currentPrice = null;

            if (config.coingecko_id && cgData && cgData[config.coingecko_id]) {
                const currencyKey = config.peg_currency.toLowerCase();
                if (cgData[config.coingecko_id][currencyKey]) {
                    currentPrice = cgData[config.coingecko_id][currencyKey];
                }
            }

            if (!currentPrice) {
                if (config.symbol === 'BRLA' || config.symbol === 'BRZ') {
                    const destContract = config.symbol === 'BRLA' ? CONTRACTS.brla : CONTRACTS.brz;
                    const tokensRec = await fetchDexQuotePolygon(CONTRACTS.usdt, destContract, 100);
                    if (tokensRec && tokensRec > 0) {
                        const priceInUsdt = 100 / tokensRec;
                        if (config.peg_currency === 'BRL' && usdtBrlPrice) {
                            currentPrice = priceInUsdt * usdtBrlPrice;
                        } else {
                            currentPrice = priceInUsdt;
                        }
                    }
                } else if (config.peg_currency === 'USD') {
                    try {
                        const resB = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${config.symbol}USDT`);
                        if (resB.ok) {
                            const dataB = await resB.json();
                            currentPrice = parseFloat(dataB.price);
                        }
                    } catch (e) {}
                }
            }

            if (currentPrice !== null && !isNaN(currentPrice)) {
                const devPct = ((currentPrice / config.target_peg) - 1) * 100;
                const absDevPct = Math.abs(devPct);
                
                const lastHistory = await getLastHistory(config.user_id, config.symbol);
                const wasDepegged = lastHistory && lastHistory.status.includes('DEPEG');
                const lastAlertTime = lastHistory ? new Date(lastHistory.created_at).getTime() : 0;

                const recoveryThreshold = config.threshold_pct * 0.85;
                const isCurrentlyDepegged = wasDepegged 
                    ? absDevPct >= recoveryThreshold 
                    : absDevPct >= config.threshold_pct;

                let action = 'NONE';

                if (isCurrentlyDepegged && !wasDepegged) {
                    const status = devPct > 0 ? 'DEPEG_UP' : 'DEPEG_DOWN';
                    await saveHistory({
                        user_id: config.user_id,
                        symbol: config.symbol,
                        price: currentPrice,
                        target_peg: config.target_peg,
                        deviation_pct: devPct,
                        status: status
                    });
                    await sendTelegramAlert(config.symbol, config.network || 'Global', currentPrice, config.target_peg, devPct, true, false);
                    action = 'NEW_DEPEG';
                } else if (isCurrentlyDepegged && wasDepegged) {
                    if (currentTime - lastAlertTime >= alertCooldown) {
                        await saveHistory({
                            user_id: config.user_id,
                            symbol: config.symbol,
                            price: currentPrice,
                            target_peg: config.target_peg,
                            deviation_pct: devPct,
                            status: lastHistory.status // mantém o status original
                        });
                        await sendTelegramAlert(config.symbol, config.network || 'Global', currentPrice, config.target_peg, devPct, true, true);
                        action = 'REMINDER';
                    } else {
                        action = 'COOLDOWN';
                    }
                } else if (!isCurrentlyDepegged && wasDepegged) {
                    await saveHistory({
                        user_id: config.user_id,
                        symbol: config.symbol,
                        price: currentPrice,
                        target_peg: config.target_peg,
                        deviation_pct: devPct,
                        status: 'RECOVERED'
                    });
                    await sendTelegramAlert(config.symbol, config.network || 'Global', currentPrice, config.target_peg, devPct, false, false);
                    action = 'RECOVERED';
                }

                results.push({
                    symbol: config.symbol,
                    price: currentPrice,
                    devPct: devPct,
                    action: action
                });
            } else {
                results.push({
                    symbol: config.symbol,
                    error: 'Could not fetch price'
                });
            }
        }

        return res.status(200).json({ status: 'ok', results });

    } catch (err) {
        console.error('Depeg cron error:', err);
        return res.status(500).json({ error: err.message });
    }
};
