const { verifyAuth } = require('../util.js');

module.exports = async (req, res) => {
    const user = await verifyAuth(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    try {
        const response = await fetch('https://api.bybit.com/v5/market/orderbook?category=spot&symbol=USDTBRL&limit=20');
        const data = await response.json();
        res.status(200).json(data);
    } catch (err) {
        res.status(500).json({ error: 'Erro no proxy da Bybit.' });
    }
};
