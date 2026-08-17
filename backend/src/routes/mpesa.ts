import express, { Request, Response } from 'express';
import axios from 'axios';
import MpesaPayment from '@/models/Payments';
import 'dotenv/config';

const router = express.Router();

const {
  MPESA_CONSUMER_KEY,
  MPESA_CONSUMER_SECRET,
  MPESA_SHORTCODE,
  MPESA_PASSKEY,
  TILL_NO,
  MPESA_TRANSACTIONTYPE,
  MPESA_CALLBACK_URL,
  MPESA_BASE_URL,
} = process.env;

// =====================================
// HELPERS
// =====================================

/**
 * Normalizes a Kenyan phone number to the 2547XXXXXXXX / 2541XXXXXXXX
 * format required by Daraja, accepting local (07..., 01...), international
 * (+2547..., +2541...) and bare 9-digit (7..., 1...) inputs.
 */
const formatPhoneNumber = (rawPhone: string): string => {
  const phone = (rawPhone || '').replace(/[\s-]/g, '');
  if (phone.startsWith('+254')) return phone.slice(1);
  if (phone.startsWith('254')) return phone;
  if (phone.startsWith('0')) return '254' + phone.slice(1);
  if (/^[71]\d{8}$/.test(phone)) return '254' + phone;
  return phone;
};

const isValidMpesaPhone = (phone: string): boolean => /^254[71]\d{8}$/.test(phone);

/** Daraja allows amounts of 1 - 150,000 KES per STK Push transaction. */
const isValidAmount = (amount: number): boolean =>
  Number.isFinite(amount) && amount >= 1 && amount <= 150000;

/** Single source of truth for translating a Daraja result into an app-level status. */
const mapResultToStatus = (resultCode: number, resultDesc?: string): string => {
  const desc = (resultDesc || '').toLowerCase();
  if (resultCode === 0) return 'success';
  if (resultCode === 1032 || desc.includes('cancel')) return 'cancelled';
  if (resultCode === 1037 || desc.includes('timeout')) return 'timeout';
  if (desc.includes('wrong pin') || desc.includes('pin')) return 'wrong_pin';
  if (desc.includes('insufficient') || desc.includes('less than')) return 'insufficient_funds';
  return 'failure';
};

const getAccessToken = async (): Promise<string> => {
  try {
    const response = await axios.get(
      `${MPESA_BASE_URL}/oauth/v1/generate?grant_type=client_credentials`,
      {
        auth: {
          username: MPESA_CONSUMER_KEY!,
          password: MPESA_CONSUMER_SECRET!,
        },
      }
    );
    return response.data['access_token'] as string;
  } catch (err: any) {
    console.error('Failed to obtain M-Pesa access token:', err?.response?.data || err.message);
    throw err;
  }
};

