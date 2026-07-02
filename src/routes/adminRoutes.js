import { Hono } from 'hono';

import { getDealInfo,assignLogisticsMember,getLogRejections,getLogCompletions,assignInstallerMember,getInstallerRejections,getInstallerCompletions,whitelistUser } from '../controllers/adminController.js';

const adminRoutes = new Hono();

adminRoutes.get('/products', getDealInfo);
adminRoutes.post('/assign-role', whitelistUser);

adminRoutes.post('/assign-logistic', assignLogisticsMember);
adminRoutes.get('/logistics-rejections', getLogRejections);
adminRoutes.get('/logistics-completions', getLogCompletions);

adminRoutes.post('/assign-installer', assignInstallerMember);
adminRoutes.get('/installer-rejections', getInstallerRejections);
adminRoutes.get('/installer-completions', getInstallerCompletions);

export default adminRoutes;
