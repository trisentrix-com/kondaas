import { Hono } from 'hono';

import { addLocation, getLocationByTime, getCurrentLocation,getInstallerDealsByMobile,notifyInstallerETA } from '../controllers/installerController.js';

const installerRoutes = new Hono();

installerRoutes.post('/add', addLocation);
installerRoutes.post('/bytime', getLocationByTime);
installerRoutes.post('/current', getCurrentLocation);

installerRoutes.get('/deals', getInstallerDealsByMobile);

installerRoutes.post('/delivery', notifyInstallerETA);

export default installerRoutes;