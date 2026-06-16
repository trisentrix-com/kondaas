import { Hono } from 'hono';
import { addNotification,triggerScenarioNotification,updateNotification,handleSurveyorPhotoUpload } from '../controllers/notificationController.js';

const notificationRoutes = new Hono();

notificationRoutes.post('/add', addNotification);
notificationRoutes.post('/trigger', triggerScenarioNotification);
notificationRoutes.put('/update', updateNotification);
notificationRoutes.post('/upload-photo', handleSurveyorPhotoUpload);

export default notificationRoutes;