// POST /api/stkpush
router.post('/stkpush', async (req: Request, res: Response) => {
  const { phone, amount } = req.body as { phone?: string; amount?: number | string };

  if (!phone || typeof phone !== 'string') {
    res.status(400).json({ error: 'A phone number is required' });
    return;
  }

  const formattedPhone = formatPhoneNumber(phone);
  if (!isValidMpesaPhone(formattedPhone)) {
    res.status(400).json({ error: 'Invalid phone number. Use format 07XXXXXXXX or 01XXXXXXXX' });
    return;
  }

  const numericAmount = Number(amount);
  if (!isValidAmount(numericAmount)) {
    res.status(400).json({ error: 'Amount must be a number between 1 and 150,000' });
    return;
  }

  console.log('--- STK Push Initiated ---');
  console.log('Phone:', formattedPhone, 'Amount:', numericAmount);
  console.log('Callback URL:', MPESA_CALLBACK_URL);

  try {
    const accessToken = await getAccessToken();

    const now = new Date();
    const tzOffset = now.getTimezoneOffset() * 60000;
    const localDate = new Date(now.getTime() - tzOffset);
    const timestamp = localDate.toISOString().replace(/[^0-9]/g, '').slice(0, 14);

    const password = Buffer.from(
      `${MPESA_SHORTCODE}${MPESA_PASSKEY}${timestamp}`
    ).toString('base64');

    const payload = {
      BusinessShortCode: MPESA_SHORTCODE,
      Password: password,
      Timestamp: timestamp,
      TransactionType: MPESA_TRANSACTIONTYPE,
      Amount: numericAmount,
      PartyA: formattedPhone,
      PartyB: TILL_NO,
      PhoneNumber: formattedPhone,
      CallBackURL: MPESA_CALLBACK_URL,
      AccountReference: 'Online Payment',
      TransactionDesc: 'Online Payment',
    };

    const stkResponse = await axios.post(
      `${MPESA_BASE_URL}/mpesa/stkpush/v1/processrequest`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    res.status(200).json(stkResponse.data);
  } catch (error: any) {
    console.error('STK Push Error:', error?.response?.data || error.message);
    res.status(500).json({
      error: 'STK Push failed',
      details: error.response?.data || error.message,
    });
  }
});

// POST /api/stkpush/callback
router.post('/stkpush/callback', async (req: Request, res: Response) => {
  // Daraja retries callbacks it doesn't get a 200 for, so always ack fast
  // and log failures instead of leaving the request hanging.
  if (process.env.NODE_ENV !== 'production') {
    console.log('>>> Incoming M-Pesa Callback:', JSON.stringify(req.body, null, 2));
  }
  const callback = req.body?.Body?.stkCallback;

  if (!callback) {
    res.status(400).json({ message: 'Invalid callback payload' });
    return;
  }

  const {
    MerchantRequestID,
    CheckoutRequestID,
    ResultCode,
    ResultDesc,
    CallbackMetadata,
  } = callback as {
    MerchantRequestID: string;
    CheckoutRequestID: string;
    ResultCode: number;
    ResultDesc: string;
    CallbackMetadata?: { Item: { Name: string; Value: any }[] };
  };

  const statusStr = mapResultToStatus(ResultCode, ResultDesc);

  let amount = 0;
  let receipt = 'N/A';
  let phone = 'N/A';

  if (ResultCode === 0 && CallbackMetadata?.Item) {
    const metadata: Record<string, any> = {};
    CallbackMetadata.Item.forEach((item) => {
      metadata[item.Name] = item.Value;
    });
    amount = metadata.Amount || 0;
    receipt = metadata.MpesaReceiptNumber || 'N/A';
    phone = metadata.PhoneNumber || 'N/A';
  }

  try {
    // Save to DB regardless of success or failure so /status and /transactions
    // always have a record to report back to the ESP32 / web client.
    const transaction = new MpesaPayment({
      MerchantRequestID,
      CheckoutRequestID,
      ResultCode,
      ResultDesc,
      Amount: amount,
      MpesaReceiptNumber: receipt,
      TransactionDate: new Date(),
      PhoneNumber: phone,
    });

    await transaction.save();

    const io = req.app.get('io');
    if (io && CheckoutRequestID) {
      io.to(CheckoutRequestID).emit('transaction_update', {
        checkoutRequestId: CheckoutRequestID,
        merchantRequestId: MerchantRequestID,
        resultCode: ResultCode,
        resultDesc: ResultDesc,
        status: statusStr,
        amount,
        receipt,
        phone,
      });
    }
  } catch (err: any) {
    console.error('Error saving transaction to DB:', err.message);
    console.error('Stack:', err.stack);
  }

  res.status(200).json({ message: 'Callback received successfully' });
});

// GET /api/stkpush/status/:checkoutRequestId
router.get('/stkpush/status/:checkoutRequestId', async (req: Request, res: Response) => {
  try {
    const { checkoutRequestId } = req.params;
    const transaction = await MpesaPayment.findOne({ CheckoutRequestID: checkoutRequestId });

    if (transaction) {
      res.json({
        status: mapResultToStatus(transaction.ResultCode, transaction.ResultDesc),
        resultCode: transaction.ResultCode,
        resultDesc: transaction.ResultDesc,
      });
    } else {
      res.status(404).json({ status: 'pending' }); // Not yet received
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch status' });
  }
});

// GET /api/transactions
router.get('/transactions', async (_req: Request, res: Response) => {
  try {
    const transactions = await MpesaPayment.find()
      .sort({ TransactionDate: -1 })
      .limit(50);

    res.json(transactions);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

export default router;
