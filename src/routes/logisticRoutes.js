import { Hono } from 'hono';

import { addLocation, getLocationByTime, getCurrentLocation,createLogisticsProduct } from '../controllers/logisticController.js';

const logisticRoutes = new Hono();

logisticRoutes.post('/add', addLocation);
logisticRoutes.post('/bytime', getLocationByTime);
logisticRoutes.post('/current', getCurrentLocation);
logisticRoutes.post('/products', createLogisticsProduct);

export default logisticRoutes;