import { Hono } from 'hono';
import { cors } from 'hono/cors';
import locationRoutes from './src/routes/locationRoutes.js';
import userRoutes from './src/routes/userRoutes.js';

const app = new Hono();

app.use('*', cors());

app.route('/location', locationRoutes);
app.route('/user', userRoutes);

export default app; 