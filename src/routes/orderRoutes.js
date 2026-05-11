import { Hono } from 'hono';
import { addOrder,  syncToFlowtrix,updateOrder,updateOrderStatus,getOrders } from '../controllers/orderController.js';

const orderRoutes = new Hono();

orderRoutes.post('/add', addOrder);
orderRoutes.post('/sync-status', syncToFlowtrix);
orderRoutes.put('/update', updateOrder);
orderRoutes.put('/updatestatus', updateOrderStatus);
orderRoutes.get('/all', getOrders);

export default orderRoutes;