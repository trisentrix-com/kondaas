import { Hono } from 'hono';
import { getSolarmanToken,getSolarmanStations,getSolarmanDevices,getSolarmanRealTimeData,saveUserDetails,getUser,getSolarmanHistory } from '../controllers/solarmanController.js';

const solarmanRoutes = new Hono();

solarmanRoutes.post('/token', getSolarmanToken);
solarmanRoutes.post('/stations', getSolarmanStations);
solarmanRoutes.post('/devices', getSolarmanDevices);
solarmanRoutes.post('/realtime', getSolarmanRealTimeData);
solarmanRoutes.post('/user', saveUserDetails);
solarmanRoutes.post('/get', getUser);
solarmanRoutes.post('/history', getSolarmanHistory);
export default solarmanRoutes;   