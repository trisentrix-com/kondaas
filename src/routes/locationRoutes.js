import { Hono } from 'hono';

import { addLocation, getLocationByTime, getCurrentLocation } from '../controllers/locationController.js';

const locationRoutes = new Hono();

locationRoutes.post('/add', addLocation);
locationRoutes.post('/bytime', getLocationByTime);
locationRoutes.post('/current', getCurrentLocation);
export default locationRoutes;