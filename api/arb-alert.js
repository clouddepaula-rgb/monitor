// ============================================
// ARBDASH — TELEGRAM ALERT BOT (24/7 CRON)
// Vercel Serverless Function
// ============================================

// --- CONFIG ---
const TG_TOKEN   = process.env.TG_TOKEN;
const TG_CHAT_ID = process.env.TG_CHAT_ID;

const SUPABASE_URL  = 'https://vaahwukpupiiimnuagfa.supabase.co';
const SUPABASE_KEY  = 'sb_publishable_5NbtFzk47B5qmGqNJbIL5A_PlTmSwjC';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || SUPABASE_KEY;

const THRESHOLD_PCT = 0.22;       // Lucro mínimo para alertar
const COOLDOWN_MS   = 3 * 60 * 1000; // 3 minutos entre alertas da mesma rota
let INVESTMENT      = 10000;      // BRL base para cálculo

const CONTRACTS = {
    usdt: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
    brz:  '0x4eD141110F6EeeAbA9A1df36d8c26f684d2475Dc',
    brla: '0xe6a537a407488807f0bbeb0038b79004f19dddfb'
};

const EXCHANGES = {
    binance: {
        name: 'Binance',
        url: 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent('https://api.binance.com/api/v3/depth?symbol=USDTBRL&limit=5'),
        parseAsks: (d) => d?.asks || [],
        parseBids: (d) => d?.bids || [],
        fees: { trading: 0.10, withdrawal: 0.07, withdrawalBrl: 3.60 }
    },
    kucoin: {
        name: 'KuCoin',
        url: 'https://api.kucoin.com/api/v1/market/orderbook/level2_20?symbol=USDT-BRL',
        parseAsks: (d) => d?.data?.asks || [],
        parseBids: (d) => d?.data?.bids || [],
        fees: { trading: 0.10, withdrawal: 0.80, withdrawalBrl: 0.00 }
    },
    bybit: {
        name: 'Bybit',
        url: 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent('https://api.bybit.com/v5/market/orderbook?category=spot&symbol=USDTBRL&limit=5'),
        parseAsks: (d) => d?.result?.a || [],
        parseBids: (d) => d?.result?.b || [],
        fees: { trading: 0.10, withdrawal: 0.10, withdrawalBrl: 0.00 }
    },
    bitget: {
        name: 'Bitget',
        url: 'https://api.bitget.com/api/v2/spot/market/orderbook?symbol=USDTBRL&limit=5',
        parseAsks: (d) => d?.data?.asks || [],
        parseBids: (d) => d?.data?.bids || [],
        fees: { trading: 0.10, withdrawal: 0.20, withdrawalBrl: 2.60 }
    }
};

// ============================================
// HELPERS
// ============================================
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

const formatBRL = (v) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

const nowBRT = () =>
    new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });

// ============================================
// SUPABASE COOLDOWN HELPERS
// ============================================
const supabaseHeaders = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal'
};

const getCooldowns = async () => {
    try {
        const res = await fetch(
            `${SUPABASE_URL}/rest/v1/arb_alert_cooldowns?select=route_key,last_alert_at`,
            { headers: supabaseHeaders }
        );
        if (!res.ok) return {};
        const rows = await res.json();
        const map = {};
        for (const row of rows) {
            map[row.route_key] = new Date(row.last_alert_at).getTime();
        }
        return map;
    } catch {
        return {}; // Se falhar, envia alerta mesmo assim
    }
};

const updateCooldowns = async (routeKeys) => {
    if (routeKeys.length === 0) return;
    const now = new Date().toISOString();
    const rows = routeKeys.map(k => ({ route_key: k, last_alert_at: now }));
    try {
        await fetch(`${SUPABASE_URL}/rest/v1/arb_alert_cooldowns`, {
            method: 'POST',
            headers: { ...supabaseHeaders, 'Prefer': 'resolution=merge-duplicates' },
            body: JSON.stringify(rows)
        });
    } catch { /* silencioso */ }
};

