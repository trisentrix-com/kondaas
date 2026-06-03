import { Hono } from 'hono';
import { addOrder,rejectOrder,updateOrder,getOrders,getAdminRejections,deleteOrder } from '../controllers/orderController.js';

const orderRoutes = new Hono();

orderRoutes.post('/add', addOrder);
orderRoutes.post('/reject', rejectOrder);
orderRoutes.put('/update', updateOrder);
orderRoutes.get('/all', getOrders);
orderRoutes.get('/admin-rejections', getAdminRejections);
orderRoutes.delete('/delete', deleteOrder);


export default orderRoutes;