import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import ordersRouter from './routes/orders.js';
import notificationsRouter from './routes/notifications.js';
import authRouter from './routes/auth.js';
import menuRouter from './routes/menu.js';
import { getOrderStore } from './storage/index.js';

export const createApp = () => {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => {
    res.json({
      success: true,
      storageDriver: getOrderStore().name,
      orderStore: config.fileStore.rootPath,
    });
  });

  app.use('/', ordersRouter);
  app.use('/', menuRouter);
  app.use('/auth', authRouter);
  app.use('/notifications', notificationsRouter);

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Internal server error.',
    });
  });

  return app;
};
