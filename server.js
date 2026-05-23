require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const https = require('https');
const path = require('path');

const app = express();

const CONTRACTS = {
    usdt: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
    brla: "0xe6a537a407488807f0bbeb0038b79004f19dddfb"
};

const SUPABASE_HOSTNAME = 'vaahwukpupiiimnuagfa.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_5NbtFzk47B5qmGqNJbIL5A_PlTmSwjC';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// 1. Segurança de Headers HTTP com Helmet
// IMPORTANTE: CSP é definida por http-equiv em cada HTML. Desabilitamos aqui para não conflitar.
app.use(helmet({
    contentSecurityPolicy: false,      // CSP já definida nos HTMLs via <meta http-equiv>
    crossOriginEmbedderPolicy: false,  // Permite carregar recursos externos (imagens de exchanges)
}));

// 2. Servir arquivos estáticos do Vite com MIME types corretos ANTES das rotas de API
// CRITICAL: deve vir antes das rotas /api/ para que assets como CSS/JS não caiam no catch-all
app.use(express.static(path.join(__dirname, 'dist'), {
    extensions: ['html'],
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.css')) {
            res.setHeader('Content-Type', 'text/css; charset=utf-8');
        } else if (filePath.endsWith('.js') || filePath.endsWith('.mjs')) {
            res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        } else if (filePath.endsWith('.svg')) {
            res.setHeader('Content-Type', 'image/svg+xml');
        }
    }
}));

// 3. Configuração Restrita de CORS
// Altere para os domínios reais em produção
const allowedOrigins = [
    'http://localhost',
    'http://127.0.0.1',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'http://localhost:5173',
    'http://localhost:4173'
];

const isLocalOrigin = (origin) => {
    if (!origin) return true;
    try {
        const url = new URL(origin);
        const hostname = url.hostname;
        return (
            hostname === 'localhost' ||
            hostname === '127.0.0.1' ||
            hostname.startsWith('192.168.') ||
            hostname.startsWith('10.') ||
            hostname.startsWith('172.') ||
            hostname.endsWith('.local')
        );
    } catch (e) {
        return false;
    }
};

app.use(cors({
    origin: function(origin, callback) {
        // Permitir requisições sem origin (ex: mobile apps, curl, server-to-server)
        // E requisições da mesma origem ou IPs locais
        if (!origin || allowedOrigins.includes(origin) || isLocalOrigin(origin)) {
            callback(null, true);
        } else {
            // Log para debug mas não crasha o servidor
            console.warn(`[CORS] Origem bloqueada: ${origin}`);
            callback(null, false);
        }
    },
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));

// 4. Proteção contra ataques DDoS e Força Bruta (Rate Limiting)
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 1000, // Limita cada IP a 1000 requisições por windowMs para permitir realtime polling
    message: { error: 'Muitas requisições originadas deste IP, por favor tente novamente após 15 minutos.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Aplica o Rate Limiter a todas as rotas de API
app.use('/api/', limiter);

// Middleware para processar JSON
app.use(express.json());

// --- ROTAS ---

// Middleware de Autenticação Básica (Qualquer usuário logado)
const verifyAuth = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Acesso negado: Token não fornecido ou inválido.' });
    }
    
    const token = authHeader.split(' ')[1];

    const options = {
        hostname: SUPABASE_HOSTNAME,
        path: '/auth/v1/user',
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${token}`,
            'apikey': SUPABASE_ANON_KEY
        }
    };

    const supaReq = https.request(options, (supaRes) => {
        let data = '';
        supaRes.on('data', chunk => data += chunk);
        supaRes.on('end', () => {
            if (supaRes.statusCode !== 200) {
                return res.status(401).json({ error: 'Acesso negado: Sessão inválida ou expirada.' });
            }
            req.user = JSON.parse(data); // Salva os dados do user
            next();
        });
    });

    supaReq.on('error', (err) => res.status(500).json({ error: err.message }));
    supaReq.end();
};

app.get('/api/defillama', verifyAuth, async (req, res) => {
    try {
        const url = `https://coins.llama.fi/prices/current/polygon:${CONTRACTS.usdt},polygon:${CONTRACTS.brla}`;
        const response = await fetch(url);
        const data = await response.json();
        res.status(200).json(data);
    } catch (err) {
        res.status(500).json({ error: 'Erro ao analisar resposta da API.', details: err.message });
    }
});

