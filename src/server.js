import express from 'express';
import { webhookRouter } from './webhook.js';
import { botsRouter } from './bots.js';
import 'dotenv/config';

const app = express();
app.use(express.json());

app.use('/api', webhookRouter);
app.use('/api', botsRouter);

app.get('/api/health', (req, res) => res.json({ ok: true }));

const port = process.env.PORT || 3001;
app.listen(port, () => console.log(`Flowgram API listening on :${port}`));
