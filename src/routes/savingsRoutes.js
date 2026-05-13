import { Hono } from 'hono';
import { calculateUserSavings } from '../controllers/savingsController.js';

const savingsRouter = new Hono();

savingsRouter.post('/calculate-savings', calculateUserSavings);

export default savingsRouter;