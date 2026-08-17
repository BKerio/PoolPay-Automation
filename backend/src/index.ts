import 'dotenv/config';
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import http from 'http';
import { Server } from 'socket.io';
import mpesaRoutes from '@/routes/mpesa';

// Fail fast if the server is misconfigured instead of surfacing cryptic
// axios/mongoose errors later once a payment is already in flight.
const REQUIRED_ENV_VARS = [
  'MONGO_URI',
  'MPESA_CONSUMER_KEY',
  'MPESA_CONSUMER_SECRET',
  'MPESA_PASSKEY',
  'MPESA_SHORTCODE',
  'MPESA_CALLBACK_URL',
  'MPESA_BASE_URL',
];

const missingEnvVars = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);
if (missingEnvVars.length > 0) {
  console.error(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
  console.error('Copy backend/.env.example to backend/.env and fill in the values.');
  process.exit(1);
}

const app = express();

// HTTP server and Socket.IO setup
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_ORIGIN || '*',
    methods: ['GET', 'POST'],
  },
});

// Expose io to routes
app.set('io', io);

io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);

  socket.on('join_checkout', ({ checkoutRequestId }: { checkoutRequestId: string }) => {
    if (checkoutRequestId) {
      socket.join(checkoutRequestId);
      console.log(`Socket ${socket.id} joined room ${checkoutRequestId}`);
    }
  });

  socket.on('disconnect', (reason: string) => {
    console.log('Socket disconnected:', socket.id, reason);
  });
});

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '100kb' }));

// Throttle the payment-initiating endpoint to blunt STK Push abuse/spam.
const stkPushLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many payment requests, please try again shortly.' },
});
app.use('/api/stkpush', stkPushLimiter);

// Routes
app.get('/', (req, res) => {
  res.send('M-Pesa Backend is running!');
});
app.use('/api', mpesaRoutes);

// Centralized error handler (catches sync throws / next(err) from routes)
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// MongoDB connection
mongoose
  .connect(process.env.MONGO_URI!)
  .then(() => {
    console.log('MongoDB connected.');
  })
  .catch((err: Error) => {
    console.error('MongoDB connection error:', err);
  });

// Server listen
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log('=========================================');
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Callback URL: ${process.env.MPESA_CALLBACK_URL}`);
  console.log('=========================================');
});