// Proxy Seguro para a Kucoin (Orderbook REST)
app.get('/api/kucoin/ticker', verifyAuth, async (req, res) => {
    try {
        const url = 'https://api.kucoin.com/api/v1/market/orderbook/level2_20?symbol=USDT-BRL';
        const response = await fetch(url);
        const data = await response.json();
        res.status(200).json(data);
    } catch (err) {
        res.status(500).json({ error: 'Erro no proxy da Kucoin.', details: err.message });
    }
});

// Proxy Seguro para a Kucoin (Bullet Public - WebSocket Token)
app.post('/api/kucoin/bullet-public', verifyAuth, async (req, res) => {
    try {
        const url = 'https://api.kucoin.com/api/v1/bullet-public';
        const response = await fetch(url, { method: 'POST' });
        const data = await response.json();
        res.status(200).json(data);
    } catch (err) {
        res.status(500).json({ error: 'Erro no proxy bullet da Kucoin.', details: err.message });
    }
});

// Proxy para Binance (Orderbook)
app.get('/api/exchanges/binance', verifyAuth, async (req, res) => {
    try {
        const response = await fetch('https://api.binance.com/api/v3/depth?symbol=USDTBRL&limit=20');
        const data = await response.json();
        res.status(200).json(data);
    } catch (err) {
        res.status(500).json({ error: 'Erro no proxy da Binance.' });
    }
});

// Proxy para Bybit (Orderbook)
app.get('/api/exchanges/bybit', verifyAuth, async (req, res) => {
    try {
        const response = await fetch('https://api.bybit.com/v5/market/orderbook?category=spot&symbol=USDTBRL&limit=20');
        const data = await response.json();
        res.status(200).json(data);
    } catch (err) {
        res.status(500).json({ error: 'Erro no proxy da Bybit.' });
    }
});

// Proxy para Bitget (Orderbook)
app.get('/api/exchanges/bitget', verifyAuth, async (req, res) => {
    try {
        const response = await fetch('https://api.bitget.com/api/v2/spot/market/orderbook?symbol=USDTBRL&limit=20');
        const data = await response.json();
        res.status(200).json(data);
    } catch (err) {
        res.status(500).json({ error: 'Erro no proxy da Bitget.' });
    }
});