// ============================================
// FETCH ALL EXCHANGE ORDERBOOKS
// ============================================
const fetchAllExchanges = async () => {
    const results = {};
    const errors = [];
    const entries = Object.entries(EXCHANGES);

    const fetches = await Promise.allSettled(
        entries.map(async ([id, ex]) => {
            try {
                const data = await fetchJson(ex.url);
                const asks = ex.parseAsks(data);
                const bids = ex.parseBids(data);
                if (asks.length > 0 && bids.length > 0) {
                    return { id, ask: parseFloat(asks[0][0]), bid: parseFloat(bids[0][0]) };
                }
                throw new Error('Empty orderbook');
            } catch (err) {
                throw new Error(`${id} failed: ${err.message}`);
            }
        })
    );

    for (const r of fetches) {
        if (r.status === 'fulfilled' && r.value) {
            results[r.value.id] = r.value;
        } else {
            errors.push(r.reason.message);
        }
    }
    return { results, errors };
};

// ============================================
// CEX/CEX ARBITRAGE
// ============================================
const calculateCexCex = (prices) => {
    const opps = [];
    const ids = Object.keys(prices);

    for (const buyId of ids) {
        for (const sellId of ids) {
            if (buyId === sellId) continue;

            const buyEx  = EXCHANGES[buyId];
            const sellEx = EXCHANGES[sellId];
            const buyPrice  = prices[buyId].ask;
            const sellPrice = prices[sellId].bid;

            const usdtBruto     = INVESTMENT / buyPrice;
            const usdtAposTrade = usdtBruto * (1 - buyEx.fees.trading / 100);
            const usdtLiquido   = Math.max(0, usdtAposTrade - buyEx.fees.withdrawal);
            const brlBruto      = usdtLiquido * sellPrice;
            const brlAposTrade  = brlBruto * (1 - sellEx.fees.trading / 100);
            const brlLiquido    = Math.max(0, brlAposTrade - (sellEx.fees.withdrawalBrl || 0));
            const lucro         = brlLiquido - INVESTMENT;
            const lucroPct      = (lucro / INVESTMENT) * 100;

            if (lucroPct >= THRESHOLD_PCT) {
                opps.push({
                    type: 'CEX/CEX',
                    routeKey: `cex_${buyId}_${sellId}`,
                    buyName: buyEx.name, sellName: sellEx.name,
                    buyPrice, sellPrice, lucro, lucroPct
                });
            }
        }
    }
    // Ordena pelo maior lucro
    return opps.sort((a, b) => b.lucroPct - a.lucroPct);
};

// ============================================
// DEX QUOTES (Paraswap + Kyber / BRZ + BRLA)
// ============================================
const fetchDexQuotes = async (usdtAmount) => {
    if (usdtAmount <= 0) return {};
    const amt = Math.floor(usdtAmount * 1e6).toString();

    const queries = [
        { key: 'paraswap_brz',  fn: fetchJson(`https://apiv5.paraswap.io/prices?srcToken=${CONTRACTS.usdt}&srcDecimals=6&destToken=${CONTRACTS.brz}&destDecimals=18&amount=${amt}&side=SELL&network=137`).then(d => parseFloat(d.priceRoute.destAmount) / 1e18).catch(() => 0) },
        { key: 'kyber_brz',     fn: fetchJson(`https://aggregator-api.kyberswap.com/polygon/api/v1/routes?tokenIn=${CONTRACTS.usdt}&tokenOut=${CONTRACTS.brz}&amountIn=${amt}`).then(d => parseFloat(d.data.routeSummary.amountOut) / 1e18).catch(() => 0) },
        { key: 'paraswap_brla', fn: fetchJson(`https://apiv5.paraswap.io/prices?srcToken=${CONTRACTS.usdt}&srcDecimals=6&destToken=${CONTRACTS.brla}&destDecimals=18&amount=${amt}&side=SELL&network=137`).then(d => parseFloat(d.priceRoute.destAmount) / 1e18).catch(() => 0) },
        { key: 'kyber_brla',    fn: fetchJson(`https://aggregator-api.kyberswap.com/polygon/api/v1/routes?tokenIn=${CONTRACTS.usdt}&tokenOut=${CONTRACTS.brla}&amountIn=${amt}`).then(d => parseFloat(d.data.routeSummary.amountOut) / 1e18).catch(() => 0) }
    ];

    const results = await Promise.allSettled(queries.map(q => q.fn));
    const quotes = {};
    queries.forEach((q, i) => {
        quotes[q.key] = results[i].status === 'fulfilled' ? results[i].value : 0;
    });
    return quotes;
};

