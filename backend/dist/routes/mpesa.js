"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const axios_1 = __importDefault(require("axios"));
const Payments_1 = __importDefault(require("@/models/Payments"));
require("dotenv/config");
const router = express_1.default.Router();
const { MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET, MPESA_SHORTCODE, MPESA_PASSKEY, TILL_NO, MPESA_TRANSACTIONTYPE, MPESA_CALLBACK_URL, MPESA_BASE_URL, } = process.env;
const formatPhoneNumber = (phone) => {
    if (phone.startsWith('+'))
        return phone.replace('+', '');
    if (phone.startsWith('0'))
        return '254' + phone.substring(1);
    return phone;
};
const getAccessToken = async () => {
    try {
        const response = await axios_1.default.get(`${MPESA_BASE_URL}/oauth/v1/generate?grant_type=client_credentials`, {
            auth: {
                username: MPESA_CONSUMER_KEY,
                password: MPESA_CONSUMER_SECRET,
            },
        });
        return response.data['access_token'];
    }
    catch (err) {
        console.error('Failed to obtain M-Pesa access token:', err?.response?.data || err.message);
        throw err;
    }
};
// POST /api/stkpush
router.post('/stkpush', async (req, res) => {
    const { phone, amount } = req.body;
    try {
        const formattedPhone = formatPhoneNumber(phone);
        const accessToken = await getAccessToken();
        const now = new Date();
        const tzOffset = now.getTimezoneOffset() * 60000;
        const localDate = new Date(now.getTime() - tzOffset);
        const timestamp = localDate.toISOString().replace(/[^0-9]/g, '').slice(0, 14);
        const password = Buffer.from(`${MPESA_SHORTCODE}${MPESA_PASSKEY}${timestamp}`).toString('base64');
        const payload = {
            BusinessShortCode: MPESA_SHORTCODE,
            Password: password,
            Timestamp: timestamp,
            TransactionType: MPESA_TRANSACTIONTYPE,
            Amount: amount,
            PartyA: formattedPhone,
            PartyB: TILL_NO,
            PhoneNumber: formattedPhone,
            CallBackURL: MPESA_CALLBACK_URL,
            AccountReference: 'Online Payment',
            TransactionDesc: 'Online Payment',
        };
        const stkResponse = await axios_1.default.post(`${MPESA_BASE_URL}/mpesa/stkpush/v1/processrequest`, payload, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
        });
        res.status(200).json(stkResponse.data);
    }
    catch (error) {
        console.error('STK Push Error:', error?.response?.data || error.message);
        res.status(500).json({
            error: 'STK Push failed',
            details: error.response?.data || error.message,
        });
    }
});
// POST /api/stkpush/callback
router.post('/stkpush/callback', async (req, res) => {
    const callback = req.body?.Body?.stkCallback;
    if (!callback) {
        res.status(400).json({ message: 'Invalid callback payload' });
        return;
    }
    const { MerchantRequestID, CheckoutRequestID, ResultCode, ResultDesc, CallbackMetadata, } = callback;
    const toStatus = () => {
        const desc = (ResultDesc || '').toLowerCase();
        if (ResultCode === 0)
            return 'success';
        if (ResultCode === 1032 || desc.includes('cancel'))
            return 'cancelled';
        if (ResultCode === 1037 || desc.includes('timeout'))
            return 'timeout';
        if (desc.includes('wrong pin') || desc.includes('pin'))
            return 'wrong_pin';
        if (desc.includes('insufficient') || desc.includes('less than'))
            return 'insufficient_funds';
        return 'failure';
    };
    if (ResultCode === 0 && CallbackMetadata?.Item) {
        const metadata = {};
        CallbackMetadata.Item.forEach((item) => {
            metadata[item.Name] = item.Value;
        });
        try {
            const transaction = new Payments_1.default({
                MerchantRequestID,
                CheckoutRequestID,
                ResultCode,
                ResultDesc,
                Amount: metadata.Amount,
                MpesaReceiptNumber: metadata.MpesaReceiptNumber,
                TransactionDate: new Date(metadata.TransactionDate.toString().replace(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/, '$1-$2-$3T$4:$5:$6Z')),
                PhoneNumber: metadata.PhoneNumber,
            });
            await transaction.save();
            const io = req.app.get('io');
            if (io && CheckoutRequestID) {
                io.to(CheckoutRequestID).emit('transaction_update', {
                    checkoutRequestId: CheckoutRequestID,
                    merchantRequestId: MerchantRequestID,
                    resultCode: ResultCode,
                    resultDesc: ResultDesc,
                    status: toStatus(),
                    amount: metadata.Amount,
                    receipt: metadata.MpesaReceiptNumber,
                    phone: metadata.PhoneNumber,
                });
            }
        }
        catch (err) {
            console.error('Error saving transaction:', err.message);
        }
    }
    else {
        const io = req.app.get('io');
        if (io && CheckoutRequestID) {
            io.to(CheckoutRequestID).emit('transaction_update', {
                checkoutRequestId: CheckoutRequestID,
                merchantRequestId: MerchantRequestID,
                resultCode: ResultCode,
                resultDesc: ResultDesc,
                status: toStatus(),
            });
        }
    }
    res.status(200).json({ message: 'Callback received successfully' });
});
// GET /api/transactions
router.get('/transactions', async (_req, res) => {
    try {
        const transactions = await Payments_1.default.find()
            .sort({ TransactionDate: -1 })
            .limit(50);
        res.json(transactions);
    }
    catch (err) {
        res.status(500).json({ error: 'Failed to fetch transactions' });
    }
});
exports.default = router;
