import { Hono } from 'hono';

import { addLocation, getLocationByTime, getCurrentLocation,getLogisticProducts } from '../controllers/installerController.js';

const installerRoutes = new Hono();

installerRoutes.post('/add', addLocation);
installerRoutes.post('/bytime', getLocationByTime);
installerRoutes.post('/current', getCurrentLocation);
installerRoutes.get('/get-products', getLogisticProducts);
export default installerRoutes;