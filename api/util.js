const https = require('https');

const SUPABASE_HOSTNAME = 'vaahwukpupiiimnuagfa.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_5NbtFzk47B5qmGqNJbIL5A_PlTmSwjC';

exports.verifyAuth = (req) => {
    return new Promise((resolve, reject) => {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return resolve(null);
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
                    return resolve(null);
                }
                resolve(JSON.parse(data));
            });
        });

        supaReq.on('error', () => resolve(null));
        supaReq.end();
    });
};