// Middleware de verificação de Admin
const verifyAdmin = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Acesso negado: Token não fornecido ou inválido.' });
    }
    
    const token = authHeader.split(' ')[1];

    // 1. Verifica se o token pertence a um usuário válido do Supabase
    const options = {
        hostname: SUPABASE_HOSTNAME,
        path: '/auth/v1/user',
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${token}`,
            'apikey': SUPABASE_ANON_KEY
        }
    };

    const supaReq = https.request(options, (supaRes) => {
        let data = '';
        supaRes.on('data', chunk => data += chunk);
        supaRes.on('end', () => {
            if (supaRes.statusCode !== 200) {
                return res.status(401).json({ error: 'Acesso negado: Sessão inválida ou expirada.' });
            }
            
            const user = JSON.parse(data);
            const uid = user.id;

            // 2. Verifica se o usuário tem a flag is_admin = true na tabela profiles
            const profileOptions = {
                hostname: SUPABASE_HOSTNAME,
                path: `/rest/v1/profiles?id=eq.${uid}&select=is_admin`,
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                    'apikey': SUPABASE_SERVICE_ROLE_KEY
                }
            };

            const profileReq = https.request(profileOptions, (profileRes) => {
                let profileData = '';
                profileRes.on('data', chunk => profileData += chunk);
                profileRes.on('end', () => {
                    if (profileRes.statusCode === 200) {
                        const profiles = JSON.parse(profileData);
                        if (profiles.length > 0 && profiles[0].is_admin === true) {
                            next(); // Passou na verificação! O usuário é admin.
                        } else {
                            res.status(403).json({ error: 'Acesso negado: Esta ação requer privilégios de Administrador.' });
                        }
                    } else {
                        res.status(500).json({ error: 'Erro ao verificar permissões de administrador no banco.' });
                    }
                });
            });
            
            profileReq.on('error', (err) => res.status(500).json({ error: err.message }));
            profileReq.end();
        });
    });

    supaReq.on('error', (err) => res.status(500).json({ error: err.message }));
    supaReq.end();
};

app.post('/api/admin/users', verifyAdmin, (req, res) => {
    const { email, password } = req.body;
    
    if (!email || !password) {
        return res.status(400).json({ error: 'Email e senha são obrigatórios.' });
    }

    if (!SUPABASE_SERVICE_ROLE_KEY) {
        return res.status(500).json({ error: 'Chave mestre não configurada no servidor.' });
    }

    const postData = JSON.stringify({ email, password, email_confirm: true });

    const options = {
        hostname: SUPABASE_HOSTNAME,
        path: '/auth/v1/admin/users',
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            'apikey': SUPABASE_SERVICE_ROLE_KEY,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
        }
    };

    const supaReq = https.request(options, (supaRes) => {
        let data = '';
        supaRes.on('data', chunk => data += chunk);
        supaRes.on('end', () => {
            res.status(supaRes.statusCode).send(data);
        });
    });

    supaReq.on('error', (err) => {
        res.status(500).json({ error: err.message });
    });

    supaReq.write(postData);
    supaReq.end();
});

app.delete('/api/admin/users/:uid', verifyAdmin, (req, res) => {
    const uid = req.params.uid;
    
    if (!SUPABASE_SERVICE_ROLE_KEY) {
        return res.status(500).json({ error: 'Chave mestre não configurada no servidor.' });
    }

    const options = {
        hostname: SUPABASE_HOSTNAME,
        path: `/auth/v1/admin/users/${uid}`,
        method: 'DELETE',
        headers: {
            'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            'apikey': SUPABASE_SERVICE_ROLE_KEY,
            'Content-Type': 'application/json'
        }
    };

    const supaReq = https.request(options, (supaRes) => {
        let data = '';
        supaRes.on('data', chunk => data += chunk);
        supaRes.on('end', () => {
            res.status(supaRes.statusCode).send(data);
        });
    });

    supaReq.on('error', (err) => {
        res.status(500).json({ error: err.message });
    });

    supaReq.end();
});

// Fallback para Clean URLs: rotas como /login → /login.html
// Apenas para caminhos sem extensão (não para assets JS/CSS/imagens)
app.get('*', (req, res) => {
    const urlPath = req.path;
    // Se a URL tem extensão, não fazer nada (já foi tratado pelo express.static)
    if (urlPath.includes('.')) {
        return res.status(404).json({ error: 'Arquivo não encontrado.' });
    }
    // Tenta servir o .html correspondente (ex: /login → dist/login.html)
    const htmlFile = path.join(__dirname, 'dist', urlPath + '.html');
    const fs = require('fs');
    if (fs.existsSync(htmlFile)) {
        return res.sendFile(htmlFile);
    }
    // Fallback final para o index
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
    console.log(`[ArbDash] Servidor Express Seguro rodando na porta ${PORT}`);
    console.log(`[ArbDash] Endpoint ativo: http://localhost:${PORT}/api/defillama`);
});

// --- WEBSOCKET SERVER (BACKEND) ---
const wss = new WebSocket.Server({ server });

// Central Price Manager
const latestCexPrices = {
    binance: {},
    kucoin: {},
    bybit: {},
    bitget: {}
};

const broadcastPrice = (exId, askOrAsks, bidOrBids) => {
    // Se for array (orderbook), armazenamos as listas e extraímos o topo para retrocompatibilidade
    if (Array.isArray(askOrAsks)) {
        latestCexPrices[exId].asks = askOrAsks;
        if (askOrAsks.length > 0) latestCexPrices[exId].ask = parseFloat(askOrAsks[0][0]);
    } else if (askOrAsks !== undefined && askOrAsks !== null && !isNaN(askOrAsks)) {
        latestCexPrices[exId].ask = askOrAsks;
    }

    if (Array.isArray(bidOrBids)) {
        latestCexPrices[exId].bids = bidOrBids;
        if (bidOrBids.length > 0) latestCexPrices[exId].bid = parseFloat(bidOrBids[0][0]);
    } else if (bidOrBids !== undefined && bidOrBids !== null && !isNaN(bidOrBids)) {
        latestCexPrices[exId].bid = bidOrBids;
    }
    
    latestCexPrices[exId].lastUpdate = Date.now();

    const payload = JSON.stringify({ 
        type: 'price_update', 
        exId, 
        ask: latestCexPrices[exId].ask, 
        bid: latestCexPrices[exId].bid,
        asks: latestCexPrices[exId].asks,
        bids: latestCexPrices[exId].bids
    });
    
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(payload);
        }
    });
};

