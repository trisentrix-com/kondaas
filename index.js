import { Hono } from 'hono';
import { cors } from 'hono/cors';

import locationRoutes from './src/routes/locationRoutes.js';
import userRoutes from './src/routes/userRoutes.js';
import orderRoutes from './src/routes/orderRoutes.js';
import templateRoutes from './src/routes/templateRoutes.js';
import notificationRoutes from './src/routes/notificationRoutes.js';
import solarmanRoutes from './src/routes/solarmanRoutes.js';

const app = new Hono();

app.use('*', cors());

app.route('/location', locationRoutes);
app.route('/user', userRoutes);
app.route('/order', orderRoutes);
app.route('/template', templateRoutes);
app.route('/notification', notificationRoutes);
app.route('/solarman', solarmanRoutes);

/**
 * 🐋 DOCKER / NODE RUNNER (The "Ghost" Import)
 */
if (typeof process !== 'undefined' && process.release?.name === 'node') {
  // We use a variable for the package name so Cloudflare's bundler ignores it
  const nodeServerPkg = '@hono/node-server'; 
  
  import(nodeServerPkg).then(({ serve }) => {
    const port = 3000;
    serve({ fetch: app.fetch, port });
    console.log(`🚀 Docker Mode: http://localhost:${port}`);
  }).catch(() => {
    // Cloudflare will hit this catch block during build and stay silent
  });
}

/**
 * ⛅ CLOUDFLARE EXPORT
 */
export default app;