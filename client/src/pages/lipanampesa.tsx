import { useState, useRef, useEffect, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import Swal from 'sweetalert2';
import withReactContent from 'sweetalert2-react-content';
import { Loader2, Smartphone, EuroIcon, ArrowLeft } from 'lucide-react';
import { io, Socket } from 'socket.io-client';

const PayWithMpesa = () => {
  const navigate = useNavigate();
  const [phone, setPhone] = useState('');
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [validationErrors, setValidationErrors] = useState<{ phone?: string; amount?: string }>({});
  const [paymentStatus, setPaymentStatus] = useState<'idle' | 'success'>('idle');
  const [lastReceipt, setLastReceipt] = useState<any>(null);

  const API_URL = import.meta.env.VITE_API_URL;
  const SOCKET_URL = (import.meta.env.VITE_SOCKET_URL || '').toString();
  const socketRef = useRef<Socket | null>(null);
  const pendingTimerRef = useRef<number | null>(null);
  const hardTimeoutRef = useRef<number | null>(null);
  const [showBubbles, setShowBubbles] = useState(false);
  const MySwal = withReactContent(Swal);

  const validateInputs = (): boolean => {
    const errors: { phone?: string; amount?: string } = {};

    if (!/^(01|07)\d{8}$/.test(phone)) {
      errors.phone = 'Enter valid 10-digit phone number (e.g. 0712345678)';
    }

    const numericAmount = Number(amount);
    if (isNaN(numericAmount) || numericAmount <= 0) {
      errors.amount = 'Enter a valid amount greater than 0';
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const connectSocket = () => {
    if (socketRef.current && socketRef.current.connected) return socketRef.current;
    // Derive socket URL: prefer VITE_SOCKET_URL, else strip trailing /api from API_URL
    const derivedUrl = SOCKET_URL || (API_URL ? API_URL.replace(/\/?api\/?$/, '') : '');
    socketRef.current = io(derivedUrl, { transports: ['websocket'] });
    return socketRef.current;
  };

  const clearTimers = () => {
    if (pendingTimerRef.current) {
      window.clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = null;
    }
    if (hardTimeoutRef.current) {
      window.clearTimeout(hardTimeoutRef.current);
      hardTimeoutRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      clearTimers();
      setShowBubbles(false);
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, []);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setValidationErrors({});
    if (!validateInputs()) return;

    setShowBubbles(false);
    setLoading(true);

    try {
      const formattedPhone = '254' + phone.slice(-9);
      const numericAmount = Number(amount);

      MySwal.fire({
        title: 'Processing Payment...',
        text: 'Please wait while we initiate the STK push.',
        icon: 'info',
        allowOutsideClick: false,
        didOpen: () => {
          // Add bouncing bubbles to the modal
          const modalContent = document.querySelector('.swal2-html-container');
          if (modalContent) {
            const bubblesContainer = document.createElement('div');
            bubblesContainer.className = 'flex items-center justify-center mt-4';
            bubblesContainer.innerHTML = `
              <div class="flex items-end space-x-3">
                <span class="w-5 h-5 rounded-full bg-green-500 animate-bounce" style="animation-delay: 0ms"></span>
                <span class="w-5 h-5 rounded-full bg-blue-500 animate-bounce" style="animation-delay: 100ms"></span>
                <span class="w-5 h-5 rounded-full bg-yellow-500 animate-bounce" style="animation-delay: 200ms"></span>
                <span class="w-5 h-5 rounded-full bg-red-500 animate-bounce" style="animation-delay: 300ms"></span>
                <span class="w-5 h-5 rounded-full bg-purple-500 animate-bounce" style="animation-delay: 400ms"></span>
              </div>
            `;
            modalContent.appendChild(bubblesContainer);
          }
        }
      });

      const response = await axios.post(`${API_URL}/stkpush`, {
        phone: formattedPhone,
        amount: numericAmount
      });

      console.log('STK Push Response:', response.data);
      const { CheckoutRequestID } = response.data || {};

      // Join socket room by CheckoutRequestID to receive real-time updates
      if (CheckoutRequestID) {
        const socket = connectSocket();

        // Remove any prior listener to avoid duplicates
        socket.off('transaction_update');

        socket.emit('join_checkout', { checkoutRequestId: CheckoutRequestID });

        // Soft pending notice after 45s
        pendingTimerRef.current = window.setTimeout(() => {
          MySwal.fire({
            title: 'Still Pending…',
            text: 'If you have not received the prompt, ensure your SIM is active and try again.',
            icon: 'info',
            confirmButtonText: 'OK'
          });
        }, 45000);

        // Hard fallback after 3 minutes if no callback received
        hardTimeoutRef.current = window.setTimeout(() => {
          setShowBubbles(false);
          MySwal.fire({
            title: 'Payment Timeout',
            text: 'We did not receive a response in time. Please try again.',
            icon: 'warning',
            confirmButtonText: 'OK'
          });
        }, 180000);

        socket.on('transaction_update', (payload: any) => {
          clearTimers();
          setShowBubbles(false);
          const status: string = payload?.status || 'failure';
          const desc: string = payload?.resultDesc || 'Payment update received.';

          // Close loading if open
          Swal.close();

          if (status === 'success') {
            setLastReceipt({
              amount: payload?.amount || numericAmount,
              receipt: payload?.receipt || 'N/A',
              phone: payload?.phone || phone
            });
            setPaymentStatus('success');
            MySwal.fire({
              title: 'Payment Successful',
              text: `KES ${payload?.amount || numericAmount} received.`,
              icon: 'success',
              timer: 2000,
              showConfirmButton: false
            });
          } else if (status === 'cancelled') {
            MySwal.fire({
              title: 'Payment Cancelled',
              text: 'You cancelled the payment prompt.',
              icon: 'error',
              confirmButtonText: 'OK'
            });
          } else if (status === 'wrong_pin') {
            MySwal.fire({
              title: 'Wrong PIN',
              text: 'The PIN entered was incorrect. Please try again.',
              icon: 'error',
              confirmButtonText: 'Retry'
            });
          } else if (status === 'insufficient_funds') {
            MySwal.fire({
              title: 'Insufficient Funds',
              text: 'Your M-Pesa balance is insufficient for this transaction.',
              icon: 'error',
              confirmButtonText: 'OK'
            });
          } else if (status === 'timeout') {
            MySwal.fire({
              title: 'Request Timed Out',
              text: 'The payment request timed out. Please try again.',
              icon: 'warning',
              confirmButtonText: 'OK'
            });
          } else {
            MySwal.fire({
              title: 'Payment Failed',
              text: desc,
              icon: 'error',
              confirmButtonText: 'OK'
            });
          }
        });
      }

      setPhone('');
      setAmount('');
      setShowBubbles(true);

    } catch (err: any) {
      console.error('STK Push Error:', err);
      const backendError = err?.response?.data;
      const details = typeof backendError?.details === 'string'
        ? backendError?.details
        : backendError?.details
          ? JSON.stringify(backendError?.details)
          : err?.message;
      const errorMessage = backendError?.error || 'Payment initiation failed.';

      MySwal.fire({
        title: 'Payment Failed',
        html: `${errorMessage}${details ? `<br/><small>${details}</small>` : ''}`,
        icon: 'error',
        confirmButtonText: 'Try Again'
      });
      setShowBubbles(false);
    } finally {
      setLoading(false);
    }
  };

  if (paymentStatus === 'success') {
    return (
      <div className="bg-gradient-to-br from-slate-50 to-white min-h-screen flex items-center justify-center p-6 font-sans">
        <div className="w-full max-w-[400px] bg-white rounded-[2rem] shadow-[0_20px_50px_rgba(0,0,0,0.1)] border border-slate-100 p-10 text-center success-card relative overflow-hidden">
          {/* Decorative radial gradient */}
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-green-500 to-transparent" />
          
          <div className="mb-8">
            <h1 className="text-5xl mpesa-kenya-text mb-3">Success!</h1>
            <div className="inline-block px-3 py-1 bg-green-100 rounded-full">
              <p className="text-green-700 font-bold tracking-wider uppercase text-[10px]">Payment Confirmed</p>
            </div>
          </div>
          
          <div className="bg-slate-50 rounded-3xl p-8 mb-8 border border-slate-100 space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-slate-400 text-sm font-medium">Receipt</span>
              <span className="font-bold text-slate-700 font-mono tracking-tight">{lastReceipt?.receipt}</span>
            </div>
            <div className="h-px bg-dashed bg-slate-200 w-full" style={{ backgroundImage: 'linear-gradient(to right, #e2e8f0 50%, transparent 50%)', backgroundSize: '8px 1px', backgroundRepeat: 'repeat-x' }} />
            <div className="flex justify-between items-center">
              <span className="text-slate-400 text-sm font-medium">Amount</span>
              <span className="text-2xl font-black text-green-600">KES {lastReceipt?.amount}</span>
            </div>
            <div className="flex justify-between items-center pt-2">
              <span className="text-slate-400 text-sm font-medium">Account</span>
              <span className="font-semibold text-slate-600">{lastReceipt?.phone}</span>
            </div>
          </div>

          <button
            onClick={() => setPaymentStatus('idle')}
            className="w-full py-4 px-4 text-base font-black text-white bg-slate-900 hover:bg-black rounded-2xl transition-all duration-300 shadow-xl active:scale-[0.98]"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-tr from-slate-50 via-white to-green-50/30 min-h-screen flex items-center justify-center p-6 font-sans">
      <div className="w-full max-w-[400px] bg-white rounded-[2.5rem] shadow-[0_25px_60px_rgba(0,0,0,0.08)] border border-slate-100 p-10 relative overflow-hidden">
        {/* Subtle background glow */}
        <div className="absolute -top-24 -right-24 w-48 h-48 bg-green-400/10 blur-[80px] rounded-full" />
        
        <button
          onClick={() => navigate('/payments')}
          className="absolute top-6 left-6 text-slate-500 hover:text-slate-800 transition-colors z-10"
        >
          <ArrowLeft className="w-6 h-6" />
        </button>

        <div className="text-center mb-10 mt-4 relative">
          <h1 className="text-4xl mpesa-kenya-text mb-3 hover:scale-105 transition-transform cursor-default">Pay with M-Pesa</h1>
          <p className="text-slate-400 font-medium text-sm px-4">Fast & secure payment via STK Push</p>
        </div>

        <form onSubmit={handleSubmit} noValidate className="space-y-8 relative">
          <div className="space-y-2">
            <label htmlFor="phone" className="block text-xs font-bold text-slate-400 normal-case tracking-widest pl-1">
               Enter your Phone Number
            </label>
            <div className="relative group">
              <Smartphone className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-300 group-focus-within:text-green-500 transition-colors" />
              <input
                id="phone"
                type="tel"
                placeholder="0712345678"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className={`w-full pl-12 pr-4 py-4 rounded-2xl border bg-slate-50/50 shadow-inner transition-all duration-300 focus:bg-white focus:ring-4 ${
                  validationErrors.phone ? 'border-red-400 focus:ring-red-100' : 'border-slate-100 focus:ring-green-100'
                }`}
                disabled={loading}
              />
            </div>
            {validationErrors.phone && <p className="mt-2 text-[10px] font-bold text-red-500 pl-1">{validationErrors.phone}</p>}
          </div>

          <div className="space-y-2">
            <label htmlFor="amount" className="block text-xs font-bold text-slate-400 normal-case tracking-widest pl-1">
              Amount (KES)
            </label>
            <div className="relative group">
              <EuroIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-300 group-focus-within:text-green-500 transition-colors" />
              <input
                id="amount"
                type="number"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className={`w-full pl-12 pr-4 py-4 rounded-2xl border bg-slate-50/50 shadow-inner transition-all duration-300 focus:bg-white focus:ring-4 ${
                  validationErrors.amount ? 'border-red-400 focus:ring-red-100' : 'border-slate-100 focus:ring-green-100'
                }`}
                disabled={loading}
              />
            </div>
            {validationErrors.amount && <p className="mt-2 text-[10px] font-bold text-red-500 pl-1">{validationErrors.amount}</p>}
          </div>

          <div className="pt-4">
            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center py-5 px-4 text-base font-black text-white bg-gray-600 hover:bg-green-700 rounded-[1.25rem] transition-all duration-300 shadow-xl shadow-green-100 active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100"
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 mr-3 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  Pay KES {Number(amount) || 0}
                </>
              )}
            </button>
          </div>
        </form>

        {showBubbles && (
          <div className="mt-8 flex items-center justify-center">
            <div className="flex items-end space-x-3" aria-label="Payment prompt sent, awaiting your confirmation">
              <span className="w-5 h-5 rounded-full bg-green-500 animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-5 h-5 rounded-full bg-blue-500 animate-bounce" style={{ animationDelay: '100ms' }} />
              <span className="w-5 h-5 rounded-full bg-yellow-500 animate-bounce" style={{ animationDelay: '200ms' }} />
              <span className="w-5 h-5 rounded-full bg-red-500 animate-bounce" style={{ animationDelay: '300ms' }} />
              <span className="w-5 h-5 rounded-full bg-purple-500 animate-bounce" style={{ animationDelay: '400ms' }} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PayWithMpesa;
