import { Hono } from 'hono';

import { getDealInfo } from '../controllers/adminController.js';

const adminRoutes = new Hono();

adminRoutes.get('/products', getDealInfo);


export default adminRoutes;
