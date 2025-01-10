require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cron = require('node-cron');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// MongoDB Schema
const cryptoPriceSchema = new mongoose.Schema({
  coinId: {
    type: String,
    required: true,
    enum: ['bitcoin', 'matic-network', 'ethereum']
  },
  priceUSD: {
    type: Number,
    required: true
  },
  marketCapUSD: {
    type: Number,
    required: true
  },
  change24h: {
    type: Number,
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
});

cryptoPriceSchema.index({ coinId: 1, timestamp: -1 });
const CryptoPrice = mongoose.model('CryptoPrice', cryptoPriceSchema);

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

// CoinGecko Service
const coinGeckoService = {
  baseURL: 'https://api.coingecko.com/api/v3',

  async getCoinData(coinId) {
    try {
      const response = await axios.get(
        `${this.baseURL}/simple/price`,
        {
          params: {
            ids: coinId,
            vs_currencies: 'usd',
            include_market_cap: true,
            include_24hr_change: true
          }
        }
      );

      const data = response.data[coinId];
      return {
        priceUSD: data.usd,
        marketCapUSD: data.usd_market_cap,
        change24h: data.usd_24h_change
      };
    } catch (error) {
      console.error(`Error fetching data for ${coinId}:`, error);
      throw error;
    }
  }
};

// Background Job
const SUPPORTED_COINS = ['bitcoin', 'matic-network', 'ethereum'];

async function updateCryptoData() {
  try {
    for (const coinId of SUPPORTED_COINS) {
      const data = await coinGeckoService.getCoinData(coinId);
      
      await CryptoPrice.create({
        coinId,
        priceUSD: data.priceUSD,
        marketCapUSD: data.marketCapUSD,
        change24h: data.change24h
      });

      console.log(`Updated data for ${coinId}`);
    }
  } catch (error) {
    console.error('Error in updateCryptoData job:', error);
  }
}

// Schedule job to run every 2 hours
cron.schedule('0 */2 * * *', updateCryptoData);

// Run job immediately on startup
updateCryptoData();

// API Routes
app.get('/stats', async (req, res) => {
  try {
    const { coin } = req.query;

    if (!coin) {
      return res.status(400).json({ error: 'Coin parameter is required' });
    }

    const latestData = await CryptoPrice.findOne(
      { coinId: coin },
      { priceUSD: 1, marketCapUSD: 1, change24h: 1 },
      { sort: { timestamp: -1 } }
    );

    if (!latestData) {
      return res.status(404).json({ error: 'Data not found for the specified coin' });
    }

    res.json({
      price: latestData.priceUSD,
      marketCap: latestData.marketCapUSD,
      "24hChange": latestData.change24h
    });
  } catch (error) {
    console.error('Error in getStats:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/deviation', async (req, res) => {
  try {
    const { coin } = req.query;

    if (!coin) {
      return res.status(400).json({ error: 'Coin parameter is required' });
    }

    const prices = await CryptoPrice.find(
      { coinId: coin },
      { priceUSD: 1 },
      { sort: { timestamp: -1 }, limit: 100 }
    );

    if (!prices.length) {
      return res.status(404).json({ error: 'No data found for the specified coin' });
    }

    const priceValues = prices.map(p => p.priceUSD);
    const mean = priceValues.reduce((a, b) => a + b) / priceValues.length;
    const squareDiffs = priceValues.map(price => Math.pow(price - mean, 2));
    const avgSquareDiff = squareDiffs.reduce((a, b) => a + b) / squareDiffs.length;
    const stdDev = Math.sqrt(avgSquareDiff);

    res.json({
      deviation: Number(stdDev.toFixed(2))
    });
  } catch (error) {
    console.error('Error in getDeviation:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
