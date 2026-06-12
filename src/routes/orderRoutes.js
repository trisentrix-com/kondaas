import { Hono } from 'hono';
import { addOrder,rejectOrder,updateOrder,getOrders,getSurveyorOrders,getAdminRejections,getAdminCompletions,deleteOrder,completeOrder,updateSurveyStatus, } from '../controllers/orderController.js';

const orderRoutes = new Hono();

orderRoutes.post('/add', addOrder);
orderRoutes.post('/reject', rejectOrder);
orderRoutes.post('/complete', completeOrder);
orderRoutes.put('/update', updateOrder);
orderRoutes.get('/all', getOrders);
orderRoutes.get('/surveyor', getSurveyorOrders);
orderRoutes.get('/admin-rejections', getAdminRejections);
orderRoutes.get('/admin-completions', getAdminCompletions);
orderRoutes.delete('/delete', deleteOrder);
orderRoutes.put('/updatestatus', updateSurveyStatus);

export default orderRoutes;