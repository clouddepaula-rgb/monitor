const https = require('https');
const { verifyAuth } = require('../util.js');

const SUPABASE_HOSTNAME = 'vaahwukpupiiimnuagfa.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const verifyAdmin = (user) => {
    return new Promise((resolve, reject) => {
        if (!user || !user.id) return resolve(false);

        const profileOptions = {
            hostname: SUPABASE_HOSTNAME,
            path: `/rest/v1/profiles?id=eq.${user.id}&select=is_admin`,
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
                        return resolve(true);
                    }
                }
                resolve(false);
            });
        });
        profileReq.on('error', () => resolve(false));
        profileReq.end();
    });
};

module.exports = async (req, res) => {
    const user = await verifyAuth(req);
    if (!user) return res.status(401).json({ error: 'Acesso negado: Token não fornecido ou inválido.' });

    const isAdmin = await verifyAdmin(user);
    if (!isAdmin) return res.status(403).json({ error: 'Acesso negado: Requer privilégios de Administrador.' });

    if (!SUPABASE_SERVICE_ROLE_KEY) {
        return res.status(500).json({ error: 'Chave mestre não configurada.' });
    }

    if (req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            const { email, password } = JSON.parse(body);
            if (!email || !password) return res.status(400).json({ error: 'Email e senha são obrigatórios.' });

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
                supaRes.on('end', () => res.status(supaRes.statusCode).send(data));
            });
            supaReq.write(postData);
            supaReq.end();
        });
    } else if (req.method === 'DELETE') {
        const uid = req.query.uid;
        if (!uid) return res.status(400).json({ error: 'UID não fornecido.' });
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
            supaRes.on('end', () => res.status(supaRes.statusCode).send(data));
        });
        supaReq.end();
    } else {
        res.status(405).json({ error: 'Método não permitido.' });
    }
};
