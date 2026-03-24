import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';
import dotenv from 'dotenv';
import locationRoutes from './src/routes/locationRoutes.js';

dotenv.config();

const app = new Hono();

app.use('*', cors());

app.route('/location', locationRoutes);

const port = 3000;
serve({ fetch: app.fetch, port });
console.log(`Kondaas server running on port ${port}`);