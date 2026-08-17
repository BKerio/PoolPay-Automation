import { useEffect, useState } from 'react';
import axios from 'axios';
import { Loader2, FileDown, Search, Send } from 'lucide-react';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import Swal from 'sweetalert2';

interface Transaction {
  _id: string;
  MerchantRequestID: string;
  CheckoutRequestID: string;
  ResultCode: number;
  ResultDesc: string;
  Amount: number;
  MpesaReceiptNumber: string;
  PhoneNumber: string;
  TransactionDate: string;
}

const ViewTransactions = () => {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [withdrawPhone, setWithdrawPhone] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawing, setWithdrawing] = useState(false);

  const API_URL = import.meta.env.VITE_API_URL;

  useEffect(() => {
    const fetchTransactions = async () => {
      try {
        const res = await axios.get(`${API_URL}/transactions`);
        setTransactions(res.data);
      } catch (err: any) {
        setError(err.response?.data?.error || 'Error fetching transactions');
      } finally {
        setLoading(false);
      }
    };

    fetchTransactions();
  }, [API_URL]);

  const maskPhone = (phone: string) => {
    return phone.replace(/(\d{4})(\d{3})(\d{2})(\d{1})/, (_, a, _b, _c, d) => `${a}****${d}`);
  };

  const formatPhoneNumber = (phone: string): string => {
    const clean = phone.replace(/\s+/g, '');
    if (clean.startsWith('+')) return clean.slice(1);
    if (clean.startsWith('0')) return '254' + clean.slice(1);
    if (clean.startsWith('254')) return clean;
    return '254' + clean;
  };

  const filtered = transactions.filter((tx) =>
    tx.PhoneNumber.includes(search) || tx.MpesaReceiptNumber.includes(search)
  );

  const totalAmount = filtered.reduce((acc, tx) => acc + tx.Amount, 0);

  const exportToExcel = () => {
    const worksheet = XLSX.utils.json_to_sheet(
      filtered.map((tx) => ({
        Date: new Date(tx.TransactionDate).toLocaleString(),
        Phone: maskPhone(tx.PhoneNumber),
        Amount: tx.Amount,
        Receipt: tx.MpesaReceiptNumber,
        Status: tx.ResultCode === 0 ? 'Success' : 'Failed',
      }))
    );

    const totalRow = [['', '', totalAmount, '', 'Total']];
    XLSX.utils.sheet_add_aoa(worksheet, totalRow, { origin: -1 });

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Transactions');
    XLSX.writeFile(workbook, 'poolpay-report.xlsx');

    Swal.fire({
      icon: 'success',
      title: 'Excel Exported',
      text: 'Your Excel report has been exported successfully.',
      timer: 2000,
      showConfirmButton: false,
    });
  };

  const loadImageBase64 = (url: string): Promise<string | null> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'Anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(null);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.globalAlpha = 0.08;
        ctx.drawImage(img, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
  };

  const exportToPDF = async () => {
    const doc = new jsPDF();
    const logo = await loadImageBase64('/logo.png');
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    doc.setFontSize(16);
    doc.text('Latest Pool Pay Report', 14, 20);
    doc.setFontSize(10);
    doc.text(`Generated on: ${new Date().toLocaleString()}`, 14, 27);

    const tableColumn = ['Date', 'Phone', 'Amount', 'Receipt', 'Status'];
    const tableRows: any[] = [];

    filtered.forEach(tx => {
      tableRows.push([
        new Date(tx.TransactionDate).toLocaleString(),
        maskPhone(tx.PhoneNumber),
        `KES ${tx.Amount.toFixed(2)}`,
        tx.MpesaReceiptNumber,
        tx.ResultCode === 0 ? 'Success' : 'Failed',
      ]);
    });

    tableRows.push(['', '', `KES ${totalAmount.toFixed(2)}`, '', 'Total']);

    autoTable(doc, {
      startY: 35,
      head: [tableColumn],
      body: tableRows,
      didDrawPage: () => {
        if (logo) {
          doc.addImage(logo, 'PNG', (pageWidth - 150) / 2, (pageHeight - 150) / 2, 150, 150, '', 'FAST');
        }
      },
      margin: { top: 35 },
    });

    doc.save('poolpay-report.pdf');

    Swal.fire({
      icon: 'success',
      title: 'PDF Exported',
      text: 'Your PDF report has been exported successfully.',
      timer: 2000,
      showConfirmButton: false,
    });
  };

  const handleWithdraw = async () => {
    const amount = parseFloat(withdrawAmount);
    if (!withdrawPhone.trim()) {
      return Swal.fire('Missing Number', 'Please enter a phone number.', 'warning');
    }
    if (!withdrawAmount.trim() || isNaN(amount) || amount <= 0) {
      return Swal.fire('Invalid Amount', 'Enter a valid withdrawal amount.', 'warning');
    }
    if (amount > totalAmount) {
      return Swal.fire('Amount Exceeded', 'Withdrawal amount exceeds available balance.', 'error');
    }

    try {
      setWithdrawing(true);
      const formattedPhone = formatPhoneNumber(withdrawPhone);
      await axios.post(`${API_URL}/b2c`, { phone: formattedPhone, amount });
      Swal.fire('Success', 'Withdrawal initiated successfully.', 'success');
      setWithdrawPhone('');
      setWithdrawAmount('');
    } catch (error: any) {
      Swal.fire('Error', error.response?.data?.error || 'Failed to initiate withdrawal', 'error');
    } finally {
      setWithdrawing(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 py-10 px-4 font-sans">
      <div className="max-w-6xl mx-auto bg-white shadow-md rounded-xl p-6 border">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold text-green-700">Recent M-Pesa Transactions</h1>
          <div className="flex gap-2">
            <button onClick={exportToExcel} className="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded text-sm">
              <FileDown className="inline mr-1 w-4 h-4" /> Excel
            </button>
            <button onClick={exportToPDF} className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded text-sm">
              <FileDown className="inline mr-1 w-4 h-4" /> PDF
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 mb-4">
          <Search className="text-slate-500 w-4 h-4" />
          <input
            type="text"
            placeholder="Search by phone or receipt"
            className="border px-3 py-2 rounded w-full max-w-sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 gap-3">
          <div className="text-right">
            <span className="inline-block bg-green-50 border border-green-200 text-green-700 font-semibold text-sm px-4 py-2 rounded-lg shadow-sm">
              Total Amount: <span className="text-green-900">KES {totalAmount.toLocaleString()}</span>
            </span>
          </div>

          <div className="flex gap-2 items-center">
            <input
              type="tel"
              placeholder="Recipient Phone (e.g. 0712... or 2547...)"
              value={withdrawPhone}
              onChange={(e) => setWithdrawPhone(e.target.value)}
              className="border px-3 py-2 rounded text-sm w-64"
            />
            <input
              type="number"
              placeholder="Amount to Withdraw"
              value={withdrawAmount}
              onChange={(e) => setWithdrawAmount(e.target.value)}
              className="border px-3 py-2 rounded text-sm w-40"
            />
            <button
              onClick={handleWithdraw}
              disabled={withdrawing}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm flex items-center"
            >
              {withdrawing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Send className="w-4 h-4 mr-2" />}
              Withdraw
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="w-6 h-6 text-green-600 animate-spin mr-2" />
            <span className="text-green-600">Loading...</span>
          </div>
        ) : error ? (
          <p className="text-red-500">{error}</p>
        ) : filtered.length === 0 ? (
          <p className="text-slate-500">No transactions found.</p>
        ) : (
          <div className="overflow-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="bg-green-100 text-left">
                  <th className="px-4 py-2 border">Date</th>
                  <th className="px-4 py-2 border">Phone</th>
                  <th className="px-4 py-2 border">Amount</th>
                  <th className="px-4 py-2 border">Mpesa Receipt Number</th>
                  <th className="px-4 py-2 border">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((tx) => (
                  <tr key={tx._id} className="hover:bg-slate-50">
                    <td className="px-4 py-2 border">{new Date(tx.TransactionDate).toLocaleString()}</td>
                    <td className="px-4 py-2 border">{maskPhone(tx.PhoneNumber)}</td>
                    <td className="px-4 py-2 border">KES {tx.Amount.toFixed(2)}</td>
                    <td className="px-4 py-2 border">{tx.MpesaReceiptNumber}</td>
                    <td className="px-4 py-2 border">
                      {tx.ResultCode === 0 ? (
                        <span className="text-green-600 font-medium">Payment Success</span>
                      ) : (
                        <span className="text-red-500 font-medium">Failed</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default ViewTransactions;
