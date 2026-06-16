import { Hono } from 'hono';
import { addOrder,rejectOrder,updateOrder,getOrders,getAdminRejections,getAdminCompletions,deleteOrder,completeOrder,updateSurveyStatus,updateLocalDealSurveyStatus,handleZohoDealWebhook,assignDealToSurveyor,getSurveyorDeals } from '../controllers/orderController.js';

const orderRoutes = new Hono();

orderRoutes.post('/add', addOrder);
orderRoutes.post('/reject', rejectOrder);
orderRoutes.post('/complete', completeOrder);
orderRoutes.put('/update', updateOrder);
orderRoutes.get('/all', getOrders);
orderRoutes.get('/admin-rejections', getAdminRejections);
orderRoutes.get('/admin-completions', getAdminCompletions);
orderRoutes.delete('/delete', deleteOrder);
orderRoutes.put('/updatestatus', updateSurveyStatus);
orderRoutes.put('/updatelocaldealsurveystatus', updateLocalDealSurveyStatus);
orderRoutes.post('/webhook', handleZohoDealWebhook);
orderRoutes.post('/assign', assignDealToSurveyor);
orderRoutes.get('/surveyor', getSurveyorDeals);


export default orderRoutes;