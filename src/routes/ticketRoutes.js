import { Hono } from 'hono';
import { createTicket,getTicketsByUser} from '../controllers/ticketController.js';

const ticketRoutes = new Hono();

// Route dedicated to processing frontend ticket submissions
ticketRoutes.post('/create', createTicket);
ticketRoutes.get('/user', getTicketsByUser);

export default ticketRoutes;