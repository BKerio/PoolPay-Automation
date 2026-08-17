"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const mongoose_1 = __importDefault(require("mongoose"));
const cors_1 = __importDefault(require("cors"));
const http_1 = __importDefault(require("http"));
const socket_io_1 = require("socket.io");
const mpesa_1 = __importDefault(require("@/routes/mpesa"));
const app = (0, express_1.default)();
// HTTP server and Socket.IO setup
const server = http_1.default.createServer(app);
const io = new socket_io_1.Server(server, {
    cors: {
        origin: process.env.CLIENT_ORIGIN || '*',
        methods: ['GET', 'POST'],
    },
});
// Expose io to routes
app.set('io', io);
io.on('connection', (socket) => {
    console.log('Socket connected:', socket.id);
    socket.on('join_checkout', ({ checkoutRequestId }) => {
        if (checkoutRequestId) {
            socket.join(checkoutRequestId);
            console.log(`Socket ${socket.id} joined room ${checkoutRequestId}`);
        }
    });
    socket.on('disconnect', (reason) => {
        console.log('Socket disconnected:', socket.id, reason);
    });
});
// Middleware
app.use((0, cors_1.default)());
app.use(express_1.default.json());
// Routes
app.use('/api', mpesa_1.default);
// MongoDB connection
mongoose_1.default
    .connect(process.env.MONGO_URI)
    .then(() => {
    console.log('MongoDB connected.');
})
    .catch((err) => {
    console.error('MongoDB connection error:', err);
});
// Server listen
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
