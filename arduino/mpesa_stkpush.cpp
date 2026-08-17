#include <Keypad.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <ESP32Servo.h>

// =====================================
// WIFI CONFIGURATION
// =====================================

const char* ssid = "YOUR_WIFI_SSID";
const char* password = "YOUR_WIFI_PASSWORD";

// =====================================
// BACKEND CONFIGURATION
// =====================================

const char* api_stkpush = "http://192.168.1.148:5000/api/stkpush";
const char* api_status_base = "http://192.168.1.148:5000/api/stkpush/status/";

// =====================================
// LCD CONFIGURATION
// =====================================

LiquidCrystal_I2C lcd(0x27, 16, 2);

// =====================================
// 4x3 KEYPAD CONFIGURATION
// =====================================

const byte ROWS = 4;
const byte COLS = 3;

char keys[ROWS][COLS] = {
  {'1','2','3'},
  {'4','5','6'},
  {'7','8','9'},
  {'*','0','#'}
};

byte rowPins[ROWS] = {14, 27, 26, 25};
byte colPins[COLS] = {33, 32, 13};

Keypad keypad = Keypad(makeKeymap(keys), rowPins, colPins, ROWS, COLS);

// =====================================
// SERVO / GATE CONFIGURATION
// =====================================
// Drives a gate, turnstile, or pool-entry lock that unlocks automatically
// once a payment is confirmed SUCCESS. Powering the servo from the ESP32's
// own 5V pin can brown out the board under load — feed it from a separate
// 5V supply and tie the grounds together (see README wiring notes).

Servo gateServo;
const int SERVO_PIN = 4;
const int SERVO_CLOSED_ANGLE = 0;
const int SERVO_OPEN_ANGLE = 90;
const unsigned long GATE_OPEN_DURATION_MS = 5000; // how long the gate stays unlocked

void openGate() {
  Serial.println("Payment confirmed - opening gate");
  gateServo.write(SERVO_OPEN_ANGLE);
  delay(GATE_OPEN_DURATION_MS);
  gateServo.write(SERVO_CLOSED_ANGLE);
  Serial.println("Gate closed");
}

// =====================================
// GLOBAL VARIABLES
// =====================================

String phone = "";
String amount = "";

bool enteringPhone = true;
bool waitingForPayment = false;

String currentCheckoutRequestId = "";

unsigned long lastPollTime = 0;
const unsigned long POLL_INTERVAL_MS = 3000;   // poll every 3 seconds
const unsigned long PAYMENT_TIMEOUT_MS = 90000; // give up after 90 seconds
unsigned long paymentStartTime = 0;

// =====================================
// DISPLAY FUNCTIONS
// =====================================

void showMessage(String line1, String line2 = "") {
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print(line1);
  lcd.setCursor(0, 1);
  lcd.print(line2);
}

void showPhone() {
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Phone:");
  lcd.setCursor(0, 1);
  lcd.print(phone);
}

void showAmount() {
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Amount:");
  lcd.setCursor(0, 1);
  lcd.print(amount);
}

void resetAll() {
  phone = "";
  amount = "";
  enteringPhone = true;
  waitingForPayment = false;
  currentCheckoutRequestId = "";
  lastPollTime = 0;
  paymentStartTime = 0;
  showMessage("Enter Phone");
}

// =====================================
// WIFI CONNECTION
// =====================================

void connectWiFi() {
  WiFi.begin(ssid, password);
  showMessage("Connecting", "WiFi...");
  Serial.print("Connecting WiFi");

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println();
  Serial.println("WiFi Connected");
  Serial.print("IP Address: ");
  Serial.println(WiFi.localIP());

  showMessage("WiFi", "Connected");
  delay(2000);
}

// =====================================
// SEND STK PUSH
// =====================================

void sendSTKPush() {
  if (WiFi.status() != WL_CONNECTED) {
    showMessage("WiFi Error");
    delay(2000);
    resetAll();
    return;
  }

  HTTPClient http;
  http.begin(api_stkpush);
  http.addHeader("Content-Type", "application/json");

  DynamicJsonDocument doc(256);
  doc["phone"] = phone;
  doc["amount"] = amount.toInt();

  String requestBody;
  serializeJson(doc, requestBody);

  Serial.println("Sending STK Push");
  Serial.println(requestBody);

  showMessage("Sending STK");

  int httpResponseCode = http.POST(requestBody);

  if (httpResponseCode == 200) {
    String response = http.getString();
    Serial.println("Response:");
    Serial.println(response);

    DynamicJsonDocument resDoc(1024);
    DeserializationError error = deserializeJson(resDoc, response);

    if (!error) {
      currentCheckoutRequestId = resDoc["CheckoutRequestID"].as<String>();

      if (currentCheckoutRequestId != "null" && currentCheckoutRequestId.length() > 0) {
        waitingForPayment = true;
        paymentStartTime = millis();
        lastPollTime = 0; // poll immediately on first loop
        showMessage("Check Phone", "& Pay");
      } else {
        showMessage("API Error");
        delay(2000);
        resetAll();
      }
    } else {
      showMessage("JSON Error");
      delay(2000);
      resetAll();
    }
  } else {
    Serial.print("HTTP Error: ");
    Serial.println(httpResponseCode);
    showMessage("Network Error");
    delay(2000);
    resetAll();
  }

  http.end();
}

