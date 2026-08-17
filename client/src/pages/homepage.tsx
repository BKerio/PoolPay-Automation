import { useNavigate } from 'react-router-dom';
import { Smartphone, FileText } from 'lucide-react';

const HomePage = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-white flex items-center justify-center p-6 font-sans">
      <div className="bg-white rounded-3xl shadow-2xl p-10 w-full max-w-lg text-center border border-slate-200">
        <h1 className="text-3xl font-bold text-green-700 mb-4">Payment Dashboard</h1>
        <p className="text-slate-500 mb-8">Choose an action below</p>

        <div className="space-y-4">
          <button
            onClick={() => navigate('/pay/mpesa')}
            className="w-full flex items-center justify-center gap-2 py-3 px-6 text-base font-semibold text-white bg-green-600 hover:bg-green-700 rounded-xl transition-all duration-300 focus:ring-4 focus:ring-green-300"
          >
            <Smartphone className="w-5 h-5" />
            Make a Payment
          </button>

          <button
            onClick={() => navigate('/transactions')}
            className="w-full flex items-center justify-center gap-2 py-3 px-6 text-base font-semibold text-green-700 bg-green-100 hover:bg-green-200 rounded-xl transition-all duration-300 focus:ring-4 focus:ring-green-200"
          >
            <FileText className="w-5 h-5" />
            View Transactions
          </button>
        </div>
      </div>
    </div>
  );
};

export default HomePage;
