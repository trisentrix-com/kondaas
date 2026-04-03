import { Hono } from 'hono';
import { cors } from 'hono/cors';
import locationRoutes from './src/routes/locationRoutes.js';
import userRoutes from './src/routes/userRoutes.js';
import orderRoutes from './src/routes/orderRoutes.js';
import templateRoutes from './src/routes/templateRoutes.js';
import notificationRoutes from './src/routes/notificationRoutes.js';



const app = new Hono();

app.use('*', cors());

app.route('/location', locationRoutes);
app.route('/user', userRoutes);
app.route('/order',orderRoutes);
app.route('/template', templateRoutes);
app.route('/notification', notificationRoutes);
export default app; 