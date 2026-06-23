import { Hono } from 'hono';
import { addForm, updateForm } from '../controllers/userController.js';

const userRoutes = new Hono();

userRoutes.post('/add', addForm);
userRoutes.put('/update', updateForm);


export default userRoutes;
