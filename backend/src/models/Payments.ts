import mongoose, { Document, Schema } from 'mongoose';

export interface IMpesaPayment extends Document {
  MerchantRequestID: string;
  CheckoutRequestID: string;
  ResultCode: number;
  ResultDesc: string;
  Amount: number;
  MpesaReceiptNumber: string;
  TransactionDate: Date;
  PhoneNumber: string;
}

const MpesaPaymentSchema = new Schema<IMpesaPayment>(
  {
    MerchantRequestID: String,
    CheckoutRequestID: String,
    ResultCode: Number,
    ResultDesc: String,
    Amount: Number,
    MpesaReceiptNumber: String,
    TransactionDate: Date,
    PhoneNumber: String,
  },
  { timestamps: true }
);

export default mongoose.model<IMpesaPayment>('MpesaPayment', MpesaPaymentSchema);
