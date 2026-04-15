import { Hono } from 'hono';
import { getSolarmanToken,getSolarmanStations,getSolarmanDevices,getSolarmanRealTimeData } from '../controllers/solarmanController.js';

const solarmanRoutes = new Hono();

solarmanRoutes.post('/token', getSolarmanToken);
solarmanRoutes.post('/stations', getSolarmanStations);
solarmanRoutes.post('/devices', getSolarmanDevices);
solarmanRoutes.post('/realtime', getSolarmanRealTimeData);

export default solarmanRoutes;  