wss.on('connection', (ws) => {
    console.log('[WS] Novo cliente conectado (Frontend)');
    // Send latest known prices immediately upon connection
    for (const [exId, data] of Object.entries(latestCexPrices)) {
        if (data.ask || data.bid) {
            ws.send(JSON.stringify({ type: 'price_update', exId, ask: data.ask, bid: data.bid }));
        }
    }
});

// Gerenciamento Local de Orderbooks para exchanges que enviam Deltas
const localBooks = {
    bybit: { asks: [], bids: [] },
    bitget: { asks: [], bids: [] }
};

const applyDelta = (exId, side, deltas, isAsk) => {
    const map = new Map();
    localBooks[exId][side].forEach(item => map.set(parseFloat(item[0]), item));
    deltas.forEach(item => {
        const price = parseFloat(item[0]);
        const size = parseFloat(item[1]);
        if (size === 0) {
            map.delete(price);
        } else {
            map.set(price, item);
        }
    });
    const merged = Array.from(map.values());
    merged.sort((a, b) => isAsk ? parseFloat(a[0]) - parseFloat(b[0]) : parseFloat(b[0]) - parseFloat(a[0]));
    localBooks[exId][side] = merged.slice(0, 50); // manter top 50
};

// --- EXCHANGE WEBSOCKET CLIENTS ---
const webSocketActive = {
    binance: false,
    kucoin: false,
    bybit: false,
    bitget: false
};

