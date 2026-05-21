import { Hono } from 'hono';
import { createReferral, getReferralsByReferer } from '../controllers/referralController.js';

const referralRoutes = new Hono();

// Referral Management Endpoints
referralRoutes.post('/create', createReferral);
referralRoutes.get('/get', getReferralsByReferer);

export default referralRoutes;