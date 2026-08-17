# PoolPay - ESP32 M-Pesa Payment Terminal

PoolPay is an IoT-based payment terminal system. It allows users to enter a phone number and payment amount using a physical keypad, displays prompts on an I2C LCD, and triggers a Safaricom M-Pesa STK Push via a custom Node.js Express backend. On a **confirmed successful payment**, the ESP32 also drives a **servo motor** to unlock a gate, turnstile, or door lock — making it a drop-in "pay to enter" terminal for pools, gyms, parking, or event access.

Instead of relying on fragile WebSocket connections, the ESP32 performs highly reliable HTTP polling against the backend database status endpoint to track transaction outcomes (Success, Cancelled, Wrong PIN, Insufficient Funds, etc.) in real-time.

A companion React web client (`client/`) also exists for browser-based payments and a live transaction history view, backed by the same API and a Socket.IO feed.

---

## 🔌 Hardware Connections & Wiring

### 1. ESP32 Dev Board

<img src="https://commons.wikimedia.org/wiki/Special:FilePath/ESP32_Dev_Board.jpg?width=420" alt="ESP32 development board" width="420">

*Photo: [ESP32 Dev Board.jpg](https://commons.wikimedia.org/wiki/File:ESP32_Dev_Board.jpg) — Wikimedia Commons, CC BY-SA 4.0.*

The brains of the terminal. Any standard ESP32 DevKit (30 or 38-pin) works — it connects to Wi-Fi, drives the keypad/LCD/servo, and talks HTTP to the backend.

### 2. 4x3 Matrix Keypad

<img src="https://commons.wikimedia.org/wiki/Special:FilePath/Keypad_arduino.jpg?width=420" alt="Matrix membrane keypad" width="420">

*Photo: [Keypad arduino.jpg](https://commons.wikimedia.org/wiki/File:Keypad_arduino.jpg) — Wikimedia Commons, CC BY-SA 4.0. (Shown: a 4x4 membrane keypad for reference — wiring below is for the 4x3 variant this project uses.)*

| Keypad Pin | ESP32 GPIO | Description |
| :--- | :--- | :--- |
| **R1** | **14** | Row 1 |
| **R2** | **27** | Row 2 |
| **R3** | **26** | Row 3 |
| **R4** | **25** | Row 4 |
| **C1** | **33** | Column 1 |
| **C2** | **32** | Column 2 |
| **C3** | **13** | Column 3 |

### 3. 16x2 I2C LCD Display

<img src="https://commons.wikimedia.org/wiki/Special:FilePath/MELT_16x2_LCD_alphanumeric_display_07(DXO).jpg?width=420" alt="16x2 I2C LCD display" width="420">

*Photo: [MELT 16x2 LCD alphanumeric display 07(DXO).jpg](https://commons.wikimedia.org/wiki/File:MELT_16x2_LCD_alphanumeric_display_07(DXO).jpg) — Wikimedia Commons, CC0.*

| LCD Pin | ESP32 Pin | Description |
| :--- | :--- | :--- |
| **VCC** | **5V** | Power Supply |
| **GND** | **GND** | Ground |
| **SDA** | **21** | I2C Data |
| **SCL** | **22** | I2C Clock |

### 4. SG90 Servo Motor (Gate / Turnstile Lock)

<img src="https://commons.wikimedia.org/wiki/Special:FilePath/Tower_Pro_SG90_micro_servo_motor.jpg?width=420" alt="SG90 micro servo motor" width="420">

*Photo: [Tower Pro SG90 micro servo motor.jpg](https://commons.wikimedia.org/wiki/File:Tower_Pro_SG90_micro_servo_motor.jpg) — Wikimedia Commons, CC BY-SA 4.0.*

Triggered automatically by the firmware when a poll returns `status: "success"` — it swings open to unlock, holds for a few seconds, then re-locks.

| Servo Pin | ESP32 Pin | Description |
| :--- | :--- | :--- |
| **Signal** | **4** | PWM control signal |
| **VCC (red)** | **External 5V** | Power (see note below) |
| **GND (brown/black)** | **GND** | Ground — **must be shared** with the ESP32's GND |

> ⚠️ **Power note:** An SG90 can briefly draw 500–700 mA when starting or stalling — enough to brown out an ESP32 powered from USB if you tap the servo off its onboard 5V pin. Power the servo from a separate 5V supply (or a buck converter off a bench supply) and tie its ground to the ESP32's ground. For anything larger than an SG90 (e.g. a real gate actuator/solenoid lock), drive it through a relay or MOSFET instead of powering it directly from the ESP32.

---

## 🛠️ Project Structure

```text
├── arduino/
│   └── mpesa_stkpush.cpp  # ESP32 Arduino Core source code (keypad, LCD, servo, HTTP polling)
├── backend/
│   ├── src/
│   │   ├── index.ts       # Express server entry point, security middleware & Socket.IO server
│   │   ├── routes/
│   │   │   └── mpesa.ts   # Safaricom Daraja STK Push & Callback HTTP endpoints
│   │   └── models/
│   │       └── Payments.ts# MongoDB Transaction Schema
│   ├── .env.example       # Template for Daraja/Mongo/server credentials
│   └── tsconfig.json      # TypeScript compiler config
├── client/                # Optional React web client (pay from a browser, view transaction history)
└── README.md              # Project Documentation
```

---

## 🚀 Getting Started

### 1. Backend Setup
The backend is built with Node.js, Express, TypeScript, and MongoDB, and ships with `helmet` (security headers), rate limiting on the payment endpoint, and startup validation of required environment variables.

1. Navigate to the `backend/` directory:
   ```bash
   cd backend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `.env` file from the example:
   ```bash
   cp .env.example .env
   ```
4. Fill in your Daraja credentials, MongoDB connection string, and local server port:
   ```env
   PORT=5000
   NODE_ENV=development
   CLIENT_ORIGIN=http://localhost:5174
   MONGO_URI=mongodb://localhost:27017/mpesa
   MPESA_CONSUMER_KEY=your_consumer_key
   MPESA_CONSUMER_SECRET=your_consumer_secret
   MPESA_PASSKEY=your_stk_push_passkey
   MPESA_SHORTCODE=174379
   TILL_NO=174379
   MPESA_TRANSACTIONTYPE=CustomerPayBillOnline
   MPESA_CALLBACK_URL=https://your-public-domain.ngrok-free.app/api/stkpush/callback
   MPESA_BASE_URL=https://sandbox.safaricom.co.ke
   ```
   > 💡 **Note:** Safaricom requires a public HTTPS callback URL. Use a tool like **ngrok** to tunnel your local port `5000` to the internet (`ngrok http 5000`) and set `MPESA_CALLBACK_URL` accordingly.
   >
   > 🔒 **Security note:** `.env` is gitignored — keep it that way. Daraja consumer keys/secrets and passkeys are live credentials; never commit them, paste them into issues/chat logs, or reuse sandbox and production keys across environments. If a key ever leaks, rotate it in the [Daraja portal](https://developer.safaricom.co.ke/) immediately.
5. Start the development server:
   ```bash
   npm run dev
   ```
   The server validates required env vars on boot and exits immediately with a clear error if any are missing, instead of failing later mid-payment.

### 2. ESP32 Firmware Configuration
1. Open [arduino/mpesa_stkpush.cpp](file:///c:/Users/brian/Mpesa/arduino/mpesa_stkpush.cpp) in the Arduino IDE (rename extension to `.ino` if using the classic IDE) or build using PlatformIO.
2. Ensure you have the following libraries installed:
   * **Keypad** by Mark Stanley, Alexander Brevig
   * **LiquidCrystal_I2C** by Frank de Brabander
   * **ArduinoJson** by Benoit Blanchon (v6.x)
   * **ESP32Servo** by Kevin Harrington / John K. Bennett (drives the gate servo)
3. Set your Wi-Fi credentials (the checked-in placeholders must be replaced — never commit real Wi-Fi credentials):
   ```cpp
   const char* ssid = "YOUR_WIFI_SSID";
   const char* password = "YOUR_WIFI_PASSWORD";
   ```
4. Change the backend API URLs to match your server's local network IP address (e.g., `192.168.1.148`):
   ```cpp
   const char* api_stkpush = "http://192.168.1.148:5000/api/stkpush";
   const char* api_status_base = "http://192.168.1.148:5000/api/stkpush/status/";
   ```
5. Wire the SG90 servo signal wire to **GPIO 4** as described in the [wiring section](#4-sg90-servo-motor-gate--turnstile-lock) above, and adjust `SERVO_OPEN_ANGLE` / `GATE_OPEN_DURATION_MS` to match your gate hardware.
6. Compile and upload to your ESP32 board!

---

## 💳 Payment Gateways

### M-Pesa (Daraja STK Push) — implemented
The primary flow: the ESP32 collects phone + amount, the backend triggers an STK Push via Safaricom's Daraja API, and the result is polled back from MongoDB as described in the [User Workflow](#-user-workflow) below.

### Stripe (card payments) — how to add it
Stripe isn't wired up in this repo yet, but the backend is structured so it drops in cleanly alongside M-Pesa as a second payment route. This is a guide for adding it, not code that ships in this repo.

1. **Install the SDK** in `backend/`:
   ```bash
   npm install stripe
   ```
2. **Add credentials** to `backend/.env` (get these from the [Stripe Dashboard](https://dashboard.stripe.com/apikeys)):
   ```env
   STRIPE_SECRET_KEY=sk_test_...
   STRIPE_WEBHOOK_SECRET=whsec_...
   ```
3. **Create `backend/src/routes/stripe.ts`** with a Checkout Session endpoint the ESP32 or web client can call:
   ```ts
   import express, { Request, Response } from 'express';
   import Stripe from 'stripe';

   const router = express.Router();
   const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

   // POST /api/stripe/checkout — mirrors /api/stkpush's shape (phone/amount in, id out)
   router.post('/checkout', async (req: Request, res: Response) => {
     const { amount } = req.body as { amount: number }; // KES, converted to the smallest currency unit below

     const session = await stripe.checkout.sessions.create({
       mode: 'payment',
       payment_method_types: ['card'],
       line_items: [
         {
           price_data: {
             currency: 'kes',
             product_data: { name: 'PoolPay Entry' },
             unit_amount: Math.round(amount * 100), // Stripe uses the smallest currency unit
           },
           quantity: 1,
         },
       ],
       success_url: `${process.env.CLIENT_ORIGIN}/pay/success?session_id={CHECKOUT_SESSION_ID}`,
       cancel_url: `${process.env.CLIENT_ORIGIN}/pay/cancelled`,
     });

     res.json({ id: session.id, url: session.url });
   });

   export default router;
   ```
4. **Add a webhook route** to receive async payment confirmation — same role as `/api/stkpush/callback`. Stripe webhooks need the **raw** request body for signature verification, so this route must be registered **before** `express.json()` in `index.ts`:
   ```ts
   app.post(
     '/api/stripe/webhook',
     express.raw({ type: 'application/json' }),
     (req, res) => {
       const sig = req.headers['stripe-signature'] as string;
       let event: Stripe.Event;

       try {
         event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
       } catch (err: any) {
         return res.status(400).send(`Webhook signature verification failed: ${err.message}`);
       }

       if (event.type === 'checkout.session.completed') {
         // Save to MongoDB and emit a socket event, same pattern as the
         // M-Pesa callback handler in routes/mpesa.ts.
       }

       res.json({ received: true });
     }
   );
   app.use(express.json({ limit: '100kb' })); // registered AFTER the raw webhook route
   ```
5. **Reuse the polling pattern**: add a `GET /api/stripe/status/:sessionId` endpoint that mirrors `GET /api/stkpush/status/:checkoutRequestId`, so the ESP32 firmware's existing `pollPaymentStatus()` logic can poll either gateway with only the URL changed.
6. **Test locally** with the [Stripe CLI](https://stripe.com/docs/stripe-cli):
   ```bash
   stripe listen --forward-to localhost:5000/api/stripe/webhook
   stripe trigger checkout.session.completed
   ```
   Use Stripe's [test card `4242 4242 4242 4242`](https://stripe.com/docs/testing) (any future expiry, any CVC) to simulate a successful card payment end-to-end.

---

## 📱 User Workflow
1. **Idle State**: LCD displays `Enter Phone`.
2. **Phone Number Entry**: Input the customer's phone number (e.g. `0717000480`) and press `#` to proceed.
   * If you make a mistake, press `*` to clear and start over.
3. **Amount Entry**: LCD displays `Amount:`. Key in the payment amount and press `#`.
4. **Push Sent**: ESP32 hits `/api/stkpush`, triggers Safaricom, receives the checkout request ID, and changes the LCD to `Check Phone & Pay`.
5. **State Lock**: Keypad input is disabled during payment processing.
6. **Polling**: ESP32 queries the backend status endpoint every 3 seconds (giving up after 90 seconds).
7. **Result Dispatch**: Once the user enters their PIN on their phone, the callback updates MongoDB, and the ESP32 registers the payment status on its next poll:
   * **SUCCESS** — the LCD shows `PAYMENT SUCCESS` and the **servo unlocks the gate** for `GATE_OPEN_DURATION_MS` (default 5s) before automatically re-locking.
   * **CANCELLED**
   * **WRONG PIN**
   * **INSUFFICIENT FUNDS**
   * **TIMEOUT**
8. After displaying the outcome, the terminal resets back to `Enter Phone`.
