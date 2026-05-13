import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';

import locationRoutes from './src/routes/locationRoutes.js';
import userRoutes from './src/routes/userRoutes.js';
import orderRoutes from './src/routes/orderRoutes.js';
import templateRoutes from './src/routes/templateRoutes.js';
import notificationRoutes from './src/routes/notificationRoutes.js';
import solarmanRoutes from './src/routes/solarmanRoutes.js';
import savingsRoutes from './src/routes/savingsRoutes.js';

const app = new Hono();

app.use('*', cors());

// Routes
app.route('/location', locationRoutes);
app.route('/user', userRoutes);
app.route('/order', orderRoutes);
app.route('/template', templateRoutes);
app.route('/notification', notificationRoutes);
app.route('/solarman', solarmanRoutes);
app.route('/savings', savingsRoutes);


const port = 8080;

serve({
  fetch: app.fetch,
  port,
  hostname: '0.0.0.0'
}, (info) => {
  console.log(`🚀 Kondaaas Backend Live: http://localhost:${info.port}`);
});