// ============================================
// CEX/DEX ARBITRAGE
// ============================================
const calculateCexDex = async (prices) => {
    const opps = [];
    const ids = Object.keys(prices);
    if (ids.length === 0) return opps;

    // Usa a exchange com menor ask como referência para cotação DEX
    let refId = ids[0];
    for (const id of ids) {
        if (prices[id].ask < prices[refId].ask) refId = id;
    }

    const refEx = EXCHANGES[refId];
    const refUsdt = Math.max(0,
        (INVESTMENT / prices[refId].ask) * (1 - refEx.fees.trading / 100) - refEx.fees.withdrawal
    );

    const dexQuotes = await fetchDexQuotes(refUsdt);

    // Taxa de conversão (tokens por USDT) baseada na cotação de referência
    const rates = {};
    for (const [key, tokens] of Object.entries(dexQuotes)) {
        rates[key] = refUsdt > 0 && tokens > 0 ? tokens / refUsdt : 0;
    }

    const DEX_LABELS = {
        paraswap_brz: 'Paraswap (BRZ)', kyber_brz: 'Kyber (BRZ)',
        paraswap_brla: 'Paraswap (BRLA)', kyber_brla: 'Kyber (BRLA)'
    };

    for (const exId of ids) {
        const ex = EXCHANGES[exId];
        const buyPrice = prices[exId].ask;
        const usdtBruto = INVESTMENT / buyPrice;
        const usdtAposTrade = usdtBruto * (1 - ex.fees.trading / 100);
        const usdtLiquido = Math.max(0, usdtAposTrade - ex.fees.withdrawal);

        for (const [routeKey, rate] of Object.entries(rates)) {
            if (rate <= 0) continue;
            const tokens = usdtLiquido * rate;
            const lucro = tokens - INVESTMENT;
            const lucroPct = (lucro / INVESTMENT) * 100;

            if (lucroPct >= THRESHOLD_PCT) {
                opps.push({
                    type: 'CEX/DEX',
                    routeKey: `dex_${exId}_${routeKey}`,
                    buyName: ex.name, sellName: DEX_LABELS[routeKey],
                    buyPrice, lucro, lucroPct
                });
            }
        }
    }
    return opps.sort((a, b) => b.lucroPct - a.lucroPct);
};

// ============================================
// TELEGRAM MESSAGE
// ============================================
const sendTelegramMessage = async (opps) => {
    if (opps.length === 0) return;

    let msg = `📊 *OPORTUNIDADES DE ARBITRAGEM*\n`;

    for (const opp of opps) {
        if (opp.type === 'CEX/CEX') {
            msg += `\n🟢 *CEX/CEX* · ${opp.buyName} → ${opp.sellName}\n`;
            msg += `Compra: R$ ${opp.buyPrice.toFixed(4)} · Venda: R$ ${opp.sellPrice.toFixed(4)}\n`;
            msg += `*Lucro: ${formatBRL(opp.lucro)} (${opp.lucroPct > 0 ? '+' : ''}${opp.lucroPct.toFixed(2)}%)*\n`;
        } else {
            msg += `\n🔵 *CEX/DEX* · ${opp.buyName} → ${opp.sellName}\n`;
            msg += `Compra: R$ ${opp.buyPrice.toFixed(4)}\n`;
            msg += `*Lucro: ${formatBRL(opp.lucro)} (${opp.lucroPct > 0 ? '+' : ''}${opp.lucroPct.toFixed(2)}%)*\n`;
        }
    }

    msg += `\n💰 Investimento: ${formatBRL(INVESTMENT)}`;
    msg += `\n🕐 ${nowBRT()}`;
    msg += `\n\n_ArbDash Monitor 24/7_`;

    if (!TG_TOKEN || !TG_CHAT_ID) {
        throw new Error('Telegram configuration missing (TG_TOKEN or TG_CHAT_ID not set in env)');
    }

    try {
        const response = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: TG_CHAT_ID,
                text: msg,
                parse_mode: 'Markdown'
            })
        });
        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(`Telegram API Error: ${response.status} - ${JSON.stringify(errData)}`);
        }
        console.log('Mensagem de alerta enviada com sucesso para o Telegram.');
    } catch (e) {
        console.error('Telegram send failed:', e.message);
        throw e;
    }
};

