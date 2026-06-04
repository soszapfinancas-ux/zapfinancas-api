require('dotenv').config();
const express   = require('express');
const helmet    = require('helmet');
const cors      = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());
app.use(express.static('painel'));   // serve o painel web estático

const limiter = rateLimit({ windowMs: 60000, max: 120, standardHeaders: true, legacyHeaders: false });
app.use('/api', limiter);

// Autenticação do painel (não usa apikey)
app.use('/api/auth', require('./routes/auth'));

// API (requer apikey ou sess_ token)
app.use('/api/transactions',    require('./routes/transactions'));
app.use('/api/categories',      require('./routes/categories'));
app.use('/api/wallet',          require('./routes/wallet'));
app.use('/api/payment-methods', require('./routes/paymentMethods'));
app.use('/api/dashboard',       require('./routes/dashboard'));
app.use('/api/charts',          require('./routes/charts'));
app.use('/api/reminders',       require('./routes/reminders'));
app.use('/api/reports',         require('./routes/reports'));

// Webhook Hotmart
app.use('/webhook/hotmart', require('./routes/hotmart'));

// Admin
app.use('/admin', require('./routes/admin'));

// Health check
app.get('/health', (_, res) => res.json({ status: 'ok', version: '2.0', ts: new Date().toISOString() }));

// Job de lembretes (aviso antecipado + vencimento)
require('./jobs/reminders').iniciarJob();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`ZapFinanças API v2 rodando na porta ${PORT}`));
