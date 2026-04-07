import { Hono } from 'hono';
import { addNotification,updateNotification } from '../controllers/notificationController.js';

const notificationRoutes = new Hono();

notificationRoutes.post('/add', addNotification);
notificationRoutes.put('/update',updateNotification);

export default notificationRoutes;