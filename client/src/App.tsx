import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "@/components/theme-provider";
import HomePage from "@/pages/homepage";
import PayWithMpesa from "@/pages/lipanampesa";
import ViewTransactions from "@/pages/transaction";

function App() {
  return (
    <ThemeProvider defaultTheme="system">
      <Router>
        <div className="min-h-screen bg-white dark:bg-gray-900 flex flex-col">
          <main className="flex-grow">
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/pay/mpesa" element={<PayWithMpesa />} />
              <Route path="/transactions" element={<ViewTransactions />} />
              <Route path="*" element={<div className="text-center text-gray-500 mt-10">
                Page not found.
              </div>} />
            </Routes>
          </main>
        </div>
      </Router>
    </ThemeProvider>
  );
}

export default App;