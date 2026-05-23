const { verifyAuth } = require('./util.js');

const CONTRACTS = {
    usdt: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
    brla: "0xe6a537a407488807f0bbeb0038b79004f19dddfb"
};

module.exports = async (req, res) => {
    const user = await verifyAuth(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    try {
        const url = `https://coins.llama.fi/prices/current/polygon:${CONTRACTS.usdt},polygon:${CONTRACTS.brla}`;
        const response = await fetch(url);
        const data = await response.json();
        res.status(200).json(data);
    } catch (err) {
        res.status(500).json({ error: 'Erro ao analisar resposta da API.' });
    }
};
