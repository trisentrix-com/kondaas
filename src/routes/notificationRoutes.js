import { Hono } from 'hono';
import { addNotification,triggerScenarioNotification,updateNotification,handleSurveyorPhotoUpload,saveWhatsAppRating } from '../controllers/notificationController.js';

const notificationRoutes = new Hono();

notificationRoutes.post('/add', addNotification);
notificationRoutes.post('/trigger', triggerScenarioNotification);
notificationRoutes.put('/update', updateNotification);
notificationRoutes.post('/daily-photo', handleSurveyorPhotoUpload);
notificationRoutes.post('/feedback', saveWhatsAppRating);


export default notificationRoutes;