// =====================================
// POLL PAYMENT STATUS
// =====================================

void pollPaymentStatus() {
  if (WiFi.status() != WL_CONNECTED) return;

  String url = String(api_status_base) + currentCheckoutRequestId;

  HTTPClient http;
  http.begin(url);

  int httpResponseCode = http.GET();

  Serial.print("Poll status code: ");
  Serial.println(httpResponseCode);

  if (httpResponseCode == 200) {
    String response = http.getString();
    Serial.println("Poll response: " + response);

    DynamicJsonDocument doc(256);
    DeserializationError error = deserializeJson(doc, response);

    if (!error) {
      String status = doc["status"].as<String>();

      Serial.print("Payment Status: ");
      Serial.println(status);

      if (status == "success") {
        showMessage("PAYMENT", "SUCCESS");
        openGate(); // unlock the gate/turnstile for GATE_OPEN_DURATION_MS
        resetAll();
      }
      else if (status == "cancelled") {
        showMessage("USER", "CANCELLED");
        delay(3000);
        resetAll();
      }
      else if (status == "wrong_pin") {
        showMessage("WRONG PIN");
        delay(3000);
        resetAll();
      }
      else if (status == "insufficient_funds") {
        showMessage("INSUFFICIENT", "FUNDS");
        delay(3000);
        resetAll();
      }
      else if (status == "timeout") {
        showMessage("MPESA", "TIMEOUT");
        delay(3000);
        resetAll();
      }
      else if (status == "failure") {
        showMessage("PAYMENT", "FAILED");
        delay(3000);
        resetAll();
      }
      // status == "pending" → keep polling
    }
  } else if (httpResponseCode == 404) {
    // Not in DB yet → still pending, keep polling
    Serial.println("Status: pending (not in DB yet)");
  } else {
    Serial.print("Poll HTTP Error: ");
    Serial.println(httpResponseCode);
  }

  http.end();
}

// =====================================
// SETUP
// =====================================

void setup() {
  Serial.begin(115200);

  lcd.init();
  lcd.backlight();

  gateServo.setPeriodHertz(50);
  gateServo.attach(SERVO_PIN, 500, 2400);
  gateServo.write(SERVO_CLOSED_ANGLE);

  showMessage("PoolPay", "Starting...");
  delay(2000);

  connectWiFi();
  resetAll();
}

// =====================================
// MAIN LOOP
// =====================================

void loop() {

  // =====================================
  // PAYMENT POLLING
  // =====================================

  if (waitingForPayment) {

    // Timeout guard
    if (millis() - paymentStartTime > PAYMENT_TIMEOUT_MS) {
      Serial.println("Payment timed out");
      showMessage("TIMED OUT", "Try Again");
      delay(3000);
      resetAll();
      return;
    }

    // Poll every POLL_INTERVAL_MS
    if (millis() - lastPollTime > POLL_INTERVAL_MS) {
      lastPollTime = millis();
      pollPaymentStatus();
    }

    return; // block keypad while waiting
  }

  // =====================================
  // READ KEYPAD
  // =====================================

  char key = keypad.getKey();

  if (key) {
    Serial.print("Pressed: ");
    Serial.println(key);

    // RESET
    if (key == '*') {
      resetAll();
    }

    // NEXT STEP
    else if (key == '#') {

      // PHONE COMPLETE
      if (enteringPhone) {
        if (phone.length() < 10) {
          showMessage("Invalid Phone");
          delay(1500);
          showPhone();
          return;
        }
        enteringPhone = false;
        showAmount();
      }

      // SEND PAYMENT
      else {
        if (amount == "") {
          showMessage("Enter Amount");
          delay(1500);
          showAmount();
          return;
        }
        sendSTKPush();
      }
    }

    // NUMBER ENTRY
    else {

      // PHONE ENTRY
      if (enteringPhone) {
        if (phone.length() < 13) {
          phone += key;
          showPhone();
        }
      }

      // AMOUNT ENTRY
      else {
        if (amount.length() < 6) {
          amount += key;
          showAmount();
        }
      }
    }
  }
}