const sanitizeMonitorOpportunities = (items) => {
    if (!Array.isArray(items)) return [];

    return items.slice(0, 8).map((item) => {
        const lucroPct = Number(item.lucroPct);
        const lucro = Number(item.lucro);
        const buyPrice = Number(item.buyPrice);
        const sellPrice = item.sellPrice == null ? undefined : Number(item.sellPrice);
        const type = item.type === 'CEX/CEX' ? 'CEX/CEX' : 'CEX/DEX';
        const buyName = String(item.buyName || '').slice(0, 40);
        const sellName = String(item.sellName || '').slice(0, 60);
        const routeKey = String(item.routeKey || `${type}_${buyName}_${sellName}`)
            .toLowerCase()
            .replace(/[^a-z0-9_]+/g, '_')
            .slice(0, 120);

        return {
            type,
            routeKey,
            buyName,
            sellName,
            buyPrice,
            sellPrice,
            lucro,
            lucroPct
        };
    }).filter((opp) => {
        if (!opp.buyName || !opp.sellName || !opp.routeKey) return false;
        if (!Number.isFinite(opp.buyPrice) || !Number.isFinite(opp.lucro) || !Number.isFinite(opp.lucroPct)) return false;
        if (opp.lucroPct < THRESHOLD_PCT) return false;
        if (opp.type === 'CEX/CEX' && !Number.isFinite(opp.sellPrice)) return false;
        return true;
    });
};

