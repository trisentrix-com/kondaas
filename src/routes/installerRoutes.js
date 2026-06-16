import { Hono } from 'hono';

import { addLocation, getLocationByTime, getCurrentLocation,createInstallerProduct } from '../controllers/installerController.js';

const installerRoutes = new Hono();

installerRoutes.post('/add', addLocation);
installerRoutes.post('/bytime', getLocationByTime);
installerRoutes.post('/current', getCurrentLocation);
installerRoutes.post('/products', createInstallerProduct);

export default installerRoutes;