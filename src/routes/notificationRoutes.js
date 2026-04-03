import { Hono } from 'hono';
import { addNotification } from '../controllers/notificationController.js';

const notificationRoutes = new Hono();

notificationRoutes.post('/add', addNotification);

export default notificationRoutes;