// ============================================
// MAIN HANDLER
// ============================================
module.exports = async (req, res) => {
    // Segurança: aceita Vercel CRON_SECRET, query param ?secret= ou JWT Token do usuário logado
    const cronSecret = process.env.CRON_SECRET;
    let isAuthorized = false;

    if (cronSecret) {
        const authHeader = req.headers['authorization'];
        const querySecret = req.query?.secret;
        const isVercelCron = authHeader === `Bearer ${cronSecret}`;
        const isQueryAuth  = querySecret === cronSecret;
        if (isVercelCron || isQueryAuth) {
            isAuthorized = true;
        }
    } else {
        isAuthorized = true; // Se não configurado, aceita livremente (cron-job)
    }

    if (!isAuthorized) {
        const { verifyAuth } = require('./util.js');
        const user = await verifyAuth(req);
        if (user) {
            isAuthorized = true;
        }
    }

    if (!isAuthorized) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    // Carrega preferências: prioridade 1) POST body do frontend, 2) Supabase
    let prefsLoaded = false;
    let prefsDebug = 'none';

    // 1) Se o frontend enviou via POST body (mais confiável, bypassa RLS)
    if (req.method === 'POST' && req.body) {
        const body = req.body;
        if (body.investment != null) {
            INVESTMENT = parseFloat(body.investment);
            prefsLoaded = true;
            prefsDebug = 'post_body';
        }
        if (body.fees) {
            for (const [id, f] of Object.entries(body.fees)) {
                if (EXCHANGES[id]) {
                    EXCHANGES[id].fees = {
                        trading: parseFloat(f.trading ?? EXCHANGES[id].fees.trading),
                        withdrawal: parseFloat(f.withdrawal ?? EXCHANGES[id].fees.withdrawal),
                        withdrawalBrl: parseFloat(f.withdrawalBrl ?? EXCHANGES[id].fees.withdrawalBrl)
                    };
                }
            }
        }
    }

    // 2) Se não veio do POST, tenta ler do Supabase (cron job)
    const monitorOpps = sanitizeMonitorOpportunities(req.body?.opportunities);
    if (monitorOpps.length > 0) {
        try {
            const isForce = req.query?.force === 'true';
            const cooldowns = await getCooldowns();
            const now = Date.now();
            const newOpps = isForce ? monitorOpps : monitorOpps.filter(opp => {
                const lastAlert = cooldowns[opp.routeKey] || 0;
                return (now - lastAlert) >= COOLDOWN_MS;
            });

            if (newOpps.length === 0) {
                return res.status(200).json({
                    status: 'ok',
                    source: 'monitor',
                    opportunities: monitorOpps.length,
                    cooledDown: true
                });
            }

            await sendTelegramMessage(newOpps);
            await updateCooldowns(newOpps.map(o => o.routeKey));

            return res.status(200).json({
                status: 'alerted',
                source: 'monitor',
                opportunities: newOpps.length,
                investment: INVESTMENT,
                routes: newOpps.map(o => `${o.type}: ${o.buyName}->${o.sellName} (${o.lucroPct.toFixed(2)}%)`)
            });
        } catch (err) {
            console.error('Monitor alert error:', err);
            return res.status(500).json({ error: err.message });
        }
    }

    if (!prefsLoaded) {
        try {
            const svcKey = SUPABASE_SERVICE_KEY;
            prefsDebug = svcKey !== SUPABASE_KEY ? 'service_key' : 'anon_key';

            const prefRes = await fetch(`${SUPABASE_URL}/rest/v1/user_preferences?select=investment,fees&order=updated_at.desc&limit=1`, {
                headers: {
                    'apikey': SUPABASE_KEY,
                    'Authorization': `Bearer ${svcKey}`
                }
            });
            if (prefRes.ok) {
                const prefs = await prefRes.json();
                prefsDebug += `|rows:${prefs.length}`;
                if (prefs && prefs.length > 0) {
                    const p = prefs[0];
                    if (p.investment != null) {
                        INVESTMENT = parseFloat(p.investment);
                        prefsLoaded = true;
                    }
                    if (p.fees) {
                        for (const [id, f] of Object.entries(p.fees)) {
                            if (EXCHANGES[id]) {
                                EXCHANGES[id].fees = {
                                    trading: parseFloat(f.trading ?? EXCHANGES[id].fees.trading),
                                    withdrawal: parseFloat(f.withdrawal ?? EXCHANGES[id].fees.withdrawal),
                                    withdrawalBrl: parseFloat(f.withdrawalBrl ?? EXCHANGES[id].fees.withdrawalBrl)
                                };
                            }
                        }
                    }
                }
            } else {
                prefsDebug += `|http:${prefRes.status}`;
            }
        } catch (err) {
            prefsDebug += `|err:${err.message}`;
            console.error('Failed to load user preferences from Supabase:', err.message);
        }
    }

    try {
        // 1. Busca orderbooks de todas as exchanges
        const { results: prices, errors: fetchErrors } = await fetchAllExchanges();
        const exchangeCount = Object.keys(prices).length;
        if (exchangeCount < 2) {
            return res.status(200).json({ status: 'skip', reason: `Only ${exchangeCount} exchanges online`, errors: fetchErrors });
        }

        // 2. Calcula oportunidades CEX/CEX e CEX/DEX em paralelo
        const [cexOpps, dexOpps] = await Promise.all([
            calculateCexCex(prices),
            calculateCexDex(prices)
        ]);

        const allOpps = [...cexOpps, ...dexOpps];

        if (allOpps.length === 0) {
            return res.status(200).json({ status: 'ok', opportunities: 0 });
        }

        // 3. Verifica cooldowns (ignora se forçado pelo painel)
        const isForce = req.query?.force === 'true';
        const cooldowns = await getCooldowns();
        const now = Date.now();
        const newOpps = isForce ? allOpps : allOpps.filter(opp => {
            const lastAlert = cooldowns[opp.routeKey] || 0;
            return (now - lastAlert) >= COOLDOWN_MS;
        });

        if (newOpps.length === 0) {
            return res.status(200).json({ status: 'ok', opportunities: allOpps.length, cooledDown: true });
        }

        // 4. Envia alerta consolidado no Telegram
        await sendTelegramMessage(newOpps);

        // 5. Atualiza cooldowns
        await updateCooldowns(newOpps.map(o => o.routeKey));

        return res.status(200).json({
            status: 'alerted',
            opportunities: newOpps.length,
            investment: INVESTMENT,
            prefsLoaded,
            prefsDebug,
            routes: newOpps.map(o => `${o.type}: ${o.buyName}→${o.sellName} (${o.lucroPct.toFixed(2)}%)`),
            errors: fetchErrors
        });

    } catch (err) {
        console.error('Cron error:', err);
        return res.status(500).json({ error: err.message });
    }
};