const initBackendWebSockets = () => {
    // Binance
    const connectBinanceWS = () => {
        const wsBinance = new WebSocket('wss://stream.binance.com:9443/ws/usdtbrl@depth20@100ms');
        wsBinance.on('open', () => { webSocketActive.binance = true; console.log('[WS] Binance Connected'); });
        wsBinance.on('message', (data) => {
            try {
                const msg = JSON.parse(data);
                if (msg.a && msg.b) broadcastPrice('binance', msg.a, msg.b);
            } catch(e){}
        });
        wsBinance.on('close', () => {
            webSocketActive.binance = false;
            console.log('[WS] Binance Disconnected, retrying...');
            setTimeout(connectBinanceWS, 5000);
        });
        wsBinance.on('error', () => { webSocketActive.binance = false; });
    };
    connectBinanceWS();

    // Bybit
    const connectBybitWS = () => {
        const wsBybit = new WebSocket('wss://stream.bybit.com/v5/public/spot');
        let pingInterval;
        wsBybit.on('open', () => {
            webSocketActive.bybit = true;
            console.log('[WS] Bybit Connected');
            wsBybit.send(JSON.stringify({ "op": "subscribe", "args": ["orderbook.50.USDTBRL"] }));
            pingInterval = setInterval(() => {
                if (wsBybit.readyState === WebSocket.OPEN) {
                    wsBybit.send(JSON.stringify({ "req_id": new Date().getTime().toString(), "op": "ping" }));
                }
            }, 20000);
        });
        wsBybit.on('message', (data) => {
            try {
                const msg = JSON.parse(data);
                if (msg.topic === 'orderbook.50.USDTBRL' && msg.data) {
                    if (msg.type === 'snapshot') {
                        if (msg.data.a) {
                            localBooks.bybit.asks = msg.data.a;
                            localBooks.bybit.asks.sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]));
                        }
                        if (msg.data.b) {
                            localBooks.bybit.bids = msg.data.b;
                            localBooks.bybit.bids.sort((a, b) => parseFloat(b[0]) - parseFloat(a[0]));
                        }
                    } else if (msg.type === 'delta') {
                        if (msg.data.a) applyDelta('bybit', 'asks', msg.data.a, true);
                        if (msg.data.b) applyDelta('bybit', 'bids', msg.data.b, false);
                    }
                    broadcastPrice('bybit', localBooks.bybit.asks, localBooks.bybit.bids);
                }
            } catch(e){}
        });
        wsBybit.on('close', () => {
            webSocketActive.bybit = false;
            clearInterval(pingInterval);
            console.log('[WS] Bybit Disconnected, retrying...');
            setTimeout(connectBybitWS, 5000);
        });
        wsBybit.on('error', () => { webSocketActive.bybit = false; });
    };
    connectBybitWS();

    // Bitget
    const connectBitgetWS = () => {
        const wsBitget = new WebSocket('wss://ws.bitget.com/v2/ws/public');
        let pingInterval;
        wsBitget.on('open', () => {
            webSocketActive.bitget = true;
            console.log('[WS] Bitget Connected');
            wsBitget.send(JSON.stringify({ "op": "subscribe", "args": [{ "instType": "SPOT", "channel": "books", "instId": "USDTBRL" }] }));
            pingInterval = setInterval(() => {
                if (wsBitget.readyState === WebSocket.OPEN) {
                    wsBitget.send("ping");
                }
            }, 25000);
        });
        wsBitget.on('message', (data) => {
            try {
                const msgStr = data.toString();
                if (msgStr === 'pong') return;
                const msg = JSON.parse(msgStr);
                if (msg.data && msg.data[0] && msg.data[0].instId === 'USDTBRL') {
                    if (msg.action === 'snapshot') {
                        if (msg.data[0].asks) {
                            localBooks.bitget.asks = msg.data[0].asks;
                            localBooks.bitget.asks.sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]));
                        }
                        if (msg.data[0].bids) {
                            localBooks.bitget.bids = msg.data[0].bids;
                            localBooks.bitget.bids.sort((a, b) => parseFloat(b[0]) - parseFloat(a[0]));
                        }
                    } else if (msg.action === 'update') {
                        if (msg.data[0].asks) applyDelta('bitget', 'asks', msg.data[0].asks, true);
                        if (msg.data[0].bids) applyDelta('bitget', 'bids', msg.data[0].bids, false);
                    }
                    broadcastPrice('bitget', localBooks.bitget.asks, localBooks.bitget.bids);
                }
            } catch(e){}
        });
        wsBitget.on('close', () => {
            webSocketActive.bitget = false;
            clearInterval(pingInterval);
            console.log('[WS] Bitget Disconnected, retrying...');
            setTimeout(connectBitgetWS, 5000);
        });
        wsBitget.on('error', () => { webSocketActive.bitget = false; });
    };
    connectBitgetWS();

    // Kucoin
    const connectKucoinWS = async () => {
        try {
            const res = await fetch('https://api.kucoin.com/api/v1/bullet-public', { method: 'POST' });
            if (!res.ok) throw new Error("Failed to get Kucoin token");
            const data = await res.json();
            if (!data || !data.data) throw new Error("Invalid Kucoin bullet response");
            const token = data.data.token;
            const endpoint = data.data.instanceServers[0].endpoint;
            
            const wsKucoin = new WebSocket(`${endpoint}?token=${token}`);
            
            let pingInterval;
            wsKucoin.on('open', () => {
                webSocketActive.kucoin = true;
                console.log('[WS] Kucoin Connected');
                const connectId = new Date().getTime();
                wsKucoin.send(JSON.stringify({
                    "id": connectId,
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
            });
            wsKucoin.on('message', (msgData) => {
                try {
                    const msg = JSON.parse(msgData.toString());
                    if (msg.type === 'message' && msg.topic === '/spotMarket/level2Depth50:USDT-BRL' && msg.data) {
                        if (msg.data.asks || msg.data.bids) broadcastPrice('kucoin', msg.data.asks, msg.data.bids);
                    }
                } catch(e){}
            });
            wsKucoin.on('close', () => {
                webSocketActive.kucoin = false;
                clearInterval(pingInterval);
                console.log('[WS] Kucoin Disconnected, retrying...');
                setTimeout(connectKucoinWS, 5000);
            });
            wsKucoin.on('error', () => { webSocketActive.kucoin = false; });
        } catch (e) {
            console.error('[WS] Kucoin init failed, retrying in 10s:', e.message);
            webSocketActive.kucoin = false;
            setTimeout(connectKucoinWS, 10000);
        }
    };
    connectKucoinWS();
};

initBackendWebSockets();
